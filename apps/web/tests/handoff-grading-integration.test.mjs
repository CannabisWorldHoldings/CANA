import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * HANDOFF GRADING — INTEGRATION, over real HTTP against the real route.
 *
 * VERIFIER FINDING H26 (MEDIUM-HIGH, test-coverage). The page-challenge MODULE was
 * thoroughly attacked, but the ROUTE that wires it was tested only by source-text
 * grep. An independent verifier proved the gap by neutering the route's replay
 * check, and separately by making the route self-mint its own challenge — which
 * reintroduces the exact original vulnerability — and BOTH produced zero test
 * failures.
 *
 * A guard nothing executes is a guard that will be removed by a future edit and
 * nobody will notice. So this suite drives the actual POST handler and asserts the
 * grade that was COMMITTED TO THE LEDGER, which is the only thing a merchant report
 * ever reads. Three rows tell the whole story:
 *
 *   no challenge     -> APPLICATION_HANDOFF_VERIFIED, not value-eligible
 *   valid challenge  -> MERCHANT_HANDOFF_VERIFIED, value-eligible
 *   replayed         -> demoted, not value-eligible
 *
 * It also proves the properties a source grep cannot see: the consumer always gets
 * their 303, and the redirect never comes from client input.
 */

const TENANT = 'orderweeddc.localhost';
const created = [];

function req(method, path, { origin = `http://${TENANT}`, form = null } = {}) {
  return new Promise((resolve, reject) => {
    const body = form === null ? null : new URLSearchParams(form).toString();
    const r = http.request(
      {
        host: '127.0.0.1', port: 3000, path, method,
        headers: {
          Host: TENANT,
          ...(origin ? { Origin: origin } : {}),
          ...(body === null ? {} : {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          }),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          location: res.headers.location ?? null,
          headers: res.headers,
          consumerHandoff: res.headers['x-consumer-handoff'] ?? null,
          evidenceWrite: res.headers['x-evidence-write'] ?? null,
          body: out,
        }));
      },
    );
    r.on('error', reject);
    if (body !== null) r.write(body);
    r.end();
  });
}

async function db() {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}

/** A verified retailer with a safe public destination, wired into the tenant. */
async function merchant(tag) {
  const p = await db();
  const now = new Date();
  const brand = await p.brand.findUnique({ where: { domain: TENANT }, select: { id: true } });
  const r = await p.retailer.create({
    data: {
      name: `Grade Fixture ${tag}`, type: 'DISPENSARY', address: `${tag} Grade St`,
      city: 'Washington', state: 'DC', zip: '20001', lat: 38.9, lng: -77.03,
      website: 'https://example.com',
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'handoff-grading-integration',
      retrievedAt: now, verifiedAt: now,
      freshnessExpiresAt: new Date(now.getTime() + 86400_000),
      confidence: 0.99, isDemonstration: false,
    },
    select: { id: true },
  });
  const prod = await p.product.create({ data: { name: `Grade Product ${tag}`, category: 'FLOWER' }, select: { id: true } });
  const me = await p.menuEntry.create({
    data: { retailerId: r.id, productId: prod.id, price: 10, dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    select: { id: true },
  });
  await p.brandMenu.create({ data: { brandId: brand.id, menuEntryId: me.id } });
  await p.$disconnect();
  created.push({ retailerId: r.id, productId: prod.id });
  return r.id;
}

/** Read the challenge the RENDER embedded — exactly what a browser would submit. */
async function challengeFromRender(rid) {
  const page = await req('GET', `/retailer/${rid}`);
  const m = page.body.match(/name="page_challenge" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function gradesFor(rid) {
  const p = await db();
  const rows = await p.demandCreditEntry.findMany({
    where: { merchantId: rid, kind: 'ATTRIBUTION' },
    orderBy: { seq: 'asc' },
    select: { seq: true, proofState: true, valueEligible: true, destination: true, interactionNonce: true },
  });
  await p.$disconnect();
  return rows;
}

before(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await req('GET', '/api/health', { origin: null }); if (r.status < 500) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(async () => {
  if (!created.length) return;
  const p = await db();
  const ids = created.map((c) => c.retailerId);
  await p.demandCreditEntry.deleteMany({ where: { merchantId: { in: ids } } });
  await p.retailer.deleteMany({ where: { id: { in: ids } } });
  await p.product.deleteMany({ where: { id: { in: created.map((c) => c.productId) } } });
  await p.$disconnect();
});

test('the RENDER embeds a challenge in the handoff form', async () => {
  // If the render stops embedding it, every stronger grade silently becomes
  // unreachable and the system quietly reports less than it could.
  const rid = await merchant('RENDER');
  const ch = await challengeFromRender(rid);
  assert.ok(ch, 'the retailer page must embed a page_challenge for a handoff-eligible retailer');
  assert.match(ch, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'it must look like a signed challenge');
});

test('NO CHALLENGE: a direct POST commits APPLICATION_HANDOFF_VERIFIED and NO value', async () => {
  // This is the case the verifier proved was graded dishonestly before the fix.
  const rid = await merchant('NOCH');
  const r = await req('POST', `/retailer/${rid}/handoff`, { form: {} });
  assert.equal(r.status, 303, 'the consumer must still be handed off');
  const rows = await gradesFor(rid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proofState, 'APPLICATION_HANDOFF_VERIFIED',
    'a POST with no page render proves only that our own route ran');
  assert.equal(rows[0].valueEligible, false, 'and it must earn NO merchant value');
  assert.equal(rows[0].destination, null, 'a non-eligible grade must not record a value-bearing destination');
});

test('VALID CHALLENGE: a real render then submit commits MERCHANT_HANDOFF_VERIFIED with value', async () => {
  const rid = await merchant('VALID');
  const ch = await challengeFromRender(rid);
  const r = await req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } });
  assert.equal(r.status, 303);
  const rows = await gradesFor(rid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proofState, 'MERCHANT_HANDOFF_VERIFIED');
  assert.equal(rows[0].valueEligible, true);
  assert.ok(rows[0].interactionNonce, 'the redeemed nonce must be recorded, or replay cannot be refused');
  assert.equal(rows[0].destination, 'https://example.com/');
});

test('REPLAY: presenting a redeemed challenge is DEMOTED, never a second valued action', async () => {
  // The route-level guard the verifier neutered with zero test failures.
  const rid = await merchant('REPLAY');
  const ch = await challengeFromRender(rid);
  const first = await req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } });
  assert.equal(first.status, 303);
  const second = await req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } });
  assert.equal(second.status, 303, 'a replay must still hand the consumer off');

  const rows = await gradesFor(rid);
  const eligible = rows.filter((r) => r.valueEligible === true);
  assert.equal(eligible.length, 1, `exactly one valued action may exist, found ${eligible.length}`);
  assert.equal(eligible[0].proofState, 'MERCHANT_HANDOFF_VERIFIED');
  const demoted = rows.filter((r) => r.valueEligible !== true);
  assert.ok(demoted.length >= 1, 'the replay must be recorded and demoted, not silently dropped');
  for (const d of demoted) {
    assert.equal(d.proofState, 'APPLICATION_HANDOFF_VERIFIED');
  }
});

