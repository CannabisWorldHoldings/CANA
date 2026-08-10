import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TenantBoundaryError,
  tenantRetailerWhere,
} from '../src/lib/tenant-retailer.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T20:00:00.000Z');

test('tenant retailer predicate requires both the retailer ID and brand membership', () => {
  assert.deepEqual(tenantRetailerWhere('brand-one', 'retailer-one', AS_OF), {
    id: 'retailer-one',
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
    menus: {
      some: {
        brandMenus: {
          some: {
            brandId: 'brand-one',
          },
        },
      },
    },
  });
});

test('tenant boundary identifiers reject malformed or oversized input', () => {
  for (const [brandId, retailerId] of [
    [null, 'retailer-one'],
    ['brand-one', null],
    ['../brand', 'retailer-one'],
    ['brand-one', 'retailer/one'],
    ['x'.repeat(65), 'retailer-one'],
  ]) {
    assert.throws(
      () => tenantRetailerWhere(brandId, retailerId),
      TenantBoundaryError,
    );
  }
});

test('retailer profile, metadata, handoff, and correction mutations share the tenant predicate', () => {
  const detailSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/retailer/[id]/page.tsx'),
    'utf8',
  );
  const handoffSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/handoff.mjs'),
    'utf8',
  );
  const correctionSource = fs.readFileSync(
    path.join(
      webRoot,
      'src/app/[domain]/retailer/[id]/correction/page.tsx',
    ),
    'utf8',
  );
  const correctionRouteSource = fs.readFileSync(
    path.join(
      webRoot,
      'src/app/[domain]/retailer/[id]/correction/submission/route.ts',
    ),
    'utf8',
  );
  const publicMutationSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/public-submission-mutations.mjs'),
    'utf8',
  );

  assert.equal((detailSource.match(/tenantRetailerWhere\(/g) ?? []).length, 2);
  assert.equal((handoffSource.match(/tenantRetailerWhere\(/g) ?? []).length, 1);
  assert.equal((correctionSource.match(/tenantRetailerWhere\(/g) ?? []).length, 2);
  assert.equal(
    (publicMutationSource.match(/tenantRetailerWhere\(/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(detailSource, /retailer\.findUnique/);
  assert.doesNotMatch(handoffSource, /retailer\.findUnique/);
  assert.doesNotMatch(correctionSource, /retailer\.findUnique/);
  assert.doesNotMatch(publicMutationSource, /retailer\.findUnique/);
  assert.match(
    // The security property is that the retailer lookup is SCOPED BY THE TENANT
    // PREDICATE — not that it sits inside a transaction. Handoff resolution is now a
    // read outside any transaction, deliberately: keeping it inside one made a
    // consumer's redirect depend on a write lock and produced ten HTTP 500s from ten
    // simultaneous handoffs. The predicate is unchanged, so the tenant boundary is
    // unchanged; only the transaction wrapper went away.
    handoffSource,
    /retailer\.findFirst\(\{\s*where: tenantRetailerWhere\(brandId, retailerId, asOf\)/,
  );
  assert.match(
    publicMutationSource,
    /transaction\.retailer\.findFirst\(\{\s*where: tenantRetailerWhere\(brandId, retailerId\)/,
  );
  assert.match(
    correctionRouteSource,
    /submitRetailerCorrection\(prisma,\s*\{\s*brandId: brand\.id,\s*retailerId: id,/,
  );
});
