import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS,
  resolveDynamicCreativeReview,
} from '../src/lib/dynamic-creative-review.mjs';

test('review fixtures are materially separate records with responsive assets', () => {
  const prototypes = DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS.filter((campaign) => campaign.decision === 'PENDING');
  assert.deepEqual(prototypes.map((campaign) => campaign.id), ['district-signal', 'evening-index', 'receipt-rhythm']);
  assert.equal(new Set(prototypes.map((campaign) => campaign.strategy)).size, 3);
  assert.ok(prototypes.every((campaign) => campaign.desktopAsset !== campaign.mobileAsset));
});

test('review resolver is local-only and fail closed', () => {
  assert.equal(resolveDynamicCreativeReview({ id: 'district-signal', hostname: 'orderweeddc.com', mode: 'LOCAL_ONLY' }), null);
  assert.equal(resolveDynamicCreativeReview({ id: 'district-signal', hostname: 'orderweeddc.localhost', mode: undefined }), null);
  assert.equal(resolveDynamicCreativeReview({ id: 'unknown', hostname: 'orderweeddc.localhost', mode: 'LOCAL_ONLY' }), null);
  assert.equal(resolveDynamicCreativeReview({ id: 'district-signal', hostname: 'orderweeddc.localhost', mode: 'LOCAL_ONLY' })?.id, 'district-signal');
});

test('Source Before Hype is the only primary rollback fixture on this surface', () => {
  const fallback = DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS.find((campaign) => campaign.id === 'source-before-hype');
  assert.equal(fallback?.decision, 'APPROVED_PRIMARY');
  assert.equal(DYNAMIC_CREATIVE_REVIEW_CAMPAIGNS.some((campaign) => campaign.id === 'tonights-shortlist'), false);
});

test('review surface uses marketplace tokens and no gradient or shadow-card treatment', async () => {
  const component = await readFile(new URL('../src/components/dynamic-sponsored-placement.tsx', import.meta.url), 'utf8');
  assert.match(component, /bg-brand-surface/);
  assert.match(component, /text-brand-text/);
  assert.doesNotMatch(component, /shadow-|text-slate|bg-emerald|text-emerald|gradient/i);
});
