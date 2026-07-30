import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvider } from '../src/provider-contract.mjs';
import { createGeminiProvider } from '../src/providers/gemini.mjs';
import { analyzeBrandLogo, buildBrandProfile } from '../src/brand-profile.mjs';
import { buildCreativeBrief, ALLOWED_CHANNELS } from '../src/creative-brief.mjs';
import { verifyCreative, assertPostable, FORBIDDEN_CLAIMS } from '../src/verification.mjs';
import { runAdCreativePipeline, POSTING_LAW } from '../src/pipeline.mjs';
import {
  createModelRegistry,
  estimateImageOutputCost,
  resolveModelRole,
} from '../src/model-registry.mjs';
import { buildCandidateLineage, buildRollbackPreparation } from '../src/candidate-lineage.mjs';
import { createResponsiveDerivatives, compositeExactLogo } from '../src/asset-processing.mjs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createEditingRequest, createGenerationRequest } from '../src/asset-request.mjs';
import { evaluateBenchmarkReplay } from '../src/benchmark-replay.mjs';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockProvider(overrides = {}, boundaryId = 'mock-generator') {
  return createProvider({
    name: 'mock',
    model: 'mock-image-1',
    boundaryId,
    async generateImage() {
      return {
        imageBase64: PIXEL,
        mimeType: 'image/png',
        receipt: { provider: 'mock', generatedAt: '2026-07-23T00:00:00.000Z' },
      };
    },
    async analyzeImage({ instruction }) {
      if (instruction.includes('auditing a business logo')) {
        return {
          dominantColorsHex: ['#0e9f5a', '#0a7443'],
          typographyStyle: 'geometric sans',
          iconography: 'leaf mark',
          tone: 'clean, professional',
          doNotAlter: ['leaf mark'],
          minorsAppealRisk: false,
          receipt: {},
          ...overrides.logoAnalysis,
        };
      }
      return {
        containsMinorsAppeal: false,
        containsHealthClaims: false,
        containsRenderedText: false,
        matchesBrand: true,
        summary: 'clean studio product scene',
        receipt: {},
        ...overrides.imageAnalysis,
      };
    },
  });
}

const BUSINESS = {
  name: 'Anacostia Organics',
  licenseNumber: 'ABCA-000042',
  licenseSource: 'DC ABCA Registry (DC GIS open data)',
};
const PRODUCTS = [
  { name: 'Blue Dream 3.5g', category: 'Flower', strainType: 'sativa', dataStatus: 'VERIFIED_CURRENT' },
  { name: 'Solar Gummies', category: 'Edibles', dataStatus: 'VERIFIED_CURRENT' },
  { name: 'Stale Beacon', category: 'Flower', dataStatus: 'STALE' },
];
const LOGO = { imageBase64: PIXEL, mimeType: 'image/png' };
const CAMPAIGN = { channel: 'featured-placement', aspectRatio: '1:1' };

test('provider contract rejects incomplete implementations', () => {
  assert.throws(() => createProvider({ name: 'x', model: 'y' }), TypeError);
  assert.throws(
    () =>
      createProvider({
        name: '',
        model: 'y',
        boundaryId: 'test',
        generateImage() {},
        analyzeImage() {},
      }),
    TypeError,
  );
});

test('gemini adapter refuses to construct without an API key', () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.throws(() => createGeminiProvider(), /Gemini authentication is not configured/);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('gemini adapter never hardcodes a key and uses injected fetch', async () => {
  const calls = [];
  const provider = createGeminiProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
          ],
        }),
      };
    },
  });
  const image = await provider.generateImage({ prompt: 'studio scene', aspectRatio: '1:1' });
  assert.equal(image.imageBase64, PIXEL);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(calls[0].url, /test-key/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-key');
});

