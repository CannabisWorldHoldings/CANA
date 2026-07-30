import { createProvider } from '../provider-contract.mjs';
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createModelRegistry,
  estimateImageOutputCost,
  resolveModelRole,
} from '../model-registry.mjs';
import {
  buildPaidRequestBinding,
  verifyPaidAuthorizationReceipt,
} from '../paid-authorization.mjs';
import { assertBoundedImage } from '../asset-processing.mjs';

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
const ALLOWED_IMAGE_SIZES = new Set(['512', '1K', '2K', '4K']);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 80 * 1024 * 1024;
const MAX_ANALYSIS_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_GENERATION_RESPONSE_BYTES =
  Math.ceil((MAX_OUTPUT_BYTES * 4) / 3) + 1024 * 1024;
const MAX_ANALYSIS_RESPONSE_BYTES = 128 * 1024;
const MAX_TEXT_INPUT_BYTES = 32 * 1024;
const MAX_ANALYSIS_OUTPUT_BYTES = 64 * 1024;
const MAX_ANALYSIS_STRING_LENGTH = 4_000;
const MAX_ANALYSIS_ARRAY_LENGTH = 20;

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function boundedText(value, label, maxBytes = MAX_TEXT_INPUT_BYTES) {
  const text = nonEmpty(value, label);
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeAuth(options) {
  const explicit = options.auth;
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
  if (options.apiKey !== undefined || explicit?.apiKey !== undefined) {
    throw new Error('Developer API keys must come from the server-side GEMINI_API_KEY environment');
  }
  const apiKey = process.env.GEMINI_API_KEY;
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

async function readBoundedJson(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Gemini response exceeds the ${maxBytes}-byte transport limit`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('Gemini response body is not a readable byte stream');
  }
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Gemini response exceeds the ${maxBytes}-byte transport limit`);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } catch {
    throw new Error('Gemini response was not valid JSON');
  }
}

async function postJson({ fetchImpl, auth, model, body, timeoutMs, maxResponseBytes }) {
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
    return await readBoundedJson(response, maxResponseBytes);
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

async function cleanupExpiredReceiptDirectories(receiptDirectory, currentDay) {
  const entries = await readdir(receiptDirectory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.name) &&
          entry.name < currentDay,
      )
      .map((entry) => rm(join(receiptDirectory, entry.name), { recursive: true, force: true })),
  );
}

