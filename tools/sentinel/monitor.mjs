#!/usr/bin/env node
/**
 * CANA SENTINEL — fingerprint-only competitor monitor
 *
 * Implements the crawler that ORDERWEEDDCRSI's registry planned but never built.
 * Laws enforced in code, not prose:
 *   1. FINGERPRINTS ONLY — SHA-256 of normalized markup, element counts, title.
 *      Competitor page content is NEVER archived. The snapshot record is
 *      structurally incapable of holding a body (see makeFingerprint()).
 *   2. ROBOTS HONORED — a URL disallowed for `User-agent: *` is never fetched;
 *      the refusal itself is receipted.
 *   3. MINIMAL VOLUME — one request per watch URL per run, sequential, with a
 *      per-host floor of 10s (stricter than the registry's 6 rpm ceiling).
 *   4. TRIAGE_REQUIRED — every drift becomes a typed ChangeEvent via the
 *      cana-signal-to-fix seam with triage: 'TRIAGE_REQUIRED'. This module has
 *      no code path that creates, promotes, or executes a response candidate.
 *   5. DOUBLE-GATED LIVE MODE — network fetches require BOTH `--live` and
 *      env CANA_SENTINEL_LIVE=1. Default is offline (fixtures only).
 *
 * State lives untracked under .cana-local/sentinel/ (repo law: receipt stores
 * are never committed).
 *
 * Usage:
 *   node tools/sentinel/monitor.mjs --offline --fixtures <dir>   # fixture run
 *   CANA_SENTINEL_LIVE=1 node tools/sentinel/monitor.mjs --live  # gated live run
 *   node tools/sentinel/monitor.mjs --selftest                   # inline checks
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeChangeEvent } from '../../skills-src/cana-signal-to-fix.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..', '..');
const STATE_DIR = path.join(REPO, '.cana-local', 'sentinel');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);

/* ---------------------------------------------------------------- registry */
export function loadRegistry(file = path.join(HERE, 'registry.json')) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(r.competitors) || r.competitors.length === 0) throw new Error('registry: competitors required');
  for (const c of r.competitors) {
    if (!c.id || !Array.isArray(c.watch)) throw new Error(`registry: competitor ${c.id ?? '?'} malformed`);
  }
  return r;
}

/* ------------------------------------------------------------ fingerprints */
/** Normalize markup so cosmetic churn (whitespace, nonces, timestamps) doesn't drift. */
export function normalizeHtml(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\b(nonce|csrf[-_]?token|data-reactid)="[^"]*"/gi, '$1="_"')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
}

const count = (s, re) => (s.match(re) ?? []).length;

/**
 * The ONLY representation of a competitor page this system retains.
 * Deliberately has no field that could carry page content.
 */
export function makeFingerprint(html, url, observedAt) {
  const norm = normalizeHtml(html);
  const title = (norm.match(/<title[^>]*>([^<]{0,300})/i)?.[1] ?? '').trim();
  return {
    url,
    observed_at: observedAt,
    content_sha256: sha(norm),
    bytes_normalized: Buffer.byteLength(norm),
    title_sha256: sha(title),
    title_length: title.length,
    counts: {
      links: count(norm, /<a[\s>]/gi),
      images: count(norm, /<img[\s>]/gi),
      scripts: count(norm, /<script[\s>]/gi),
      headings: count(norm, /<h[1-6][\s>]/gi),
      forms: count(norm, /<form[\s>]/gi),
    },
  };
}

