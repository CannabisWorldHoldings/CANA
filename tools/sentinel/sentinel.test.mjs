import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeHtml, makeFingerprint, robotsAllows, HostGate,
  detectDrift, readPrev, writeCurr, runOffline, runLive, loadRegistry,
} from './monitor.mjs';

const V1 = `<!doctype html><html><head><title>Dispensary Deals</title></head>
<body><h1>Deals</h1><a href="/a">a</a><a href="/b">b</a><img src="x.jpg">
<script nonce="abc123">x()</script><form></form></body></html>`;
const V2 = V1.replace('<a href="/b">b</a>', '<a href="/b">b</a><a href="/c">NEW: 30% off</a>')
             .replace('<title>Dispensary Deals</title>', '<title>Dispensary Deals — Flash Sale</title>');

test('fingerprint is deterministic and ignores cosmetic churn (whitespace, nonces, comments)', () => {
  const a = makeFingerprint(V1, 'https://x.test/deals', '2026-08-18T00:00:00Z');
  const noisy = '<!-- build 999 -->' + V1.replace(/></g, '>\n  <').replace('nonce="abc123"', 'nonce="zzz999"');
  const b = makeFingerprint(noisy, 'https://x.test/deals', '2026-08-18T00:00:00Z');
  assert.equal(a.content_sha256, b.content_sha256);
  assert.equal(a.counts.links, 2);
  assert.equal(a.counts.forms, 1);
});

test('fingerprint record is structurally content-free — no field can carry the page', () => {
  const fp = makeFingerprint(V1, 'https://x.test/deals', '2026-08-18T00:00:00Z');
  const json = JSON.stringify(fp);
  assert.ok(!json.includes('Deals</h1>'), 'no markup fragments');
  assert.ok(!json.includes('30%'), 'no offer text');
  assert.ok(!/<[a-z]+[\s>]/i.test(json.replace(/https?:[^"]*/g, '')), 'no tags beyond the URL');
  const allowed = new Set(['url', 'observed_at', 'content_sha256', 'bytes_normalized', 'title_sha256', 'title_length', 'counts']);
  for (const k of Object.keys(fp)) assert.ok(allowed.has(k), `unexpected field ${k}`);
});

test('drift detection: identical pages produce no event; changed pages produce one', () => {
  const t0 = makeFingerprint(V1, 'https://x.test/deals', '2026-08-18T00:00:00Z');
  const t1 = makeFingerprint(V1, 'https://x.test/deals', '2026-08-18T01:00:00Z');
  assert.equal(detectDrift(t0, t1, { competitor: 'X', class: 'deals' }), null);
  const t2 = makeFingerprint(V2, 'https://x.test/deals', '2026-08-18T02:00:00Z');
  const ev = detectDrift(t0, t2, { competitor: 'X', class: 'deals' });
  assert.ok(ev, 'drift expected');
  assert.equal(ev.valid, true, 'ChangeEvent must satisfy the signal-to-fix contract');
  assert.equal(ev.kind, 'OFFER', 'deals class maps to OFFER');
  assert.match(ev.observation, /links:\+1/);
  assert.match(ev.observation, /title:changed/);
});

test('every drift is TRIAGE_REQUIRED and never self-authorized; first sight is baseline not drift', () => {
  const t0 = makeFingerprint(V1, 'https://x.test/', '2026-08-18T00:00:00Z');
  assert.equal(detectDrift(null, t0, { competitor: 'X', class: 'homepage' }), null);
  const t1 = makeFingerprint(V2, 'https://x.test/', '2026-08-18T01:00:00Z');
  const ev = detectDrift(t0, t1, { competitor: 'X', class: 'homepage' });
  assert.equal(ev.triage, 'TRIAGE_REQUIRED');
  assert.equal(ev.self_authorized, false);
});

test('robots: disallow honored, longest-match allow wins, unknown robots fails closed', () => {
  const robots = 'User-agent: *\nDisallow: /deals\nAllow: /deals/public\nUser-agent: other\nDisallow: /';
  assert.equal(robotsAllows(robots, '/deals'), false);
  assert.equal(robotsAllows(robots, '/deals/public/today'), true);
  assert.equal(robotsAllows(robots, '/'), true);
  assert.equal(robotsAllows(null, '/'), false, 'unfetchable robots => never fetch');
  assert.equal(robotsAllows('', '/anything'), true, '404 robots (empty) => allowed');
});

test('host gate enforces spacing without real sleeping', async () => {
  const gate = new HostGate(10_000);
  const sleeps = [];
  const fakeSleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
  await gate.admit('a.test', fakeSleep);
  await gate.admit('a.test', fakeSleep);
  assert.equal(sleeps.length, 1, 'second same-host request must wait');
  assert.ok(sleeps[0] > 9_000, `expected ~10s spacing, got ${sleeps[0]}`);
});

test('offline court: baseline run then mutated-fixture run yields exactly the expected events', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
  const fixtures = path.join(tmp, 'fx'); const state = path.join(tmp, 'state');
  fs.mkdirSync(fixtures, { recursive: true });
  const registry = { competitors: [{ id: 'leafly', name: 'Leafly', watch: [{ url: 'https://www.leafly.com/deals', class: 'deals' }] }] };
  fs.writeFileSync(path.join(fixtures, 'leafly.deals.html'), V1);
  const r1 = await runOffline(fixtures, registry, state);
  assert.equal(r1.events.length, 0, 'baseline run emits nothing');
  fs.writeFileSync(path.join(fixtures, 'leafly.deals.html'), V2);
  const r2 = await runOffline(fixtures, registry, state);
  assert.equal(r2.events.length, 1);
  assert.equal(r2.events[0].source, 'Leafly');
  assert.equal(r2.events[0].triage, 'TRIAGE_REQUIRED');
});

test('live mode is double-gated: refuses without env even with --live semantics', async () => {
  delete process.env.CANA_SENTINEL_LIVE;
  await assert.rejects(() => runLive({ competitors: [] }), /CANA_SENTINEL_LIVE/);
});

test('live mode refuses robots-disallowed URLs and never fetches them', async () => {
  process.env.CANA_SENTINEL_LIVE = '1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-live-'));
  const fetched = [];
  const fakeFetch = async (url) => {
    fetched.push(String(url));
    if (String(url).endsWith('/robots.txt')) return { ok: true, text: async () => 'User-agent: *\nDisallow: /' };
    return { ok: true, status: 200, text: async () => V1 };
  };
  const registry = { competitors: [{ id: 'x', name: 'X', watch: [{ url: 'https://blocked.test/page', class: 'homepage' }] }] };
  const out = await runLive(registry, { fetchImpl: fakeFetch, gate: new HostGate(0), stateDir: path.join(tmp, 's') });
  assert.equal(out.receipts[0].action, 'REFUSED_ROBOTS');
  assert.equal(fetched.length, 1, 'only robots.txt was fetched, never the page');
  delete process.env.CANA_SENTINEL_LIVE;
});

test('committed registry loads and matches the archive plan (4 competitors, 10 watch URLs)', () => {
  const r = loadRegistry(new URL('./registry.json', import.meta.url).pathname);
  assert.equal(r.competitors.length, 4);
  assert.equal(r.competitors.flatMap((c) => c.watch).length, 10);
});