test('brand profile requires logo analysis first and filters to verified products', async () => {
  const provider = mockProvider({}, 'mock-verifier');
  const logoAnalysis = await analyzeBrandLogo({ provider, logoBase64: PIXEL, mimeType: 'image/png' });
  assert.deepEqual(logoAnalysis.dominantColorsHex, ['#0e9f5a', '#0a7443']);

  const profile = buildBrandProfile({ business: BUSINESS, logoAnalysis, products: PRODUCTS });
  assert.equal(profile.products.length, 2);
  assert.ok(profile.products.every((product) => product.dataStatus === 'VERIFIED_CURRENT'));

  assert.throws(
    () => buildBrandProfile({ business: BUSINESS, logoAnalysis: null, products: PRODUCTS }),
    /generation before brand analysis is forbidden/,
  );
  assert.throws(
    () =>
      buildBrandProfile({
        business: BUSINESS,
        logoAnalysis,
        products: [{ name: 'Demo', category: 'Flower', dataStatus: 'DEMONSTRATION_ONLY' }],
      }),
    /only feature products with a live evidence chain/,
  );
});

test('creative brief is per-product, bans in-image text, and rejects organic channel', async () => {
  const provider = mockProvider({}, 'mock-verifier');
  const logoAnalysis = await analyzeBrandLogo({ provider, logoBase64: PIXEL, mimeType: 'image/png' });
  const profile = buildBrandProfile({ business: BUSINESS, logoAnalysis, products: PRODUCTS });

  const brief = buildCreativeBrief({ brandProfile: profile, product: profile.products[0], campaign: CAMPAIGN });
  assert.match(brief.prompt, /Blue Dream 3\.5g/);
  assert.match(brief.prompt, /Do not render any text/);
  assert.equal(brief.overlayText.ageMarker, '21+ only');
  assert.equal(brief.overlayText.sponsoredLabel, 'Sponsored');
  assert.match(brief.overlayText.licenseLine, /ABCA-000042/);

  assert.throws(
    () => buildCreativeBrief({ brandProfile: profile, product: profile.products[0], campaign: { channel: 'organic-directory' } }),
    /organic directory placement is never an ad channel/,
  );
  assert.ok(!ALLOWED_CHANNELS.includes('organic-directory'));
});

test('full pipeline produces one verified creative per eligible product', async () => {
  const generatorProvider = mockProvider({}, 'mock-generator');
  const verifierProvider = mockProvider({}, 'mock-verifier');
  const result = await runAdCreativePipeline({
    generatorProvider,
    verifierProvider,
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: CAMPAIGN,
  });
  assert.equal(result.creatives.length, 2); // stale product excluded
  for (const creative of result.creatives) {
    assert.equal(creative.verification.status, 'PASS');
    assert.equal(creative.postable, false);
    assert.equal(creative.verification.receipt.imageSha256.length, 64);
  }
  assert.equal(result.postingLaw, POSTING_LAW);
});

test('verification fails on health claims, rendered text, and minors appeal', async () => {
  const healthy = await runAdCreativePipeline({
    generatorProvider: mockProvider({}, 'mock-generator'),
    verifierProvider: mockProvider({}, 'mock-verifier'),
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: { ...CAMPAIGN, headline: 'Pain relief guaranteed' },
    productName: 'Blue Dream 3.5g',
  });
  assert.equal(healthy.creatives[0].verification.status, 'FAIL');
  assert.ok(healthy.creatives[0].verification.receipt.failedChecks.includes('no-health-claims'));
  assert.ok(FORBIDDEN_CLAIMS.includes('pain relief'));

  const renderedText = await runAdCreativePipeline({
    generatorProvider: mockProvider({}, 'mock-generator'),
    verifierProvider: mockProvider(
      { imageAnalysis: { containsRenderedText: true } },
      'mock-verifier',
    ),
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: CAMPAIGN,
    productName: 'Blue Dream 3.5g',
  });
  assert.ok(renderedText.creatives[0].verification.receipt.failedChecks.includes('no-rendered-text'));

  const minors = await runAdCreativePipeline({
    generatorProvider: mockProvider({}, 'mock-generator'),
    verifierProvider: mockProvider(
      { imageAnalysis: { containsMinorsAppeal: true } },
      'mock-verifier',
    ),
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: CAMPAIGN,
    productName: 'Blue Dream 3.5g',
  });
  assert.ok(minors.creatives[0].verification.receipt.failedChecks.includes('image-safety'));
});