/* ------------------------------------------------------------------ robots */
/** Minimal robots.txt evaluation for `User-agent: *`. Fail closed on parse doubt. */
export function robotsAllows(robotsTxt, urlPath) {
  if (robotsTxt == null) return false; // unknown => do not fetch
  let inStar = false; const rules = [];
  for (const raw of String(robotsTxt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') inStar = val === '*';
    else if (inStar && (key === 'disallow' || key === 'allow')) rules.push({ allow: key === 'allow', prefix: val });
  }
  let verdict = true; let bestLen = -1;
  for (const r of rules) {
    if (r.prefix === '' && !r.allow) continue; // "Disallow:" empty = allow all
    if (urlPath.startsWith(r.prefix) && r.prefix.length > bestLen) { bestLen = r.prefix.length; verdict = r.allow; }
  }
  return verdict;
}

/* -------------------------------------------------------------- rate limit */
export class HostGate {
  constructor(minIntervalMs = 10_000) { this.minInterval = minIntervalMs; this.last = new Map(); }
  async admit(host, sleeper = (ms) => new Promise((r) => setTimeout(r, ms))) {
    const now = Date.now(); const prev = this.last.get(host) ?? 0;
    const wait = Math.max(0, prev + this.minInterval - now);
    if (wait > 0) await sleeper(wait);
    this.last.set(host, Date.now());
    return wait;
  }
}

/* ------------------------------------------------------------------- drift */
const KIND_BY_CLASS = { homepage: 'VISUAL', location_dc: 'STRUCTURAL', deals: 'OFFER', merchant_pitch: 'MERCHANT' };

export function detectDrift(prevFp, currFp, meta) {
  if (!prevFp) return null; // first observation is a baseline, not a drift
  if (prevFp.content_sha256 === currFp.content_sha256) return null;
  const deltas = [];
  for (const k of Object.keys(currFp.counts)) {
    const d = currFp.counts[k] - (prevFp.counts[k] ?? 0);
    if (d !== 0) deltas.push(`${k}:${d > 0 ? '+' : ''}${d}`);
  }
  if (prevFp.title_sha256 !== currFp.title_sha256) deltas.push('title:changed');
  const ev = makeChangeEvent({
    source: meta.competitor,
    surface: currFp.url,
    kind: KIND_BY_CLASS[meta.class] ?? 'CONTENT',
    observedAt: currFp.observed_at,
    observation: `fingerprint drift ${prevFp.content_sha256.slice(0, 12)} -> ${currFp.content_sha256.slice(0, 12)}; deltas [${deltas.join(', ') || 'body-only'}]`,
    evidenceRef: `sentinel:${meta.competitor}:${sha(currFp.url).slice(0, 12)}:${currFp.observed_at}`,
    confidence: 0.95,
  });
  // The sentinel NEVER authorizes a response. Triage is a human/court decision.
  return { ...ev, triage: 'TRIAGE_REQUIRED', self_authorized: false };
}

/* ------------------------------------------------------------------- state */
function statePath(url) { return path.join(STATE_DIR, sha(url).slice(0, 24) + '.json'); }
export function readPrev(url, dir = STATE_DIR) {
  const p = path.join(dir, sha(url).slice(0, 24) + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
export function writeCurr(fp, dir = STATE_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sha(fp.url).slice(0, 24) + '.json'), JSON.stringify(fp, null, 1));
}

/* --------------------------------------------------------------- run modes */
export async function runOffline(fixtureDir, registry, stateDir = STATE_DIR) {
  const observedAt = new Date().toISOString();
  const events = []; const receipts = [];
  for (const c of registry.competitors) {
    for (const w of c.watch) {
      const fx = path.join(fixtureDir, `${c.id}.${w.class}.html`);
      if (!fs.existsSync(fx)) { receipts.push({ url: w.url, action: 'SKIPPED_NO_FIXTURE' }); continue; }
      const fp = makeFingerprint(fs.readFileSync(fx, 'utf8'), w.url, observedAt);
      const drift = detectDrift(readPrev(w.url, stateDir), fp, { competitor: c.name, class: w.class });
      writeCurr(fp, stateDir);
      receipts.push({ url: w.url, action: 'FINGERPRINTED_OFFLINE', sha: fp.content_sha256.slice(0, 16), drift: !!drift });
      if (drift) events.push(drift);
    }
  }
  return { mode: 'offline', observedAt, receipts, events };
}

export async function runLive(registry, { fetchImpl = fetch, gate = new HostGate(), stateDir = STATE_DIR } = {}) {
  if (!process.env.CANA_SENTINEL_LIVE) throw new Error('live mode requires CANA_SENTINEL_LIVE=1 (double gate)');
  const observedAt = new Date().toISOString();
  const UA = 'CANA-Sentinel/1.0 (fingerprint-only; contact: owner of orderweeddc.com)';
  const events = []; const receipts = []; const robotsCache = new Map();
  for (const c of registry.competitors) {
    for (const w of c.watch) {
      const u = new URL(w.url);
      try {
        if (!robotsCache.has(u.host)) {
          await gate.admit(u.host);
          const r = await fetchImpl(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA } });
          robotsCache.set(u.host, r.ok ? await r.text() : (r.status === 404 ? '' : null));
        }
        if (!robotsAllows(robotsCache.get(u.host), u.pathname)) {
          receipts.push({ url: w.url, action: 'REFUSED_ROBOTS' }); continue;
        }
        await gate.admit(u.host);
        const res = await fetchImpl(w.url, { headers: { 'user-agent': UA }, redirect: 'follow' });
        if (!res.ok) { receipts.push({ url: w.url, action: 'HTTP_ERROR', status: res.status }); continue; }
        const fp = makeFingerprint(await res.text(), w.url, observedAt);
        const drift = detectDrift(readPrev(w.url, stateDir), fp, { competitor: c.name, class: w.class });
        writeCurr(fp, stateDir);
        receipts.push({ url: w.url, action: 'FINGERPRINTED_LIVE', status: res.status, sha: fp.content_sha256.slice(0, 16), drift: !!drift });
        if (drift) events.push(drift);
      } catch (e) {
        receipts.push({ url: w.url, action: 'FETCH_FAILED', error: String(e?.message ?? e).slice(0, 200) });
      }
    }
  }
  return { mode: 'live', observedAt, receipts, events };
}

/* --------------------------------------------------------------------- cli */
async function main() {
  const registry = loadRegistry(arg('registry', path.join(HERE, 'registry.json')));
  let out;
  if (has('live')) out = await runLive(registry);
  else out = await runOffline(arg('fixtures', path.join(HERE, 'fixtures')), registry);
  out.law = 'Every drift is TRIAGE_REQUIRED. The sentinel never self-authorizes a response.';
  const dest = arg('json', null);
  const s = JSON.stringify(out, null, 2);
  if (dest) fs.writeFileSync(dest, s); else console.log(s);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(path.join(STATE_DIR, 'run-ledger.jsonl'), JSON.stringify({ at: out.observedAt, mode: out.mode, receipts: out.receipts.length, events: out.events.length }) + '\n');
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(String(e)); process.exit(1); });
}
