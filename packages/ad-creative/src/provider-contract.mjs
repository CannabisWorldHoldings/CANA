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
 * @param {{ name: string, model: string, capabilities?: string[], routing?: object, generateImage: Function, analyzeImage: Function }} spec
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
  const capabilities = Array.isArray(spec.capabilities)
    ? [...new Set(spec.capabilities.filter((value) => typeof value === 'string' && value.length > 0))]
    : [];
  const declaredRouting = spec.routing && typeof spec.routing === 'object' ? spec.routing : {};
  const routing = {
    quality: declaredRouting.quality ?? 0.5,
    costUsd: declaredRouting.costUsd ?? null,
    latencyMs: declaredRouting.latencyMs ?? null,
    policyEligible: declaredRouting.policyEligible ?? false,
    historicalPerformance: declaredRouting.historicalPerformance ?? 0,
    externalCalls: declaredRouting.externalCalls ?? null,
  };
  for (const field of ['quality', 'historicalPerformance']) {
    if (!Number.isFinite(routing[field]) || routing[field] < 0 || routing[field] > 1) {
      throw new TypeError(`provider.routing.${field} must be between 0 and 1`);
    }
  }
  if (routing.costUsd !== null && (!Number.isFinite(routing.costUsd) || routing.costUsd < 0)) {
    throw new TypeError('provider.routing.costUsd must be null or a non-negative number');
  }
  if (routing.latencyMs !== null && (!Number.isFinite(routing.latencyMs) || routing.latencyMs < 0)) {
    throw new TypeError('provider.routing.latencyMs must be null or a non-negative number');
  }
  return Object.freeze({
    name: spec.name,
    model: spec.model,
    capabilities: Object.freeze(capabilities),
    routing: Object.freeze(routing),
    generateImage: spec.generateImage,
    analyzeImage: spec.analyzeImage,
  });
}

/**
 * Canonical provider registry. This is routing metadata, not execution or
 * spending authority; every provider remains an implementation of
 * `createProvider` and the caller still owns the generation grant.
 */
export function createProviderRegistry(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError('provider registry requires at least one provider');
  }
  const byName = new Map();
  for (const provider of providers) {
    if (!provider || typeof provider.generateImage !== 'function' || typeof provider.analyzeImage !== 'function') {
      throw new TypeError('provider registry accepts only provider-contract implementations');
    }
    if (byName.has(provider.name)) throw new Error(`duplicate provider name ${provider.name}`);
    byName.set(provider.name, provider);
  }
  return Object.freeze({
    providers: Object.freeze([...byName.values()]),
    names: Object.freeze([...byName.keys()]),
    executionAuthority: 'NONE_REGISTRY_ONLY',
  });
}

const DEFAULT_ROUTING_WEIGHTS = Object.freeze({
  quality: 0.35,
  cost: 0.2,
  latency: 0.1,
  historicalPerformance: 0.35,
});

/** Select an eligible provider without calling it or authorizing spend. */
export function routeImageProvider(registry, requirements = {}) {
  if (!registry?.providers || !Array.isArray(registry.providers)) {
    throw new TypeError('routeImageProvider requires a provider registry');
  }
  const requiredCapabilities = Array.isArray(requirements.requiredCapabilities)
    ? requirements.requiredCapabilities : [];
  const maxCostUsd = requirements.maxCostUsd ?? 0;
  const maxLatencyMs = requirements.maxLatencyMs ?? Number.POSITIVE_INFINITY;
  const weights = { ...DEFAULT_ROUTING_WEIGHTS, ...(requirements.weights ?? {}) };
  const candidates = registry.providers.map((provider) => {
    const missingCapabilities = requiredCapabilities.filter(
      (capability) => !provider.capabilities.includes(capability),
    );
    const metadata = provider.routing;
    const eligible =
      metadata.policyEligible === true &&
      missingCapabilities.length === 0 &&
      Number.isFinite(metadata.costUsd) && metadata.costUsd <= maxCostUsd &&
      Number.isFinite(metadata.latencyMs) && metadata.latencyMs <= maxLatencyMs;
    const costScore = maxCostUsd > 0 ? Math.max(0, 1 - metadata.costUsd / maxCostUsd) : metadata.costUsd === 0 ? 1 : 0;
    const latencyScore = Number.isFinite(maxLatencyMs) && maxLatencyMs > 0
      ? Math.max(0, 1 - metadata.latencyMs / maxLatencyMs) : 0;
    const score =
      metadata.quality * weights.quality +
      costScore * weights.cost +
      latencyScore * weights.latency +
      metadata.historicalPerformance * weights.historicalPerformance;
    return {
      name: provider.name,
      model: provider.model,
      eligible,
      score: Number(score.toFixed(6)),
      quality: metadata.quality,
      costUsd: metadata.costUsd,
      latencyMs: metadata.latencyMs,
      policyEligible: metadata.policyEligible,
      historicalPerformance: metadata.historicalPerformance,
      missingCapabilities,
      provider,
    };
  });
  const eligible = candidates.filter((candidate) => candidate.eligible).sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (Math.abs(scoreDifference) > 0.01) return scoreDifference;
    if (right.quality !== left.quality) return right.quality - left.quality;
    return left.name.localeCompare(right.name);
  });
  if (eligible.length === 0) {
    const error = new Error('No image provider satisfies capability, cost, latency, and policy requirements');
    error.code = 'NO_ELIGIBLE_IMAGE_PROVIDER';
    throw error;
  }
  const selected = eligible[0];
  return Object.freeze({
    provider: selected.provider,
    receipt: Object.freeze({
      schema_version: 'cana.image-provider-routing/1.0.0',
      selected_provider: selected.name,
      selected_model: selected.model,
      routing_dimensions: Object.freeze([
        'quality', 'cost', 'latency', 'policy_eligibility', 'historical_performance',
      ]),
      required_capabilities: Object.freeze([...requiredCapabilities]),
      max_cost_usd: maxCostUsd,
      max_latency_ms: Number.isFinite(maxLatencyMs) ? maxLatencyMs : null,
      candidates: Object.freeze(candidates.map(({ provider: _provider, ...candidate }) => Object.freeze(candidate))),
      provider_called: false,
      spending_authority: 'NONE',
    }),
  });
}
