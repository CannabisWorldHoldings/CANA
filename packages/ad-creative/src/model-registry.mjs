const DEFAULT_ROLES = Object.freeze({
  CREATIVE_DIRECTOR_AND_UI_ARCHITECT: Object.freeze({
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    kind: 'multimodal-reasoning',
  }),
  PREMIUM_FINAL_IMAGE_GENERATOR: Object.freeze({
    provider: 'gemini',
    model: 'gemini-3-pro-image',
    kind: 'image',
  }),
  FAST_IMAGE_ITERATOR: Object.freeze({
    provider: 'gemini',
    model: 'gemini-3.1-flash-image',
    kind: 'image',
  }),
  ECONOMY_BATCH_GENERATOR: Object.freeze({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite-image',
    kind: 'image',
  }),
});

const IMAGE_OUTPUT_PRICES_USD = Object.freeze({
  'gemini-3-pro-image': Object.freeze({ '1K': 0.134, '2K': 0.134, '4K': 0.24 }),
  'gemini-3.1-flash-image': Object.freeze({
    '512': 0.045,
    '1K': 0.067,
    '2K': 0.101,
    '4K': 0.151,
  }),
  'gemini-3.1-flash-lite-image': Object.freeze({ '1K': 0.0336 }),
});

export function createModelRegistry(overrides = {}) {
  const roles = {};
  for (const [role, definition] of Object.entries(DEFAULT_ROLES)) {
    const override = overrides[role] ?? {};
    roles[role] = Object.freeze({ ...definition, ...override });
  }
  return Object.freeze(roles);
}

export function resolveModelRole(registry, role, expectedKind) {
  const definition = registry?.[role];
  if (!definition) {
    throw new Error(`unsupported model role: ${role}`);
  }
  if (expectedKind && definition.kind !== expectedKind) {
    throw new Error(`model role ${role} is ${definition.kind}, expected ${expectedKind}`);
  }
  if (
    typeof definition.provider !== 'string' ||
    typeof definition.model !== 'string' ||
    definition.provider.length === 0 ||
    definition.model.length === 0
  ) {
    throw new Error(`model role ${role} is malformed`);
  }
  return definition;
}

export function estimateImageOutputCost({ model, imageSize = '1K', candidateCount = 1 }) {
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new TypeError('candidateCount must be a positive integer');
  }
  const unitCostUsd = IMAGE_OUTPUT_PRICES_USD[model]?.[imageSize];
  if (typeof unitCostUsd !== 'number') {
    throw new Error(`no verified image-output price for ${model} at ${imageSize}`);
  }
  return Object.freeze({
    currency: 'USD',
    model,
    imageSize,
    candidateCount,
    unitCostUsd,
    estimatedImageOutputCostUsd: Number((unitCostUsd * candidateCount).toFixed(6)),
    excludesInputTokens: true,
    actualCostUsd: null,
  });
}

export const MODEL_ROLES = Object.freeze(Object.keys(DEFAULT_ROLES));