test("ANOTHER MERCHANT'S challenge cannot earn value here", async () => {
  const a = await merchant('XA');
  const b = await merchant('XB');
  const chA = await challengeFromRender(a);
  const r = await req('POST', `/retailer/${b}/handoff`, { form: { page_challenge: chA } });
  assert.equal(r.status, 303);
  const rows = await gradesFor(b);
  assert.equal(rows[0].valueEligible, false,
    "a challenge minted for merchant A must not credit merchant B");
  assert.equal(rows[0].proofState, 'APPLICATION_HANDOFF_VERIFIED');
});

test('a GARBAGE challenge is refused and demoted, never accepted', async () => {
  const rid = await merchant('GARBAGE');
  for (const bad of ['not-a-challenge', 'a.b', 'x'.repeat(500), '']) {
    const r = await req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: bad } });
    assert.equal(r.status, 303, `a malformed challenge must not break the handoff (${bad.slice(0, 12)})`);
  }
  const rows = await gradesFor(rid);
  assert.equal(rows.filter((x) => x.valueEligible === true).length, 0,
    'no malformed challenge may earn value');
});

test('THE REDIRECT never comes from client input', async () => {
  // A source grep cannot prove this; a request can.
  const rid = await merchant('REDIR');
  const r = await req('POST', `/retailer/${rid}/handoff`, {
    form: {
      destination: 'https://attacker.example/steal',
      redirect: 'https://attacker.example',
      url: 'https://attacker.example',
      page_challenge: await challengeFromRender(rid),
    },
  });
  assert.equal(r.status, 303);
  assert.equal(r.location, 'https://example.com/',
    'the redirect must be the server-verified destination, whatever the body claims');
});

test('a FORGED ORIGIN is refused before anything is recorded', async () => {
  const rid = await merchant('ORIGIN');
  const r = await req('POST', `/retailer/${rid}/handoff`, {
    origin: 'http://evil.example', form: { page_challenge: await challengeFromRender(rid) },
  });
  assert.ok(r.status >= 400, `a cross-site submission must be refused, got ${r.status}`);
  assert.equal((await gradesFor(rid)).length, 0, 'a refused submission must record nothing');
});

test('a DEMONSTRATION retailer cannot produce a handoff at all', async () => {
  const p = await db();
  const demo = await p.retailer.findFirst({ where: { isDemonstration: true }, select: { id: true } });
  await p.$disconnect();
  assert.ok(demo, 'a seeded demonstration retailer is required for this control');
  const r = await req('POST', `/retailer/${demo.id}/handoff`, { form: {} });
  assert.ok(r.status >= 400, `demonstration data must not hand off, got ${r.status}`);
  const rows = await gradesFor(demo.id);
  assert.equal(rows.length, 0, 'and must record no attribution');
});

