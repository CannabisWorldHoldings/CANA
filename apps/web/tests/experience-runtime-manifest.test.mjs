import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManifest, JOURNEY_COPY } from '../src/lib/experience/manifest.mjs';
import { resolveRuntimeExperienceManifest } from '../src/lib/experience/runtime-manifest.mjs';
import { makeReceipt } from '../src/lib/cana-intelligence/receipts.mjs';
import { digest } from '../src/lib/cana-intelligence/core.mjs';

function receiptRow(receipt) {
  return {
    ...receipt,
    payloadJson: JSON.stringify(receipt.payload),
    parentDigestsJson: JSON.stringify(receipt.parentDigests),
  };
}

test('runtime Experience state falls back through the kernel and loads only exact promoted tenant state', async () => {
  const tenant = 'orderweeddc.com';
  const fallback = await resolveRuntimeExperienceManifest({
    recordStore: { findFirst: async () => null },
    tenant,
    journey: 'DELIVERY',
  });
  assert.equal(fallback.merchant.identity.tenant, tenant);
  assert.equal(fallback.presentation.copy.title, JOURNEY_COPY.DELIVERY.title);

  const promoted = buildManifest({ tenant, journey: 'DELIVERY' });
  promoted.presentation.copy.title = 'Courted delivery title';
  const manifestAfterDigest = digest(promoted, 'experience_manifest');
  const promotion = makeReceipt({
    kind: 'PROMOTION',
    subjectDigest: 'experience-candidate:courted-delivery',
    realm: 'VERIFIED_LOCAL',
    issuer: 'canonical-experience-promotion-court',
    payload: { candidateDigest: 'experience-candidate:courted-delivery', manifestAfterDigest },
  });
  promoted.promotion = {
    receiptDigest: promotion.receiptDigest,
    candidateDigest: promotion.subjectDigest,
    manifestAfterDigest,
    evidenceRealm: promotion.realm,
  };
  const loaded = await resolveRuntimeExperienceManifest({
    recordStore: { findFirst: async () => ({ bodyJson: JSON.stringify(promoted) }) },
    receiptStore: { findUnique: async () => receiptRow(promotion) },
    tenant,
    journey: 'DELIVERY',
  });
  assert.equal(loaded.presentation.copy.title, 'Courted delivery title');
});

test('runtime Experience state refuses promoted content without exact canonical receipt lineage', async () => {
  const tenant = 'orderweeddc.com';
  const manifest = buildManifest({ tenant, journey: 'DISPENSARIES' });
  const manifestAfterDigest = digest(manifest, 'experience_manifest');
  const promotion = makeReceipt({
    kind: 'PROMOTION',
    subjectDigest: 'experience-candidate:other',
    realm: 'VERIFIED_LOCAL',
    issuer: 'canonical-experience-promotion-court',
    payload: { candidateDigest: 'experience-candidate:other', manifestAfterDigest },
  });
  manifest.promotion = {
    receiptDigest: promotion.receiptDigest,
    candidateDigest: 'experience-candidate:expected',
    manifestAfterDigest,
    evidenceRealm: promotion.realm,
  };
  await assert.rejects(
    () => resolveRuntimeExperienceManifest({
      recordStore: { findFirst: async () => ({ bodyJson: JSON.stringify(manifest) }) },
      receiptStore: { findUnique: async () => receiptRow(promotion) },
      tenant,
      journey: 'DISPENSARIES',
    }),
    /receipt subject mismatch/,
  );
});

test('runtime Experience state rejects manifest content changed after candidate promotion', async () => {
  const tenant = 'orderweeddc.com';
  const manifest = buildManifest({ tenant, journey: 'SEARCH' });
  const manifestAfterDigest = digest(manifest, 'experience_manifest');
  const promotion = makeReceipt({
    kind: 'PROMOTION',
    subjectDigest: 'experience-candidate:exact-search',
    realm: 'VERIFIED_LOCAL',
    issuer: 'canonical-experience-promotion-court',
    payload: { candidateDigest: 'experience-candidate:exact-search', manifestAfterDigest },
  });
  manifest.presentation.copy.title = 'Unauthorized different presentation';
  manifest.promotion = {
    receiptDigest: promotion.receiptDigest,
    candidateDigest: promotion.subjectDigest,
    manifestAfterDigest,
    evidenceRealm: promotion.realm,
  };
  await assert.rejects(
    () => resolveRuntimeExperienceManifest({
      recordStore: { findFirst: async () => ({ bodyJson: JSON.stringify(manifest) }) },
      receiptStore: { findUnique: async () => receiptRow(promotion) },
      tenant,
      journey: 'SEARCH',
    }),
    /EXPERIENCE_RUNTIME_PROMOTION_MISMATCH/,
  );
});

test('runtime Experience state refuses cross-tenant and cross-journey records', async () => {
  const wrongTenant = buildManifest({ tenant: 'other.example', journey: 'DELIVERY' });
  await assert.rejects(
    () => resolveRuntimeExperienceManifest({ recordStore: { findFirst: async () => ({ bodyJson: JSON.stringify(wrongTenant) }) }, tenant: 'orderweeddc.com', journey: 'DELIVERY' }),
    /EXPERIENCE_RUNTIME_TENANT_MISMATCH/,
  );
  const wrongJourney = buildManifest({ tenant: 'orderweeddc.com', journey: 'SEARCH' });
  await assert.rejects(
    () => resolveRuntimeExperienceManifest({ recordStore: { findFirst: async () => ({ bodyJson: JSON.stringify(wrongJourney) }) }, tenant: 'orderweeddc.com', journey: 'DELIVERY' }),
    /EXPERIENCE_RUNTIME_JOURNEY_MISMATCH/,
  );
});