test('logo flagged for minors appeal halts the pipeline before generation', async () => {
  await assert.rejects(
    () =>
      runAdCreativePipeline({
        generatorProvider: mockProvider({}, 'mock-generator'),
        verifierProvider: mockProvider(
          { logoAnalysis: { minorsAppealRisk: true } },
          'mock-verifier',
        ),
        business: BUSINESS,
        logo: LOGO,
        products: PRODUCTS,
        campaign: CAMPAIGN,
      }),
    /minors-appeal risk/,
  );
});

test('assertPostable requires machine PASS AND a named human approval', async () => {
  const result = await runAdCreativePipeline({
    generatorProvider: mockProvider({}, 'mock-generator'),
    verifierProvider: mockProvider({}, 'mock-verifier'),
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: CAMPAIGN,
    productName: 'Blue Dream 3.5g',
  });
  const { verification } = result.creatives[0];

  assert.throws(
    () => assertPostable({ verification, humanApproval: null }),
    /named human approval/,
  );
  assert.throws(
    () => assertPostable({ verification: { status: 'FAIL', receipt: { failedChecks: ['x'] } }, humanApproval: { approvedBy: 'founder', approvedAt: '2026-07-23T00:00:00.000Z' } }),
    /posting is forbidden/,
  );
  const postable = assertPostable({
    verification,
    humanApproval: { approvedBy: 'founder', approvedAt: '2026-07-23T00:00:00.000Z' },
  });
  assert.equal(postable.postable, true);
  assert.equal(postable.imageSha256, verification.receipt.imageSha256);
});

test('pipeline refuses self-verification at the provider boundary', async () => {
  const provider = mockProvider({}, 'same-boundary');
  await assert.rejects(
    () =>
      runAdCreativePipeline({
        generatorProvider: provider,
        verifierProvider: provider,
        business: BUSINESS,
        logo: LOGO,
        products: PRODUCTS,
        campaign: CAMPAIGN,
      }),
    /generator boundary cannot verify its own output/,
  );
});

test('model registry rejects unsupported roles and produces explicit estimates', () => {
  const registry = createModelRegistry();
  assert.equal(
    resolveModelRole(registry, 'PREMIUM_FINAL_IMAGE_GENERATOR', 'image').model,
    'gemini-3-pro-image',
  );
  assert.throws(() => resolveModelRole(registry, 'DEPRECATED_IMAGEN', 'image'), /unsupported/);
  assert.deepEqual(
    estimateImageOutputCost({
      model: 'gemini-3.1-flash-image',
      imageSize: '2K',
      candidateCount: 4,
    }),
    {
      currency: 'USD',
      model: 'gemini-3.1-flash-image',
      imageSize: '2K',
      candidateCount: 4,
      unitCostUsd: 0.101,
      estimatedImageOutputCostUsd: 0.404,
      excludesInputTokens: true,
      actualCostUsd: null,
    },
  );
});

test('Vertex authentication uses a bearer header and never places credentials in the URL', async () => {
  const calls = [];
  const provider = createGeminiProvider({
    auth: {
      kind: 'vertex-ai',
      projectId: 'redacted-project',
      location: 'us-central1',
      getAccessToken: async () => 'test-access-token',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
          ],
        }),
      };
    },
  });
  await provider.generateImage({ prompt: 'draft scene' });
  assert.match(calls[0].url, /aiplatform\.googleapis\.com/);
  assert.doesNotMatch(calls[0].url, /test-access-token/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-access-token');
});

