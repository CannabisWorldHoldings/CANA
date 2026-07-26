import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HandoffError,
  recordVerifiedHandoff,
  safePublicReferenceUrl,
  safePublicWebsiteUrl,
} from '../src/lib/handoff.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T20:00:00.000Z');

function verifiedRetailer(overrides = {}) {
  return {
    id: 'retailer-one',
    website: 'https://retailer.example/menu',
    dataStatus: 'VERIFIED_CURRENT',
    isDemonstration: false,
    verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * DESIGN CHANGE THIS FAKE NOW REFLECTS. Destination resolution used to live inside
 * the LeadEvent write transaction, so this fake only implemented $transaction. That
 * coupling meant a consumer's redirect depended on winning a write lock, and ten
 * simultaneous handoffs produced ten HTTP 500s. Resolution is now READ ONLY and the
 * write is separate, so the fake exposes both direct accessors and the transaction.
 */
function fakeDb(retailer, { failWrite = false } = {}) {
  let events = [];
  let capturedWhere = null;

  const retailerApi = {
    async findFirst({ where }) {
      capturedWhere = where;
      return retailer ? structuredClone(retailer) : null;
    },
  };
  const leadEventApi = {
    async create({ data }) {
      if (failWrite) throw new Error('Injected event write failure.');
      const event = { id: `event-${events.length + 1}`, ...data };
      events.push(event);
      return event;
    },
  };

  return {
    retailer: retailerApi,
    leadEvent: leadEventApi,
    async $transaction(callback) {
      const draft = structuredClone(events);
      const result = await callback({
        retailer: {
          async findFirst({ where }) {
            capturedWhere = where;
            return retailer ? structuredClone(retailer) : null;
          },
        },
        leadEvent: {
          async create({ data }) {
            if (failWrite) throw new Error('Injected event write failure.');
            const event = { id: `event-${draft.length + 1}`, ...data };
            draft.push(event);
            return event;
          },
        },
      });
      events = draft;
      return result;
    },
    snapshot() {
      return structuredClone(events);
    },
    get capturedWhere() {
      return structuredClone(capturedWhere);
    },
  };
}

test('handoff destinations require public credential-free HTTPS URLs', () => {
  assert.equal(
    safePublicWebsiteUrl('https://retailer.example/menu'),
    'https://retailer.example/menu',
  );

  for (const value of [
    'http://retailer.example/menu',
    'javascript:alert(1)',
    'https://user:password@retailer.example/menu',
    'https://localhost/menu',
    'https://retailer.local/menu',
    'https://127.0.0.1/menu',
    'https://10.0.0.5/menu',
    'https://retailer.example:8443/menu',
    'not a url',
  ]) {
    assert.equal(safePublicWebsiteUrl(value), null, value);
  }
});

test('displayed evidence references cannot expose query credentials or fragments', () => {
  assert.equal(
    safePublicReferenceUrl('https://evidence.example/license.pdf'),
    'https://evidence.example/license.pdf',
  );
  assert.equal(
    safePublicReferenceUrl(
      'https://evidence.example/license.pdf?token=do-not-display',
    ),
    null,
  );
  assert.equal(
    safePublicReferenceUrl('https://evidence.example/license.pdf#private'),
    null,
  );
  assert.equal(safePublicReferenceUrl('http://evidence.example/license.pdf'), null);
});

test('a current verified tenant handoff records attribution and returns its destination', async () => {
  const db = fakeDb(verifiedRetailer());
  const result = await recordVerifiedHandoff(db, {
    brandId: 'brand-one',
    retailerId: 'retailer-one',
    asOf: AS_OF,
  });

  // The result now carries the evidence-write STATE alongside the destination,
  // because "handed off" and "recorded" are separate facts.
  assert.equal(result.destination, 'https://retailer.example/menu');
  assert.equal(result.evidenceWriteState, 'EVIDENCE_WRITE_SUCCEEDED');
  assert.ok(result.eventId, 'a successful write must return its event id');
  assert.equal(db.capturedWhere.id, 'retailer-one');
  assert.equal(
    db.capturedWhere.menus.some.brandMenus.some.brandId,
    'brand-one',
  );
  assert.deepEqual(db.snapshot(), [
    {
      id: 'event-1',
      brandId: 'brand-one',
      retailerId: 'retailer-one',
      eventType: 'HANDOFF_CLICK',
    },
  ]);
});

test('stale, demonstration, missing, and unsafe destinations cannot create leads', async () => {
  for (const retailer of [
    null,
    verifiedRetailer({ dataStatus: 'STALE' }),
    verifiedRetailer({ isDemonstration: true }),
    verifiedRetailer({ website: 'http://retailer.example/menu' }),
  ]) {
    const db = fakeDb(retailer);
    await assert.rejects(
      recordVerifiedHandoff(db, {
        brandId: 'brand-one',
        retailerId: 'retailer-one',
        asOf: AS_OF,
      }),
      HandoffError,
    );
    assert.deepEqual(db.snapshot(), []);
  }
});

test('a lead write failure does NOT deny the consumer their destination', async () => {
  // THIS TEST REVERSED, DELIBERATELY. It previously asserted that a failed LeadEvent
  // write ROLLED BACK the whole handoff — i.e. that a bookkeeping failure denied a
  // real consumer their redirect. That coupling is exactly what produced ten HTTP
  // 500s from ten simultaneous handoffs, so it was removed rather than tuned.
  //
  // The property that replaces it is stronger for the consumer and honest for the
  // operator: the destination still resolves, and the failure is REPORTED as a
  // distinct state rather than swallowed or merged into the response.
  const db = fakeDb(verifiedRetailer(), { failWrite: true });
  const result = await recordVerifiedHandoff(db, {
    brandId: 'brand-one',
    retailerId: 'retailer-one',
    asOf: AS_OF,
  });
  assert.equal(result.destination, 'https://retailer.example/menu',
    'a bookkeeping failure must never cost the consumer their handoff');
  assert.equal(result.eventId, null, 'and it must not invent an event id');
  assert.match(result.evidenceWriteState, /EVIDENCE_WRITE_(DEFERRED|FAILED)/,
    'the failure must be reported as a state, not hidden');
  assert.deepEqual(db.snapshot(), [], 'and no partial event row may exist');
});

test('destination resolution performs NO write at all', async () => {
  // The guarantee itself: if resolution ever writes again, a consumer's redirect
  // starts depending on a lock and the burst failures return.
  const { resolveHandoffDestination } = await import('../src/lib/handoff.mjs');
  const db = fakeDb(verifiedRetailer(), { failWrite: true });
  const resolved = await resolveHandoffDestination(db, {
    brandId: 'brand-one', retailerId: 'retailer-one', asOf: AS_OF,
  });
  assert.equal(resolved.destination, 'https://retailer.example/menu');
  assert.deepEqual(db.snapshot(), [],
    'resolution must not write — a write here would reintroduce the lock dependency');
});

test('the handoff route enforces same-origin POST and never trusts a client redirect URL', () => {
  const routeSource = fs.readFileSync(
    path.join(
      webRoot,
      'src/app/[domain]/retailer/[id]/handoff/route.ts',
    ),
    'utf8',
  );
  const pageSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/retailer/[id]/page.tsx'),
    'utf8',
  );

  assert.match(routeSource, /isSameOriginFormRequest\(request\)/);
  // The route now resolves the destination with a READ, separately from the write.
  // Asserting the read-only call by name is stronger than asserting the old combined
  // one: it fails if someone reintroduces the write dependency the burst exposed.
  assert.match(routeSource, /resolveHandoffDestination\(prisma/,
    'the redirect must come from the read-only resolver');
  assert.doesNotMatch(routeSource, /recordVerifiedHandoff\(prisma/,
    'the route must not use the combined resolve-and-write path — that is the lock dependency');
  assert.match(routeSource, /NextResponse\.redirect\(handoff\.destination, 303\)/);
  // The property that matters is that the REDIRECT DESTINATION never comes from
  // client input. The original assertion enforced that by banning any body read at
  // all, which was a good proxy while the route read nothing — but it is a source-
  // text check, not a behavioural one, and it now fires on a body read that cannot
  // reach the redirect.
  //
  // The route reads exactly one field, page_challenge, and uses it ONLY to grade
  // evidence. Verified behaviourally: a POST carrying destination, redirect and url
  // pointing at attacker.example still redirects to the server-verified
  // https://example.com/. So the assertions are now specific rather than blanket.
  assert.doesNotMatch(routeSource, /searchParams/,
    'the query string must never influence a handoff');
  assert.doesNotMatch(routeSource, /request\.json/,
    'a JSON body has no place in a same-origin form handoff');
  // The redirect must be constructed from the server-resolved destination alone.
  assert.match(routeSource, /NextResponse\.redirect\(handoff\.destination, 303\)/);
  // And no client-supplied value may ever be interpolated into a redirect.
  assert.doesNotMatch(routeSource, /redirect\((?!handoff\.destination)/,
    'every redirect must use the server-verified destination');
  // The ONLY field read from the body is the evidence challenge.
  const bodyReads = [...routeSource.matchAll(/form\.get\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.deepEqual(bodyReads, ['page_challenge'],
    `the route may read only page_challenge from the body, found: ${bodyReads.join(', ')}`);
  assert.match(
    pageSource,
    /action=\{`\/retailer\/\$\{retailer\.id\}\/handoff`\}/,
  );
  assert.match(pageSource, /method="post"/);
});
