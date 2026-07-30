import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { assertIndependentProviders, createProvider } from '../src/provider-contract.mjs';
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
import {
  createResponsiveDerivatives,
  compositeOrderweeddcLogo,
} from '../src/asset-processing.mjs';
import sharp from 'sharp';
import { createEditingRequest, createGenerationRequest } from '../src/asset-request.mjs';
import { evaluateBenchmarkReplay } from '../src/benchmark-replay.mjs';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  buildPaidRequestBinding,
  canonicalPaidAuthorizationPayload,
} from '../src/paid-authorization.mjs';
import { providerVerificationIdentity } from '../src/independent-verification.mjs';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockProvider(overrides = {}, boundaryId = 'mock-generator') {
  return createProvider({
    name: 'mock',
    model: 'mock-image-1',
    providerFamily: `mock-family:${boundaryId}`,
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

const {
  privateKey: verificationAuthorityPrivateKey,
  publicKey: verificationAuthorityPublicKey,
} = generateKeyPairSync('ed25519');
const verificationAuthorityPublicKeyPem = verificationAuthorityPublicKey.export({
  type: 'spki',
  format: 'pem',
});
process.env.CANA_INDEPENDENT_VERIFICATION_PUBLIC_KEY =
  verificationAuthorityPublicKeyPem;

function signedVerificationAuthorization(
  generatorProvider,
  verifierProvider,
  tenantId = 'offline-test-tenant',
  missionId = 'offline-test-mission',
) {
  const payload = {
    schemaVersion: 1,
    authority: 'CANA_INDEPENDENT_VERIFICATION',
    receiptId: 'independent-verification-test',
    tenantId,
    missionId,
    generator: providerVerificationIdentity(generatorProvider),
    verifier: providerVerificationIdentity(verifierProvider),
    notBefore: '2020-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    nonce: 'abcdef0123456789',
  };
  return {
    receipt: {
      ...payload,
      signatureBase64: sign(
        null,
        canonicalPaidAuthorizationPayload(payload),
        verificationAuthorityPrivateKey,
      ).toString('base64'),
    },
  };
}

function mockPipelineProviders(verifierOverrides = {}) {
  const generatorProvider = mockProvider({}, 'mock-generator');
  const verifierProvider = mockProvider(verifierOverrides, 'mock-verifier');
  return {
    generatorProvider,
    verifierProvider,
    verificationAuthorization: signedVerificationAuthorization(
      generatorProvider,
      verifierProvider,
    ),
  };
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
const receiptDirectory = mkdtempSync(join(tmpdir(), 'cana-creative-receipts-'));
process.env.CANA_CREATIVE_RECEIPT_DIR = receiptDirectory;
process.env.GEMINI_API_KEY = 'test-key';
after(() => rmSync(receiptDirectory, { recursive: true, force: true }));
const { privateKey: paidGovernancePrivateKey, publicKey: paidGovernancePublicKey } =
  generateKeyPairSync('ed25519');
const paidGovernancePublicKeyPem = paidGovernancePublicKey.export({
  type: 'spki',
  format: 'pem',
});
process.env.CANA_PAID_GOVERNANCE_PUBLIC_KEY = paidGovernancePublicKeyPem;

let paidReceiptSequence = 0;
function signedAuthorization(request, maxCostUsd) {
  paidReceiptSequence += 1;
  const payload = {
    schemaVersion: 1,
    authority: 'CANA_PAID_GOVERNANCE',
    receiptId: `budget-receipt-test-${paidReceiptSequence}`,
    tenantId: request.tenantId,
    requestSha256: buildPaidRequestBinding(request).requestSha256,
    currency: 'USD',
    maxCostUsd,
    notBefore: '2020-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ownerApprovalId: 'owner-approval-test',
    grantEligibilityReceiptId: 'grant-eligibility-test',
    nonce: '0123456789abcdef',
  };
  return {
    ...payload,
    signatureBase64: sign(
      null,
      canonicalPaidAuthorizationPayload(payload),
      paidGovernancePrivateKey,
    ).toString('base64'),
  };
}

function generationAuthorization({
  operation = 'IMAGE_GENERATION',
  tenantId = 'orderweeddc',
  aspectRatio = '1:1',
  imageSize = '1K',
  prompt = 'draft scene',
  referenceImages = [],
  reservedMaxCostUsd = 0.1,
} = {}) {
  const request = {
    operation,
    tenantId,
    provider: 'gemini',
    model: 'gemini-3.1-flash-image',
    modelRole: 'FAST_IMAGE_ITERATOR',
    aspectRatio,
    imageSize,
    referenceImageCount: referenceImages.length,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    referenceImages: referenceImages.map((reference) => ({
      mimeType: reference.mimeType,
      sha256: createHash('sha256')
        .update(Buffer.from(reference.imageBase64, 'base64'))
        .digest('hex'),
    })),
    estimatedImageOutputCostUsd: imageSize === '2K' ? 0.101 : 0.067,
    reservedMaxCostUsd,
  };
  return signedAuthorization(request, reservedMaxCostUsd);
}

function analysisAuthorization({
  tenantId = 'orderweeddc',
  instruction = 'Return JSON',
  imageBase64 = PIXEL,
  mimeType = 'image/png',
  reservedMaxCostUsd = 0.1,
} = {}) {
  return signedAuthorization(
    {
      operation: 'IMAGE_ANALYSIS',
      tenantId,
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      modelRole: 'CREATIVE_DIRECTOR_AND_UI_ARCHITECT',
      reservedMaxCostUsd,
      instructionSha256: createHash('sha256').update(instruction).digest('hex'),
      imageSha256: createHash('sha256')
        .update(Buffer.from(imageBase64, 'base64'))
        .digest('hex'),
      mimeType,
    },
    reservedMaxCostUsd,
  );
}

test('provider contract rejects incomplete implementations', () => {
  assert.throws(() => createProvider({ name: 'x', model: 'y' }), TypeError);
  assert.throws(
    () =>
      createProvider({
        name: '',
        model: 'y',
        providerFamily: 'test',
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
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
        ],
      });
    },
  });
  const image = await provider.generateImage({
    tenantId: 'orderweeddc',
    authorizationReceipt: generationAuthorization({ prompt: 'studio scene' }),
    maxTotalCostUsd: 0.1,
    prompt: 'studio scene',
    aspectRatio: '1:1',
  });
  assert.equal(image.imageBase64, PIXEL);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(calls[0].url, /test-key/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(JSON.parse(calls[0].options.body).generationConfig, {
    responseFormat: {
      image: { aspectRatio: '1:1', imageSize: '1K' },
    },
  });
  assert.throws(
    () => createGeminiProvider({ apiKey: 'caller-override' }),
    /must come from the server-side GEMINI_API_KEY environment/,
  );
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
    verificationAuthorization: signedVerificationAuthorization(
      generatorProvider,
      verifierProvider,
    ),
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
    ...mockPipelineProviders(),
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
    ...mockPipelineProviders({ imageAnalysis: { containsRenderedText: true } }),
    business: BUSINESS,
    logo: LOGO,
    products: PRODUCTS,
    campaign: CAMPAIGN,
    productName: 'Blue Dream 3.5g',
  });
  assert.ok(renderedText.creatives[0].verification.receipt.failedChecks.includes('no-rendered-text'));

  const minors = await runAdCreativePipeline({
    ...mockPipelineProviders({ imageAnalysis: { containsMinorsAppeal: true } }),
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
        ...mockPipelineProviders({ logoAnalysis: { minorsAppealRisk: true } }),
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
    ...mockPipelineProviders(),
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

test('different caller labels do not prove independent verification without a signed receipt', () => {
  const generatorProvider = mockProvider({}, 'claimed-generator');
  const verifierProvider = mockProvider({}, 'claimed-verifier');
  assert.throws(
    () => assertIndependentProviders(generatorProvider, verifierProvider),
    /signed CANA independent-verification receipt is required/,
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
  assert.equal(
    estimateImageOutputCost({
      model: 'gemini-3.1-flash-image',
      imageSize: '512',
      candidateCount: 1,
    }).estimatedImageOutputCostUsd,
    0.045,
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
      return jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
        ],
      });
    },
  });
  await provider.generateImage({
    tenantId: 'orderweeddc',
    authorizationReceipt: generationAuthorization(),
    maxTotalCostUsd: 0.1,
    prompt: 'draft scene',
  });
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
  const logoBuffer = await readFile(
    new URL('../../../apps/web/public/brand/orderweeddc-on-light.png', import.meta.url),
  );
  const sceneBuffer = await sharp({
    create: { width: 800, height: 400, channels: 4, background: '#101010' },
  })
    .png()
    .toBuffer();
  const composited = await compositeOrderweeddcLogo({
    sceneBuffer,
    logoBuffer,
    brandAssetName: 'daytime',
  });
  const derivatives = await createResponsiveDerivatives({
    masterBuffer: composited,
    widths: [320, 640],
  });
  assert.equal(derivatives.derivatives.length, 2);
  assert.ok(derivatives.derivatives.every((item) => item.avif.length > 0 && item.webp.length > 0));
  await assert.rejects(
    () =>
      compositeOrderweeddcLogo({
        sceneBuffer,
        logoBuffer: Buffer.from(logoBuffer).fill(0, 0, 1),
        brandAssetName: 'daytime',
      }),
    /logo hash mismatch/,
  );
});