test('candidate lineage blocks learning promotion and prepares byte-exact rollback', () => {
  const lineage = buildCandidateLineage({
    missionId: 'orderweeddc-hero-draft',
    candidateId: 'candidate-a',
    brief: { assetClass: 'HERO' },
    providerReceipt: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      cost: { actualCostUsd: null },
    },
    imageBase64: PIXEL,
  });
  assert.equal(lineage.imageSha256.length, 64);
  assert.match(lineage.learningPromotion, /BLOCKED/);
  const rollback = buildRollbackPreparation({
    route: '/',
    currentAsset: { path: 'apps/web/public/hero-dc.webp', sha256: 'a'.repeat(64) },
    candidateLineage: lineage,
  });
  assert.equal(rollback.automaticPublish, false);
  assert.equal(rollback.restoreSha256, 'a'.repeat(64));
});

test('responsive derivatives preserve an exact hashed logo and emit AVIF and WebP', async () => {
  const logoBuffer = await sharp({
    create: { width: 120, height: 40, channels: 4, background: '#0b8f4d' },
  })
    .png()
    .toBuffer();
  const sceneBuffer = await sharp({
    create: { width: 800, height: 400, channels: 4, background: '#101010' },
  })
    .png()
    .toBuffer();
  const logoSha256 = createHash('sha256').update(logoBuffer).digest('hex');
  const composited = await compositeExactLogo({
    sceneBuffer,
    logoBuffer,
    expectedLogoSha256: logoSha256,
  });
  const derivatives = await createResponsiveDerivatives({
    masterBuffer: composited,
    widths: [320, 640],
  });
  assert.equal(derivatives.derivatives.length, 2);
  assert.ok(derivatives.derivatives.every((item) => item.avif.length > 0 && item.webp.length > 0));
  await assert.rejects(
    () =>
      compositeExactLogo({
        sceneBuffer,
        logoBuffer,
        expectedLogoSha256: '0'.repeat(64),
      }),
    /logo hash mismatch/,
  );
});

test('generation and editing schemas retain CreativeBrief lineage and require edit references', () => {
  const generation = createGenerationRequest({
    assetClass: 'HERO',
    creativeBrief: { goal: 'homepage discovery' },
    prompt: 'daytime Washington DC neighborhood scene without text or logo',
    aspectRatio: '16:9',
    imageSize: '2K',
  });
  assert.equal(generation.operation, 'GENERATE_IMAGE');
  assert.equal(generation.draftOnly, true);
  assert.throws(
    () =>
      createEditingRequest({
        assetClass: 'HERO',
        creativeBrief: generation.creativeBrief,
        prompt: 'move subject left',
      }),
    /authorized reference image/,
  );
  const edit = createEditingRequest({
    assetClass: 'HERO',
    creativeBrief: generation.creativeBrief,
    prompt: 'move subject left',
    referenceImages: [{ mimeType: 'image/png', imageBase64: PIXEL }],
  });
  assert.equal(edit.operation, 'EDIT_IMAGE');
});

test('benchmark replay detects provider, model, request, and visual-score drift', () => {
  const stable = evaluateBenchmarkReplay({
    benchmarkId: 'hero-v1',
    expected: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      requestSha256: 'a'.repeat(64),
      visualScore: 0.9,
    },
    observed: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      requestSha256: 'a'.repeat(64),
      visualScore: 0.88,
    },
  });
  assert.equal(stable.driftDetected, false);
  const drifted = evaluateBenchmarkReplay({
    benchmarkId: 'hero-v1',
    expected: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      requestSha256: 'a'.repeat(64),
      visualScore: 0.9,
    },
    observed: {
      provider: 'gemini',
      model: 'gemini-3-pro-image',
      requestSha256: 'a'.repeat(64),
      visualScore: 0.7,
    },
  });
  assert.equal(drifted.driftDetected, true);
  assert.equal(drifted.productionPromotionAllowed, false);
});
