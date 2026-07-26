import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * RELEASE GATE — a sweep across the LIVE public surface.
 *
 * The existing security suites reason about policy: host allowlists, header
 * configuration, throttle rules, dependency locks. They are good, and they are all
 * static — they inspect configuration and pure functions. None of them makes a
 * request to a running server, and none of them knew the v1 endpoints or the
 * merchant Growth OS existed.
 *
 * That is the shape of a real release risk: a new route ships correct in its own
 * contract suite while silently sitting outside every security suite. Nobody
 * notices, because both suites are green.
 *
 * This gate is deliberately DIFFERENT in kind. It enumerates the public surface
 * and asserts invariants that must hold for EVERY route, so a route added later
 * either satisfies them or fails here. It is a release gate, not a feature test:
 *
 *   G1  No route leaks a stack trace, file path, or internal identifier.
 *   G2  No route serves demonstration data as though it were real.
 *   G3  Every authenticated surface refuses an anonymous caller WITHOUT leaking
 *       the data it protects.
 *   G4  Every unknown tenant is refused, on every route.
 *   G5  No route echoes an attacker-controlled string unescaped.
 *   G6  Truth-bearing API routes are never cached.
 *   G7  No route claims a commercial outcome it cannot evidence.
 */

const TENANT = 'orderweeddc.localhost';

function req(method, path, { host = TENANT, body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path, method,
        headers: {
          Host: host, ...headers,
          ...(payload === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: out,
          json: () => { try { return JSON.parse(out); } catch { return null; } },
        }));
      },
    );
    r.on('error', reject);
    if (payload !== null) r.write(payload);
    r.end();
  });
}

/** The public surface this gate governs. Adding a route means adding it here. */
const API_ROUTES = [
  { path: '/api/health', method: 'GET', truthBearing: false },
  { path: '/api/v1/retailers', method: 'GET', truthBearing: true },
  { path: '/api/v1/deals', method: 'GET', truthBearing: true },
  { path: '/api/v1/attribution', method: 'POST', truthBearing: true, body: { retailer_id: 'x', action_kind: 'PHONE_CLICK' } },
];

const PAGE_ROUTES = ['/', '/products', '/deals', '/compare', '/strains', '/neighborhoods',
                     '/education', '/help', '/legal', '/pricing', '/wallet'];

/** Surfaces that must never serve an anonymous caller. */
const AUTHENTICATED_ROUTES = ['/business/dashboard', '/business/growth', '/admin', '/admin/site-intelligence'];

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
});

test('G1: no API route leaks a stack trace, file path, or internal identifier', async () => {
  // Malformed input is the usual way an internal detail escapes.
  const probes = [
    { path: '/api/v1/retailers?page=%00&pageSize=[]', method: 'GET' },
    { path: '/api/v1/deals?pageSize=NaN&page=1e999', method: 'GET' },
    { path: '/api/v1/attribution', method: 'POST', body: '{"broken' },
    { path: '/api/v1/attribution', method: 'POST', body: { retailer_id: { $ne: null }, action_kind: [] } },
  ];
  for (const p of probes) {
    const r = await req(p.method, p.path, { body: p.body ?? null });
    assert.ok(!/ {4}at .*\(.*:\d+:\d+\)/.test(r.body), `${p.path} leaked a stack frame`);
    assert.ok(!/\/agent\/workspace|node_modules|\.next\/server/.test(r.body), `${p.path} leaked a filesystem path`);
    assert.ok(!/PrismaClient|prisma\.|SqliteError|SQLITE_/i.test(r.body), `${p.path} leaked an ORM or driver detail`);
  }
});

test('G2: no truth-bearing route serves demonstration data', async () => {
  // Every seeded retailer is demonstration data, so any published record here
  // would be a leak. This is the invariant the whole system rests on.
  for (const route of API_ROUTES.filter((r) => r.truthBearing && r.method === 'GET')) {
    const r = await req('GET', `${route.path}?pageSize=50`);
    assert.equal(r.status, 200, `${route.path} should answer 200`);
    const b = r.json();
    assert.ok(Array.isArray(b.data), `${route.path} must expose a data array`);
    for (const rec of b.data) {
      const demo = rec.provenance?.is_demonstration ?? rec.is_demonstration;
      assert.notEqual(demo, true, `${route.path} published a demonstration record`);
    }
    // And the seeded names must not appear anywhere in the payload.
    assert.ok(!/Demo Retailer (Alpha|Beta|Gamma|Delta|Epsilon)/.test(r.body),
      `${route.path} leaked a seeded demonstration record`);
  }
});

test('G3: every authenticated surface refuses anonymous access without leaking', async () => {
  for (const path of AUTHENTICATED_ROUTES) {
    const r = await req('GET', path);
    assert.ok([301, 302, 303, 307, 308, 401, 403, 404].includes(r.status),
      `${path} answered ${r.status} to an anonymous caller`);
    // A redirect that still renders the protected content is the classic mistake.
    assert.ok(!/cost per action|Attributed actions|WITHHELD|credits_spent|Visibility completeness/i.test(r.body),
      `${path} leaked merchant figures to an anonymous caller`);
    // Look for the CONTENT, not the route name. My first version matched
    // "site-intelligence" and failed on Next's router segment payload, which
    // echoes the requested path — the route's own name, not leaked data. A test
    // that fires on a route's name would fail forever without a real defect,
    // and the noise would eventually get the whole gate disabled.
    assert.ok(!/Mechanism Matrix|COMPETITOR_MECHANISM|mechanism_id|Signal-to-Fix/i.test(r.body),
      `${path} leaked internal intelligence CONTENT to an anonymous caller`);
    // Nor may a protected page ship real record data in its payload.
    assert.ok(!/"licenseNumber"|"evidenceChain"|"entryHash"|dataSource":"/i.test(r.body),
      `${path} leaked database field values to an anonymous caller`);
  }
});