test('paid generation is fail-closed before transport without a governance receipt', async () => {
  let calls = 0;
  const provider = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('transport must not run');
    },
  });
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /receipt is required/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      provider.analyzeImage({
        imageBase64: PIXEL,
        mimeType: 'image/png',
        instruction: 'Return JSON',
        tenantId: 'orderweeddc',
        maxTotalCostUsd: 0.1,
      }),
    /receipt is required/,
  );
  assert.equal(calls, 0);
});

test('two Gemini adapters remain the same provider family regardless of auth labels', () => {
  const developer = createGeminiProvider({
    fetchImpl: async () => {
      throw new Error('not called');
    },
  });
  const vertex = createGeminiProvider({
    auth: {
      kind: 'vertex-ai',
      projectId: 'redacted-project',
      location: 'us-central1',
      getAccessToken: async () => 'test-token',
    },
    fetchImpl: async () => {
      throw new Error('not called');
    },
  });
  assert.throws(
    () => assertIndependentProviders(developer, vertex),
    /generator boundary cannot verify its own output/,
  );
});

test('signed paid authorization is request-bound and rejects tampering before transport', async () => {
  let calls = 0;
  const provider = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('transport must not run');
    },
  });
  const receipt = generationAuthorization();
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'another-tenant',
        authorizationReceipt: receipt,
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /does not authorize this request/,
  );
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: { ...receipt, maxCostUsd: 10 },
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /signature is invalid/,
  );
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: receipt,
        maxTotalCostUsd: 0.1,
        prompt: 'substituted prompt',
      }),
    /does not authorize this request/,
  );
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization(),
        maxTotalCostUsd: Number.NaN,
        prompt: 'draft scene',
      }),
    /maxTotalCostUsd/,
  );
  assert.equal(calls, 0);
});

