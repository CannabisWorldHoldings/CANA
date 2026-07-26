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

function fakeDb(retailer, { failWrite = false } = {}) {
  let events = [];
  let capturedWhere = null;

  return {
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

  assert.deepEqual(result, {
    destination: 'https://retailer.example/menu',
    eventId: 'event-1',
  });
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

test('lead write failure rolls back the handoff transaction', async () => {
  const db = fakeDb(verifiedRetailer(), { failWrite: true });
  await assert.rejects(
    recordVerifiedHandoff(db, {
      brandId: 'brand-one',
      retailerId: 'retailer-one',
      asOf: AS_OF,
    }),
    /Injected event write failure/,
  );
  assert.deepEqual(db.snapshot(), []);
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
  assert.match(routeSource, /recordVerifiedHandoff\(prisma/);
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
