import { createProvider } from '../provider-contract.mjs';
import {
  createModelRegistry,
  estimateImageOutputCost,
  resolveModelRole,
} from '../model-registry.mjs';

const DEVELOPER_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);
const ALLOWED_IMAGE_SIZES = new Set(['0.5K', '1K', '2K', '4K']);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 80 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizeAuth(options) {
  const explicit = options.auth;
  if (explicit?.kind === 'developer-api') {
    return Object.freeze({
      kind: explicit.kind,
      apiKey: nonEmpty(explicit.apiKey, 'developer API key'),
      boundaryId: 'google-developer-api',
    });
  }
  if (explicit?.kind === 'vertex-ai') {
    if (typeof explicit.getAccessToken !== 'function') {
      throw new TypeError('Vertex authentication requires getAccessToken');
    }
    return Object.freeze({
      kind: explicit.kind,
      projectId: nonEmpty(explicit.projectId, 'Vertex projectId'),
      location: nonEmpty(explicit.location, 'Vertex location'),
      getAccessToken: explicit.getAccessToken,
      boundaryId: `google-vertex:${explicit.projectId}:${explicit.location}`,
    });
  }
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return Object.freeze({
      kind: 'developer-api',
      apiKey,
      boundaryId: 'google-developer-api',
    });
  }
  throw new Error(
    'Gemini authentication is not configured. Supply server-side Developer API or Vertex AI credentials; never use a public environment variable.',
  );
}

function requestTarget(auth, model) {
  if (auth.kind === 'developer-api') {
    return `${DEVELOPER_API_ROOT}/${model}:generateContent`;
  }
  return (
    `https://${auth.location}-aiplatform.googleapis.com/v1/projects/` +
    `${encodeURIComponent(auth.projectId)}/locations/${encodeURIComponent(auth.location)}/` +
    `publishers/google/models/${model}:generateContent`
  );
}

async function requestHeaders(auth) {
  if (auth.kind === 'developer-api') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': auth.apiKey };
  }
  const accessToken = nonEmpty(await auth.getAccessToken(), 'Vertex access token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
}

