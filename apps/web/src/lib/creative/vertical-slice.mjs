/**
 * SiteMind House-Banner Controlled Vertical Slice
 * Runs the controlled end-to-end learning loop for House Banners with tenant isolation.
 */

import { ingestCreativeEvidence } from './source-ingestor.mjs';
import { runRecursiveLearningCycle } from './learning-loop.mjs';

export async function runFirstControlledVerticalSlice(tenantId = 'orderweeddc') {
  // Step 1: Ingest synthetic test fixture evidence
  const approvedAsset = await ingestCreativeEvidence({
    assetId: 'asset-house-banner-approved-001',
    tenantId,
    sourceId: 'src-house-banner-001',
    sourceType: 'BRAND_ASSET',
    sourceLocator: 'public/creative/house-banner-approved.png',
    originalPrompt: 'ORDERWEEDDC hero banner on white daylight canvas with dark forest green cursive wordmark orderweeddc and extended d leaf icon.',
    negativePrompt: 'mint green, neon green, B2B analytics card, clipart leaf.',
    rightsState: 'ORDERWEEDDC_OWNED',
    evidenceId: 'evid-owner-brand-asset-001',
    contentSha256: 'a1b2c3d4e5f60718293041526374859607182930415263748596071829304152',
    isTestFixture: true,
    eligibleForRealMemory: false,
  });

  const rejectedAsset = await ingestCreativeEvidence({
    assetId: 'asset-house-banner-rejected-001',
    tenantId,
    sourceId: 'src-house-banner-002',
    sourceType: 'COMPETITOR_REF',
    sourceLocator: 'public/creative/house-banner-rejected.png',
    originalPrompt: 'Corporate B2B analytics card with neon green charts.',
    negativePrompt: 'white background.',
    rightsState: 'REFERENCE_ONLY',
    contentSha256: 'b2c3d4e5f6071829304152637485960718293041526374859607182930415263',
    isTestFixture: true,
    eligibleForRealMemory: false,
  });

  // Step 2: Execute learning cycle with test fixture isolation
  const cycleResult = await runRecursiveLearningCycle({
    tenantId,
    property: 'ORDERWEEDDC',
    route: '/',
    component: 'HERO_BANNER',
    campaignId: 'CAMPAIGN-HOUSE-BANNER-001',
    businessId: 'BIZ-DC-HOUSE-001',
    isTestFixture: true,
  });

  return {
    sliceName: 'House Banner Controlled Vertical Slice',
    sliceClassification: 'TEST_FIXTURE_SLICE',
    tenantId,
    ingestedAssets: [approvedAsset, rejectedAsset],
    cycleResult,
    completedAt: new Date().toISOString(),
  };
}
