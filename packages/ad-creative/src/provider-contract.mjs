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
 * @param {{ name: string, model: string, generateImage: Function, analyzeImage: Function }} spec
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
  for (const method of REQUIRED_METHODS) {
    if (typeof spec[method] !== 'function') {
      throw new TypeError(`provider.${method} must be a function`);
    }
  }
  return Object.freeze({
    name: spec.name,
    model: spec.model,
    generateImage: spec.generateImage,
    analyzeImage: spec.analyzeImage,
  });
}

/**
 * Canonical provider registry. Ineligible descriptors may be retained for an
 * auditable routing decision without constructing a credentialed provider.
 * Eligible entries must carry an implementation created by createProvider.
 *
 * @param {{ providers: Array<object> }} input
 */
export function createProviderRegistry({ providers }) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError('provider registry requires at least one descriptor');
  }
  const ids = new Set();
  const normalized = providers.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError('every provider descriptor requires an id');
    }
    if (ids.has(entry.id)) throw new Error(`duplicate provider id: ${entry.id}`);
    ids.add(entry.id);
    if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
      throw new TypeError(`provider ${entry.id} requires capabilities`);
    }
    const eligible = entry.eligible === true;
    if (eligible && (!entry.provider || typeof entry.provider.generateImage !== 'function' || typeof entry.provider.analyzeImage !== 'function')) {
      throw new TypeError(`eligible provider ${entry.id} requires a canonical implementation`);
    }
    return Object.freeze({
      id: entry.id,
      provider: eligible ? entry.provider : null,
      eligible,
      activationState: String(entry.activationState ?? 'UNSPECIFIED'),
      policyEligibility: String(entry.policyEligibility ?? 'UNSPECIFIED'),
      capabilities: Object.freeze([...new Set(entry.capabilities.map(String))]),
      costUsdPerOutput: Number.isFinite(entry.costUsdPerOutput) ? entry.costUsdPerOutput : null,
      networkExecution: entry.networkExecution === true,
    });
  });
  return Object.freeze({ schemaVersion: 'ad-creative.provider-registry/1.0.0', providers: Object.freeze(normalized) });
}

/** @param {{ registry: ReturnType<typeof createProviderRegistry>, requirements: string[] }} input */
export function routeProvider({ registry, requirements }) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new TypeError('provider routing requirements are required');
  }
  const uniqueRequirements = [...new Set(requirements.map(String))];
  const eligible = registry.providers.filter(
    (entry) => entry.eligible && uniqueRequirements.every((requirement) => entry.capabilities.includes(requirement)),
  );
  if (eligible.length === 0) throw new Error('no canonical provider satisfies the routing requirements');
  eligible.sort((left, right) => {
    const leftCost = left.costUsdPerOutput ?? Number.POSITIVE_INFINITY;
    const rightCost = right.costUsdPerOutput ?? Number.POSITIVE_INFINITY;
    return leftCost - rightCost || left.id.localeCompare(right.id);
  });
  return Object.freeze({
    selected: eligible[0],
    requirements: Object.freeze(uniqueRequirements),
    rejected: Object.freeze(registry.providers
      .filter((entry) => entry.id !== eligible[0].id)
      .map((entry) => Object.freeze({ id: entry.id, reason: entry.policyEligibility }))),
  });
}