async function consumePaidReceipt(authorization) {
  const receiptDirectory = process.env.CANA_CREATIVE_RECEIPT_DIR;
  if (typeof receiptDirectory !== 'string' || receiptDirectory.length === 0) {
    throw new Error('CANA_CREATIVE_RECEIPT_DIR is required for durable replay protection');
  }
  await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
  const currentDay = new Date().toISOString().slice(0, 10);
  await cleanupExpiredReceiptDirectories(receiptDirectory, currentDay);
  const expiryDay = new Date(authorization.expiresAt).toISOString().slice(0, 10);
  const expiryDirectory = join(receiptDirectory, expiryDay);
  await mkdir(expiryDirectory, { recursive: true, mode: 0o700 });
  const receiptPath = join(expiryDirectory, `${sha256(authorization.receiptId)}.json`);
  let handle;
  try {
    handle = await open(receiptPath, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        receiptId: authorization.receiptId,
        requestSha256: authorization.requestSha256,
        expiresAt: authorization.expiresAt,
      })}\n`,
      { encoding: 'utf8' },
    );
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('CANA paid-governance receipt replay is forbidden');
    }
    throw error;
  } finally {
    await handle?.close();
  }
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
  const paidGovernancePublicKey = process.env.CANA_PAID_GOVERNANCE_PUBLIC_KEY;

  async function generateOrEdit({
    tenantId,
    authorizationReceipt,
    maxTotalCostUsd,
    prompt,
    aspectRatio = '1:1',
    imageSize = '1K',
    referenceImages = [],
  }, operation) {
    nonEmpty(tenantId, 'tenantId');
    const boundedPrompt = boundedText(prompt, 'prompt');
    const validatedReferenceParts = validateReferenceImages(referenceImages);
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
    if (
      !Number.isFinite(maxTotalCostUsd) ||
      maxTotalCostUsd < cost.estimatedImageOutputCostUsd
    ) {
      throw new Error('maxTotalCostUsd must at least cover the known image-output charge');
    }
    const requestBinding = buildPaidRequestBinding({
      operation,
      tenantId,
      provider: 'gemini',
      model: imageDefinition.model,
      modelRole: imageRole,
      aspectRatio,
      imageSize,
      referenceImageCount: referenceImages.length,
      promptSha256: sha256(Buffer.from(boundedPrompt)),
      referenceImages: referenceImages.map((reference) => ({
        mimeType: reference.mimeType,
        sha256: sha256(Buffer.from(reference.imageBase64, 'base64')),
      })),
      estimatedImageOutputCostUsd: cost.estimatedImageOutputCostUsd,
      reservedMaxCostUsd: maxTotalCostUsd,
    });
    const authorization = verifyPaidAuthorizationReceipt({
      receipt: authorizationReceipt,
      requestBinding,
      publicKey: paidGovernancePublicKey,
      requiredCostUsd: maxTotalCostUsd,
    });
    if (operation === 'IMAGE_EDIT' && referenceImages.length === 0) {
      throw new Error('IMAGE_EDIT requires at least one authorized reference image');
    }
    for (const [index, reference] of referenceImages.entries()) {
      await assertBoundedImage(
        Buffer.from(reference.imageBase64, 'base64'),
        `referenceImages[${index}]`,
      );
    }
    await consumePaidReceipt(authorization);
    const payload = await postJson({
      fetchImpl,
      auth,
      model: imageDefinition.model,
      timeoutMs,
      maxResponseBytes: MAX_GENERATION_RESPONSE_BYTES,
      body: {
        contents: [{ parts: [{ text: boundedPrompt }, ...validatedReferenceParts] }],
        generationConfig: {
          responseFormat: {
            image: { aspectRatio, imageSize },
          },
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
    const outputDimensions = await assertBoundedImage(
      Buffer.from(image.inlineData.data, 'base64'),
      'Gemini image',
    );
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
        reservedMaxCostUsd: maxTotalCostUsd,
        outputDimensions,
        authorizationReceiptId: authorization.receiptId,
      }),
    });
  }

  return createProvider({
    name: `gemini-${auth.kind}`,
    model: imageDefinition.model,
    providerFamily: 'google',
    boundaryId: auth.boundaryId,
    generateImage: (input) => generateOrEdit(input, 'IMAGE_GENERATION'),
    editImage: (input) => generateOrEdit(input, 'IMAGE_EDIT'),
    async analyzeImage({
      tenantId,
      authorizationReceipt,
      maxTotalCostUsd,
      imageBase64,
      mimeType,
      instruction,
    }) {
      nonEmpty(tenantId, 'tenantId');
      if (!Number.isFinite(maxTotalCostUsd) || maxTotalCostUsd <= 0) {
        throw new Error('maxTotalCostUsd must be a positive owner-authorized analysis ceiling');
      }
      const boundedInstruction = boundedText(instruction, 'instruction');
      const analysisMimeType = nonEmpty(mimeType, 'mimeType');
      if (!analysisMimeType.startsWith('image/')) {
        throw new Error('analysis mimeType must be an image');
      }
      const analysisImageBase64 = nonEmpty(imageBase64, 'imageBase64');
      if (Buffer.byteLength(analysisImageBase64, 'base64') > MAX_ANALYSIS_INPUT_BYTES) {
        throw new Error(
          `analysis image exceeds the ${MAX_ANALYSIS_INPUT_BYTES}-byte input limit`,
        );
      }
      const analysisImage = Buffer.from(analysisImageBase64, 'base64');
      await assertBoundedImage(analysisImage, 'analysis image');
      const requestBinding = buildPaidRequestBinding({
        operation: 'IMAGE_ANALYSIS',
        tenantId,
        provider: 'gemini',
        model: analysisDefinition.model,
        modelRole: analysisRole,
        reservedMaxCostUsd: maxTotalCostUsd,
        instructionSha256: sha256(Buffer.from(boundedInstruction)),
        imageSha256: sha256(analysisImage),
        mimeType: analysisMimeType,
      });
      const authorization = verifyPaidAuthorizationReceipt({
        receipt: authorizationReceipt,
        requestBinding,
        publicKey: paidGovernancePublicKey,
        requiredCostUsd: maxTotalCostUsd,
      });
      await consumePaidReceipt(authorization);
      const payload = await postJson({
        fetchImpl,
        auth,
        model: analysisDefinition.model,
        timeoutMs,
        maxResponseBytes: MAX_ANALYSIS_RESPONSE_BYTES,
        body: {
          contents: [
            {
              parts: [
                { text: boundedInstruction },
                {
                  inlineData: {
                    mimeType: analysisMimeType,
                    data: analysisImageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 2048,
          },
        },
      });
      const text = parts(payload).find((part) => typeof part.text === 'string');
      if (!text) {
        throw new Error('Gemini returned no analysis for the image');
      }
      if (Buffer.byteLength(text.text) > MAX_ANALYSIS_OUTPUT_BYTES) {
        throw new Error(`Gemini analysis exceeds the ${MAX_ANALYSIS_OUTPUT_BYTES}-byte limit`);
      }
      let analysis;
      try {
        analysis = JSON.parse(text.text);
      } catch {
        throw new Error('Gemini analysis was not valid JSON; refusing to guess');
      }
      const isImageAnalysis =
        typeof analysis.containsMinorsAppeal === 'boolean' &&
        typeof analysis.containsHealthClaims === 'boolean' &&
        typeof analysis.matchesBrand === 'boolean' &&
        typeof analysis.summary === 'string';
      const isLogoAnalysis =
        Array.isArray(analysis.dominantColorsHex) &&
        typeof analysis.typographyStyle === 'string' &&
        typeof analysis.iconography === 'string' &&
        typeof analysis.tone === 'string' &&
        Array.isArray(analysis.doNotAlter) &&
        typeof analysis.minorsAppealRisk === 'boolean';
      const strings = [
        analysis.summary,
        analysis.typographyStyle,
        analysis.iconography,
        analysis.tone,
      ].filter((value) => typeof value === 'string');
      const arrays = [analysis.dominantColorsHex, analysis.doNotAlter].filter(Array.isArray);
      if (
        strings.some((value) => value.length > MAX_ANALYSIS_STRING_LENGTH) ||
        arrays.some(
          (value) =>
            value.length > MAX_ANALYSIS_ARRAY_LENGTH ||
            value.some(
              (item) =>
                typeof item !== 'string' || item.length > MAX_ANALYSIS_STRING_LENGTH,
            ),
        )
      ) {
        throw new Error('Gemini analysis exceeds the structured field limits');
      }
      if (!isImageAnalysis && !isLogoAnalysis) {
        throw new Error('Gemini analysis did not match a supported visual-analysis contract');
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
          reservedMaxCostUsd: maxTotalCostUsd,
          authorizationReceiptId: authorization.receiptId,
        }),
      });
    },
  });
}