test('paid authorization receipts cannot be replayed', async () => {
  const expiredReceiptDirectory = join(receiptDirectory, '2000-01-01');
  mkdirSync(expiredReceiptDirectory, { recursive: true });
  let calls = 0;
  const provider = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
        ],
      });
    },
  });
  const authorizationReceipt = generationAuthorization();
  const request = {
    tenantId: 'orderweeddc',
    authorizationReceipt,
    maxTotalCostUsd: 0.1,
    prompt: 'draft scene',
  };
  await provider.generateImage(request);
  assert.equal(existsSync(expiredReceiptDirectory), false);
  const restartedWorker = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('replayed transport must not run');
    },
  });
  await assert.rejects(
    () => restartedWorker.generateImage(request),
    /receipt replay is forbidden/,
  );
  assert.equal(calls, 1);
});

test('image editing has a separately signed operation and requires bounded references', async () => {
  const referenceImages = [{ mimeType: 'image/png', imageBase64: PIXEL }];
  let calls = 0;
  const provider = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } },
        ],
      });
    },
  });
  await assert.rejects(
    () =>
      provider.editImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization({
          referenceImages,
        }),
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
        referenceImages,
      }),
    /does not authorize this request/,
  );
  await provider.editImage({
    tenantId: 'orderweeddc',
    authorizationReceipt: generationAuthorization({
      operation: 'IMAGE_EDIT',
      referenceImages,
    }),
    maxTotalCostUsd: 0.1,
    prompt: 'draft scene',
    referenceImages,
  });
  assert.equal(calls, 1);
});