test('G4: every API route refuses an unknown tenant', async () => {
  for (const route of API_ROUTES) {
    if (route.path === '/api/health') continue; // infrastructure, deliberately host-agnostic
    const r = await req(route.method, route.path, {
      host: 'not-a-configured-host.localhost', body: route.body ?? null,
    });
    assert.equal(r.status, 421, `${route.path} answered ${r.status} for an unknown tenant`);
    assert.ok(!/"data":\s*\[\s*\{/.test(r.body), `${route.path} returned records to an unknown tenant`);
  }
});

test('G4b: authority tricks in the Host header do not resolve to a tenant', async () => {
  const tricks = [
    'orderweeddc.localhost.evil.com', 'evil.com#orderweeddc.localhost',
    'orderweeddc.localhost.', 'ORDERWEEDDC.LOCALHOST.evil.com',
    'xn--orderweeddc-localhost', '127.0.0.1', 'localhost',
  ];
  for (const host of tricks) {
    const r = await req('GET', '/api/v1/retailers', { host });
    assert.notEqual(r.status, 200, `Host "${host}" was accepted as a tenant`);
  }
});

test('G5: no route echoes an attacker-controlled string unescaped', async () => {
  const payloads = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '</script><script>x</script>'];
  for (const p of payloads) {
    const enc = encodeURIComponent(p);
    for (const path of ['/api/v1/retailers?page=', '/api/v1/deals?pageSize=']) {
      const r = await req('GET', path + enc);
      assert.ok(!r.body.includes('<script>'), `${path} echoed a raw script tag`);
      assert.ok(!r.body.includes('onerror='), `${path} echoed a raw event handler`);
    }
    // And on a rendered page.
    const page = await req('GET', `/products?q=${enc}`);
    assert.ok(!page.body.includes('<script>alert(1)</script>'), 'a page echoed a raw script tag');
  }
});

test('G6: truth-bearing API routes are never cached', async () => {
  // A cached freshness claim is a stale freshness claim.
  for (const route of API_ROUTES.filter((r) => r.truthBearing)) {
    const r = await req(route.method, route.path, { body: route.body ?? null });
    const cc = String(r.headers['cache-control'] ?? '');
    assert.match(cc, /no-store/, `${route.path} is cacheable: cache-control=${cc}`);
  }
});

test('G7: no route claims a commercial outcome it cannot evidence', async () => {
  const forbidden = /\b(guaranteed|guarantee|ROI\b|conversion lift|more customers|increase sales|boost traffic|proven results)\b/i;
  for (const route of API_ROUTES.filter((r) => r.method === 'GET')) {
    const r = await req('GET', route.path);
    // not_claimed lists these words legitimately, so strip that block first.
    const stripped = r.body.replace(/"(not_claimed|why_two_time_boundaries|means|disclaimer|note)":\s*(\[[^\]]*\]|"[^"]*")/g, '');
    const m = stripped.match(forbidden);
    assert.equal(m, null, `${route.path} claims an outcome: ${m?.[0]}`);
  }
  for (const path of PAGE_ROUTES) {
    const r = await req('GET', path);
    const m = r.body.match(/\b(guaranteed ranking|guaranteed traffic|guaranteed sales|proven ROI)\b/i);
    assert.equal(m, null, `${path} claims an outcome: ${m?.[0]}`);
  }
});

test('G8: every public page renders without a server error', async () => {
  // A release gate must notice a 500 on a page nobody tested this cycle.
  for (const path of PAGE_ROUTES) {
    const r = await req('GET', path);
    assert.ok(r.status < 500, `${path} answered ${r.status}`);
  }
});

test('G9: security headers are present on the live surface, not just in config', async () => {
  // The existing suite asserts the POLICY. This asserts the SERVER applies it.
  const r = await req('GET', '/');
  const h = r.headers;
  assert.ok(h['x-content-type-options'], 'x-content-type-options missing on the live response');
  assert.equal(String(h['x-content-type-options']).toLowerCase(), 'nosniff');
  assert.ok(h['referrer-policy'], 'referrer-policy missing on the live response');
  assert.ok(!('x-powered-by' in h), 'x-powered-by should not advertise the framework');
});

test('G10: the surface inventory is COMPLETE — a new route cannot escape this gate', async () => {
  // If a route exists on disk but is not listed above, this gate would not govern
  // it, which is exactly how the v1 endpoints ended up outside every security
  // suite. Enumerate from the filesystem and compare.
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const found = [];
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${e}`);
      // VERIFIER FINDING III1 (HIGH, test-coverage). This matched ONLY 'route.ts'.
      // Next's pageExtensions default is ['tsx','ts','jsx','js'] (verified in
      // next/dist/server/config-shared.js), so route.js, route.jsx and route.tsx
      // are all valid Route Handlers — three of four extensions escaped the gate
      // whose entire stated purpose is that a new route CANNOT escape.
      //
      // Measured honestly: in THIS app a route.js and a route.tsx both 404 today,
      // so it was not a live leak. But a gate that is narrower than the framework
      // it governs is a gate that will silently stop governing the moment someone
      // adds a handler in a permitted extension. The whole value of G10 is that it
      // fails when the surface grows past it.
      else if (/^route\.(?:m|c)?[jt]sx?$/.test(e)) found.push(prefix || '/');
    }
  };
  walk('src/app/api', '/api');
  const governed = new Set(API_ROUTES.map((r) => r.path));
  const ungoverned = found.filter((p) => !governed.has(p));
  assert.deepEqual(ungoverned, [],
    `these API routes exist but are not governed by this release gate: ${ungoverned.join(', ')}`);
});
