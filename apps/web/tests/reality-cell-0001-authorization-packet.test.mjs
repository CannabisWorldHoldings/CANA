import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = path.resolve(WEB, '..', '..');
const PACKET_PATH = path.join(
  REPOSITORY,
  'docs',
  'reality-cell',
  'REALITY_CELL_0001_AUTHORIZATION_PACKET.json',
);

function packet() {
  return JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
}

test('Task 6 packet binds a real source anchor but grants no authority', () => {
  const value = packet();
  assert.match(value.canonicalSha, /^[a-f0-9]{40}$/);
  assert.match(value.canonicalTree, /^[a-f0-9]{40}$/);
  assert.equal(
    execFileSync('git', ['-C', REPOSITORY, 'rev-parse', `${value.canonicalSha}^{tree}`], {
      encoding: 'utf8',
    }).trim(),
    value.canonicalTree,
  );
  assert.equal(value.rebindRequiredAfterCanonicalPromotion, true);
  assert.equal(value.authority.ownerAuthorizationGranted, false);
  assert.equal(value.authority.merchantAuthorizationGranted, false);
  assert.equal(value.authority.executionAuthorized, false);
  assert.equal(value.authority.realWorldExecutionAllowed, false);
});

test('absent merchant consent leaves every treatment binding unestablished', () => {
  const value = packet();
  assert.equal(value.packetState, 'AWAITING_MERCHANT_AUTHORIZATION');
  assert.equal(value.namedMerchantCandidate.state, 'NOT_SELECTED');
  assert.equal(value.namedMerchantCandidate.merchantId, null);
  assert.equal(value.namedMerchantCandidate.tenantId, null);
  assert.equal(value.authorizedRepresentativeRequirement.currentEvidence, 'ABSENT');
  assert.ok(Object.values(value.bindings).every((binding) => binding === null));
  assert.equal(value.maxExposure, 0);
  assert.deepEqual(value.allowedSurfaces, ['ISOLATED_PRIVATE_PREVIEW']);
});

test('packet preserves the zero-effect and bounded-claim laws', () => {
  const value = packet();
  for (const effect of [
    'PRODUCTION_DEPLOYMENT',
    'DNS_CHANGE',
    'PRODUCTION_DATABASE_WRITE',
    'CUSTOMER_EXPOSURE',
    'MERCHANT_TREATMENT',
    'OUTREACH',
    'PAYMENT_ACTIVATION',
    'AD_SPEND',
  ]) {
    assert.ok(value.prohibitedEffects.includes(effect));
  }
  assert.equal(value.claimCeiling, 'CAPABILITY_READINESS_ONLY');
  assert.equal(value.measurementPlan.assignmentNotExposure, true);
  assert.equal(value.measurementPlan.exposureNotOutcome, true);
  assert.equal(value.measurementPlan.outcomeNotCausation, true);
  assert.equal(value.measurementPlan.syntheticEvidenceMayEnterRealSettlement, false);
  assert.deepEqual(value.effects, {
    realCustomerExposure: 0,
    realMerchantExposure: 0,
    productionEffects: 0,
    spendUsd: 0,
  });
});
