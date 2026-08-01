/**
 * Provider contract for pluggable image-AI backends.
 *
 * Any model (Gemini, GPT Image, FLUX, a future model) participates by
 * satisfying this interface. The pipeline never imports a vendor SDK —
 * it only calls the two capabilities below, so swapping or A/B-ing
 * providers is a one-line change and never a rewrite.
 *
 * Research basis (2026-04 head-to-heads, docs/competitive/ad-creative-research.md):
 * - Gemini image stack: best product/brand consistency + cheapest per variant.
 * - GPT Image 2: best in-image typography + prompt adherence.
 * - Every model nets NEGATIVE typography sentiment => compliance text is
 *   never generated in-image; it is composed as a deterministic overlay.
 * - Failure modes diverge per model (Gemini hallucinates, GPT distorts)
 *   => post-generation verification is mandatory regardless of provider.
 */

/**
 * @typedef {object} GeneratedImage
 * @property {string} imageBase64 base64-encoded image bytes
 * @property {string} mimeType e.g. "image/png"
 * @property {object} receipt provider name, model, timestamp, request shape
 */

/**
 * @typedef {object} ImageAnalysis
 * @property {boolean} containsMinorsAppeal
 * @property {boolean} containsHealthClaims
 * @property {boolean} matchesBrand
 * @property {string} summary
 * @property {object} receipt
 */

const REQUIRED_METHODS = Object.freeze(['generateImage', 'analyzeImage']);

/**
 * Validate and freeze a provider implementation.
 * @param {{ name: string, model: string, providerFamily: string, boundaryId: string, generateImage: Function, editImage?: Function, analyzeImage: Function }} spec
 */
export function createProvider(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('provider spec must be an object');
  }
  if (typeof spec.name !== 'string' || spec.name.length === 0) {
    throw new TypeError('provider.name must be a non-empty string');
  }
  if (typeof spec.model !== 'string' || spec.model.length === 0) {
    throw new TypeError('provider.model must be a non-empty string');
  }
  if (typeof spec.boundaryId !== 'string' || spec.boundaryId.length === 0) {
    throw new TypeError('provider.boundaryId must be a non-empty string');
  }
  if (typeof spec.providerFamily !== 'string' || spec.providerFamily.length === 0) {
    throw new TypeError('provider.providerFamily must be a non-empty string');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof spec[method] !== 'function') {
      throw new TypeError(`provider.${method} must be a function`);
    }
  }
  return Object.freeze({
    name: spec.name,
    model: spec.model,
    providerFamily: spec.providerFamily,
    boundaryId: spec.boundaryId,
    generateImage: spec.generateImage,
    ...(typeof spec.editImage === 'function' ? { editImage: spec.editImage } : {}),
    analyzeImage: spec.analyzeImage,
  });
}

export function assertIndependentProviders(
  generatorProvider,
  verifierProvider,
  verificationAuthorization = {},
) {
  if (!generatorProvider || !verifierProvider) {
    throw new Error('generatorProvider and verifierProvider are both required');
  }
  if (
    generatorProvider.providerFamily === verifierProvider.providerFamily ||
    generatorProvider.boundaryId === verifierProvider.boundaryId
  ) {
    throw new Error(
      'independent verification is required: the generator boundary cannot verify its own output',
    );
  }
  return verifyIndependentProviderReceipt({
    generatorProvider,
    verifierProvider,
    receipt: verificationAuthorization.receipt,
    publicKey: process.env.CANA_INDEPENDENT_VERIFICATION_PUBLIC_KEY,
    tenantId: verificationAuthorization.tenantId,
    missionId: verificationAuthorization.missionId,
  });
}
import { verifyIndependentProviderReceipt } from './independent-verification.mjs';