async function postJson({ fetchImpl, auth, model, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(requestTarget(auth, model), {
      method: 'POST',
      headers: await requestHeaders(auth),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Gemini request failed with HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parts(payload) {
  return payload?.candidates?.flatMap((candidate) => candidate?.content?.parts ?? []) ?? [];
}

function validateReferenceImages(referenceImages) {
  if (!Array.isArray(referenceImages) || referenceImages.length > 14) {
    throw new TypeError('referenceImages must be an array with at most 14 items');
  }
  let totalBytes = 0;
  return referenceImages.map((reference, index) => {
    const mimeType = nonEmpty(reference?.mimeType, `referenceImages[${index}].mimeType`);
    const data = nonEmpty(reference?.imageBase64, `referenceImages[${index}].imageBase64`);
    if (!mimeType.startsWith('image/')) {
      throw new Error(`referenceImages[${index}] must be an image`);
    }
    const decodedBytes = Buffer.byteLength(data, 'base64');
    if (decodedBytes > MAX_REFERENCE_BYTES) {
      throw new Error(`referenceImages[${index}] exceeds the ${MAX_REFERENCE_BYTES}-byte limit`);
    }
    totalBytes += decodedBytes;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw new Error(`reference images exceed the ${MAX_TOTAL_REFERENCE_BYTES}-byte total limit`);
    }
    return { inlineData: { mimeType, data } };
  });
}

function imageRequestParts(prompt, referenceImages) {
  return [{ text: nonEmpty(prompt, 'prompt') }, ...validateReferenceImages(referenceImages)];
}

export function createGeminiProvider(options = {}) {
  const auth = normalizeAuth(options);
  const registry = options.registry ?? createModelRegistry();
  const imageRole = options.imageRole ?? 'FAST_IMAGE_ITERATOR';
  const analysisRole = options.analysisRole ?? 'CREATIVE_DIRECTOR_AND_UI_ARCHITECT';
  const imageDefinition = resolveModelRole(registry, imageRole, 'image');
  const analysisDefinition = resolveModelRole(registry, analysisRole, 'multimodal-reasoning');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const authorizePaidRequest = options.authorizePaidRequest;

  async function generateOrEdit({ prompt, aspectRatio = '1:1', imageSize = '1K', referenceImages = [] }) {
    if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
      throw new Error(`unsupported aspect ratio: ${aspectRatio}`);
    }
    if (!ALLOWED_IMAGE_SIZES.has(imageSize)) {
      throw new Error(`unsupported image size: ${imageSize}`);
    }
    const cost = estimateImageOutputCost({
      model: imageDefinition.model,
      imageSize,
      candidateCount: 1,
    });
    if (typeof authorizePaidRequest !== 'function') {
      throw new Error('paid generation is disabled: CANA paid-governance authorization is required');
    }
    const authorization = await authorizePaidRequest({
      provider: 'gemini',
      model: imageDefinition.model,
      modelRole: imageRole,
      imageSize,
      estimatedImageOutputCostUsd: cost.estimatedImageOutputCostUsd,
      excludesInputTokens: true,
    });
    if (
      authorization?.authority !== 'CANA_PAID_GOVERNANCE' ||
      authorization?.authorized !== true ||
      typeof authorization?.receiptId !== 'string' ||
      authorization.receiptId.length === 0 ||
      typeof authorization?.ownerApprovalId !== 'string' ||
      authorization.ownerApprovalId.length === 0 ||
      typeof authorization?.grantEligibilityReceiptId !== 'string' ||
      authorization.grantEligibilityReceiptId.length === 0 ||
      typeof authorization?.maxCostUsd !== 'number' ||
      authorization.maxCostUsd < cost.estimatedImageOutputCostUsd
    ) {
      throw new Error('paid generation is disabled: authorization receipt is missing or insufficient');
    }
    const payload = await postJson({
      fetchImpl,
      auth,
      model: imageDefinition.model,
      timeoutMs,
      body: {
        contents: [{ parts: imageRequestParts(prompt, referenceImages) }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio, imageSize },
        },
      },
    });
    const image = parts(payload).find((part) => part.inlineData?.data);
    if (!image) {
      throw new Error('Gemini returned no image data for the request');
    }
    const outputBytes = Buffer.byteLength(image.inlineData.data, 'base64');
    if (outputBytes > MAX_OUTPUT_BYTES) {
      throw new Error(`Gemini image exceeds the ${MAX_OUTPUT_BYTES}-byte output limit`);
    }
    return Object.freeze({
      imageBase64: image.inlineData.data,
      mimeType: image.inlineData.mimeType ?? 'image/png',
      receipt: Object.freeze({
        provider: 'gemini',
        authKind: auth.kind,
        model: imageDefinition.model,
        modelRole: imageRole,
        aspectRatio,
        imageSize,
        referenceImageCount: referenceImages.length,
        generatedAt: new Date().toISOString(),
        usageMetadata: payload.usageMetadata ?? null,
        cost,
        authorizationReceiptId: authorization.receiptId,
      }),
    });
  }

  return createProvider({
    name: `gemini-${auth.kind}`,
    model: imageDefinition.model,
    providerFamily: 'google',
    boundaryId: auth.boundaryId,
    generateImage: generateOrEdit,
    editImage: generateOrEdit,
    async analyzeImage({ imageBase64, mimeType, instruction }) {
      if (typeof authorizePaidRequest !== 'function') {
        throw new Error('paid analysis is disabled: CANA paid-governance authorization is required');
      }
      const authorization = await authorizePaidRequest({
        provider: 'gemini',
        model: analysisDefinition.model,
        modelRole: analysisRole,
        operation: 'IMAGE_ANALYSIS',
        estimatedCostUsd: null,
      });
      if (
        authorization?.authority !== 'CANA_PAID_GOVERNANCE' ||
        authorization?.authorized !== true ||
        typeof authorization?.receiptId !== 'string' ||
        authorization.receiptId.length === 0 ||
        typeof authorization?.ownerApprovalId !== 'string' ||
        authorization.ownerApprovalId.length === 0 ||
        typeof authorization?.grantEligibilityReceiptId !== 'string' ||
        authorization.grantEligibilityReceiptId.length === 0 ||
        typeof authorization?.maxCostUsd !== 'number' ||
        authorization.maxCostUsd < 0
      ) {
        throw new Error('paid analysis is disabled: authorization receipt is missing or insufficient');
      }
      const payload = await postJson({
        fetchImpl,
        auth,
        model: analysisDefinition.model,
        timeoutMs,
        body: {
          contents: [
            {
              parts: [
                { text: nonEmpty(instruction, 'instruction') },
                {
                  inlineData: {
                    mimeType: nonEmpty(mimeType, 'mimeType'),
                    data: nonEmpty(imageBase64, 'imageBase64'),
                  },
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        },
      });
      const text = parts(payload).find((part) => typeof part.text === 'string');
      if (!text) {
        throw new Error('Gemini returned no analysis for the image');
      }
      let analysis;
      try {
        analysis = JSON.parse(text.text);
      } catch {
        throw new Error('Gemini analysis was not valid JSON; refusing to guess');
      }
      return Object.freeze({
        ...analysis,
        receipt: Object.freeze({
          provider: 'gemini',
          authKind: auth.kind,
          model: analysisDefinition.model,
          modelRole: analysisRole,
          analyzedAt: new Date().toISOString(),
          usageMetadata: payload.usageMetadata ?? null,
          authorizationReceiptId: authorization.receiptId,
        }),
      });
    },
  });
}