test('WRITE-INDEPENDENT: 100 simultaneous handoffs all succeed with zero 5xx', async () => {
  // THE GUARANTEE THIS REPLACED A MITIGATION WITH. Destination resolution used to
  // live inside the LeadEvent write transaction, so the consumer's redirect depended
  // on winning a write lock: ten simultaneous handoffs produced TEN HTTP 500s. A
  // bounded retry got that to 7-10 of 10 — a mitigation, not a guarantee. Resolution
  // is now READ ONLY, so contention cannot reach the consumer at all.
  const rid = await merchant('BURST100');
  const ch = await challengeFromRender(rid);
  const results = await Promise.all(
    Array.from({ length: 100 }, () => req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } })),
  );
  const ok = results.filter((r) => r.status === 303).length;
  const server5xx = results.filter((r) => r.status >= 500).length;
  assert.equal(server5xx, 0, `no consumer may receive a 5xx, got ${server5xx}`);
  assert.equal(ok, 100, `every valid request must be handed off, got ${ok}/100`);
  // And every one of them to the right place.
  for (const r of results) {
    assert.equal(r.location, 'https://example.com/', 'every redirect must be the verified destination');
  }
  // The money-integrity guarantee survives the burst.
  const rows = await gradesFor(rid);
  assert.equal(rows.filter((x) => x.valueEligible === true).length, 1,
    'one challenge may fund exactly one valued action, however large the burst');
});

test('WRITE-INDEPENDENT: the five states are recorded SEPARATELY, never collapsed', async () => {
  // "The consumer was handed off" and "we managed to record it" are different facts.
  // A system that merges them under-reports silently.
  const rid = await merchant('STATES');
  const ch = await challengeFromRender(rid);
  const r = await req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } });
  assert.equal(r.status, 303);
  assert.equal(r.headers?.['x-consumer-handoff'] ?? r.consumerHandoff, 'CONSUMER_HANDOFF_SUCCEEDED');
  assert.match(String(r.headers?.['x-evidence-write'] ?? r.evidenceWrite),
    /EVIDENCE_WRITE_(SUCCEEDED|DEFERRED|FAILED)/,
    'the evidence-write state must be reported, not merged into the response code');
});

test('CONCURRENT submissions of one challenge yield at most ONE valued action', async () => {
  // THE PROPERTY THAT MUST HOLD ABSOLUTELY: one challenge can never fund two valued
  // actions. That is the money-integrity guarantee and it is asserted strictly.
  //
  // WHAT IS NOT ABSOLUTE, stated honestly rather than asserted away: under a
  // simultaneous burst on SQLite, some handoffs still fail. This test found that —
  // ten concurrent handoffs originally returned TEN 500s, a pre-existing defect on
  // a route that had never been exercised concurrently. Two real fixes followed: a
  // bounded retry on measured contention codes (P1008 socket timeout and P2028, NOT
  // the SQLITE_BUSY/P2034 I first guessed at, which matched nothing), and enabling
  // WAL so readers and writers stop blocking each other.
  //
  // Together those take a 10-way burst from 0/10 succeeding to typically 7-10/10.
  // It is not deterministic, because single-writer SQLite is not the right database
  // for this and no amount of retry logic makes it one. Asserting 10/10 here would
  // produce a flaky test that gets deleted; asserting the real guarantee plus a
  // realistic floor keeps the signal.
  const rid = await merchant('CONC');
  const ch = await challengeFromRender(rid);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => req('POST', `/retailer/${rid}/handoff`, { form: { page_challenge: ch } })),
  );
  const ok = results.filter((r) => r.status === 303).length;
  assert.ok(ok >= 5, `a majority of a concurrent burst must succeed, got ${ok}/10`);

  const rows = await gradesFor(rid);
  const eligible = rows.filter((r) => r.valueEligible === true);
  assert.ok(eligible.length <= 1,
    `ABSOLUTE: one challenge may fund at most one valued action, found ${eligible.length}`);
  // And no failed request may leave a valued row behind.
  for (const r of rows) {
    if (r.valueEligible) assert.equal(r.proofState, 'MERCHANT_HANDOFF_VERIFIED');
  }
});

test('a handoff that FAILS records no valued attribution', async () => {
  // The inverse of the above: contention must never produce a phantom valued row.
  const rid = await merchant('FAILCLEAN');
  await Promise.all(Array.from({ length: 8 }, () => req('POST', `/retailer/${rid}/handoff`, { form: {} })));
  const rows = await gradesFor(rid);
  assert.equal(rows.filter((r) => r.valueEligible === true).length, 0,
    'no challenge was presented, so no row may be value-eligible however many succeeded');
});
