import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DATA_STATUS,
  getDataStatusPresentation,
  isPubliclyVerified,
  resolveDataStatus,
} from '../src/lib/data-status.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const asOf = new Date('2026-07-17T12:00:00.000Z');

test('demonstration data can never resolve as publicly verified', () => {
  const record = {
    dataStatus: DATA_STATUS.VERIFIED_CURRENT,
    isDemonstration: true,
    verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  assert.equal(resolveDataStatus(record, asOf), DATA_STATUS.DEMONSTRATION_ONLY);
  assert.equal(isPubliclyVerified(record, asOf), false);
  assert.match(getDataStatusPresentation(record, asOf).description, /synthetic/i);
});

test('verification requires evidence time and an unexpired freshness window', () => {
  const current = {
    dataStatus: DATA_STATUS.VERIFIED_CURRENT,
    isDemonstration: false,
    verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    freshnessExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  assert.equal(isPubliclyVerified(current, asOf), true);
  assert.equal(
    resolveDataStatus({ ...current, freshnessExpiresAt: new Date('2026-07-10T00:00:00.000Z') }, asOf),
    DATA_STATUS.STALE,
  );
  assert.equal(
    resolveDataStatus({ ...current, verifiedAt: null }, asOf),
    DATA_STATUS.AWAITING_VERIFICATION,
  );
  const futureVerification = {
    ...current,
    verifiedAt: new Date('2026-07-18T00:00:00.000Z'),
  };
  assert.equal(
    resolveDataStatus(futureVerification, asOf),
    DATA_STATUS.AWAITING_VERIFICATION,
  );
  assert.equal(isPubliclyVerified(futureVerification, asOf), false);
});

test('public source files do not reintroduce known unsupported truth claims', () => {
  const publicFiles = [
    'src/app/[domain]/layout.tsx',
    'src/app/[domain]/page.tsx',
    'src/app/[domain]/retailer/[id]/page.tsx',
    'src/app/[domain]/neighborhoods/[slug]/page.tsx',
  ];
  const forbiddenClaims = [
    /Verified Reviews/i,
    /verified results/i,
    /Map Integration Active/i,
    /Retailers are strictly verified/i,
    /All listed medical dispensaries are compliant/i,
    /real-time product menus/i,
    /Open Now/i,
  ];

  for (const relativePath of publicFiles) {
    const source = fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
    for (const forbiddenClaim of forbiddenClaims) {
      assert.doesNotMatch(source, forbiddenClaim, `${relativePath} contains ${forbiddenClaim}`);
    }
  }
});

test('the seed identifies every public catalog entity as demonstration data', () => {
  const seed = fs.readFileSync(path.join(webRoot, 'prisma/seed.mjs'), 'utf8');
  assert.match(seed, /dataStatus:\s*'DEMONSTRATION_ONLY'/);
  assert.match(seed, /isDemonstration:\s*true/);
  assert.doesNotMatch(seed, /licenseStatus:\s*'VERIFIED'/);
  assert.doesNotMatch(seed, /Math\.random/);
});