test('Gemini output enforces decoded pixel limits at the provider boundary', async () => {
  const oversizedHeader = Buffer.from(PIXEL, 'base64');
  oversizedHeader.writeUInt32BE(200_000, 16);
  oversizedHeader.writeUInt32BE(200_000, 20);
  const provider = createGeminiProvider({
    fetchImpl: async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: oversizedHeader.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
  });
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization(),
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /pixel limit|Input image exceeds pixel limit|invalid|corrupt/i,
  );
});

test('Gemini response transport is size-bounded before JSON buffering', async () => {
  const provider = createGeminiProvider({
    fetchImpl: async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(100 * 1024 * 1024) },
      }),
  });
  await assert.rejects(
    () =>
      provider.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization(),
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /transport limit/,
  );
});

test('Gemini rejects malformed and partial provider responses', async () => {
  const malformed = createGeminiProvider({
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  await assert.rejects(
    () =>
      malformed.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization(),
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /response was not valid JSON/,
  );

  const partial = createGeminiProvider({
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [] } }] }),
  });
  await assert.rejects(
    () =>
      partial.generateImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: generationAuthorization(),
        maxTotalCostUsd: 0.1,
        prompt: 'draft scene',
      }),
    /returned no image data/,
  );
});

test('Gemini analysis rejects syntactically valid but contract-empty JSON', async () => {
  const provider = createGeminiProvider({
    fetchImpl: async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '{}' }] } }],
      }),
  });
  await assert.rejects(
    () =>
      provider.analyzeImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: analysisAuthorization(),
        maxTotalCostUsd: 0.1,
        imageBase64: PIXEL,
        mimeType: 'image/png',
        instruction: 'Return JSON',
      }),
    /supported visual-analysis contract/,
  );
});

test('Gemini analysis enforces bounded instructions and responses before accepting data', async () => {
  let calls = 0;
  const provider = createGeminiProvider({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    containsMinorsAppeal: false,
                    containsHealthClaims: false,
                    matchesBrand: true,
                    summary: 'x'.repeat(65_536),
                  }),
                },
              ],
            },
          },
        ],
      });
    },
  });
  await assert.rejects(
    () =>
      provider.analyzeImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: null,
        maxTotalCostUsd: 0.1,
        imageBase64: PIXEL,
        mimeType: 'image/png',
        instruction: 'x'.repeat(32_769),
      }),
    /32768-byte limit/,
  );
  await assert.rejects(
    () =>
      provider.analyzeImage({
        tenantId: 'orderweeddc',
        authorizationReceipt: analysisAuthorization(),
        maxTotalCostUsd: 0.1,
        imageBase64: PIXEL,
        mimeType: 'image/png',
        instruction: 'Return JSON',
      }),
    /65536-byte limit/,
  );
  assert.equal(calls, 1);
});

test('candidate request identity ignores dynamic provider timestamps', () => {
  const base = {
    missionId: 'mission',
    candidateId: 'candidate',
    brief: { prompt: 'stable' },
    imageBase64: PIXEL,
  };
  const first = buildCandidateLineage({
    ...base,
    providerReceipt: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      generatedAt: '2026-01-01T00:00:00Z',
    },
  });
  const second = buildCandidateLineage({
    ...base,
    providerReceipt: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      generatedAt: '2026-02-01T00:00:00Z',
    },
  });
  assert.equal(first.requestSha256, second.requestSha256);
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
