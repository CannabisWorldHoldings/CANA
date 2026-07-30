const TOKEN_PRICES_USD_PER_MILLION = Object.freeze({
  'gemini-3.1-flash-image': Object.freeze({
    input: 0.5,
    textOutput: 3,
    fixedImageInputTokens: 1120,
  }),
  'gemini-3.1-flash-lite-image': Object.freeze({
    input: 0.25,
    textOutput: 1.5,
    fixedImageInputTokens: 1120,
  }),
  'gemini-3-pro-image': Object.freeze({
    input: 2,
    textOutput: 12,
    fixedImageInputTokens: 560,
  }),
  'gemini-3.1-pro-preview': Object.freeze({ input: 2, textOutput: 12 }),
});

function roundUsd(value) {
  return Number(value.toFixed(6));
}

function prices(model) {
  const value = TOKEN_PRICES_USD_PER_MILLION[model];
  if (!value) throw new Error(`no verified Gemini token pricing for ${model}`);
  return value;
}

export function estimateImageInputTokens({ width, height, model }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new TypeError('image dimensions must be positive integers');
  }
  const modelPrices = prices(model);
  if (modelPrices.fixedImageInputTokens) return modelPrices.fixedImageInputTokens;
  if (width <= 384 && height <= 384) return 258;
  const cropUnit = Math.max(1, Math.floor(Math.min(width, height) / 1.5));
  return Math.ceil(width / cropUnit) * Math.ceil(height / cropUnit) * 258;
}

function estimateTokenCosts({
  model,
  text,
  imageDimensions,
  maxTextOutputTokens,
}) {
  const modelPrices = prices(model);
  const textInputTokenUpperBound = Buffer.byteLength(text);
  const imageInputTokenEstimate = imageDimensions.reduce(
    (total, dimensions) =>
      total + estimateImageInputTokens({ ...dimensions, model }),
    0,
  );
  const inputTokenEstimate = textInputTokenUpperBound + imageInputTokenEstimate;
  return {
    inputTokenEstimate,
    maxTextOutputTokens,
    estimatedInputCostUsd: roundUsd(
      (inputTokenEstimate * modelPrices.input) / 1_000_000,
    ),
    estimatedTextOutputReserveUsd: roundUsd(
      (maxTextOutputTokens * modelPrices.textOutput) / 1_000_000,
    ),
  };
}

export function estimateGeminiGenerationCost({
  model,
  text,
  imageDimensions,
  imageOutputCostUsd,
  maxTextOutputTokens = 8192,
}) {
  const tokenCosts = estimateTokenCosts({
    model,
    text,
    imageDimensions,
    maxTextOutputTokens,
  });
  return Object.freeze({
    currency: 'USD',
    pricingBasis: 'STANDARD_API_DOCUMENTED_TOKEN_ESTIMATE',
    ...tokenCosts,
    estimatedImageOutputCostUsd: imageOutputCostUsd,
    estimatedMaximumCostUsd: roundUsd(
      tokenCosts.estimatedInputCostUsd +
        tokenCosts.estimatedTextOutputReserveUsd +
        imageOutputCostUsd,
    ),
    actualCostUsd: null,
  });
}

export function estimateGeminiAnalysisCost({
  model,
  text,
  imageDimensions,
  maxTextOutputTokens = 2048,
}) {
  const tokenCosts = estimateTokenCosts({
    model,
    text,
    imageDimensions: [imageDimensions],
    maxTextOutputTokens,
  });
  return Object.freeze({
    currency: 'USD',
    pricingBasis: 'STANDARD_API_DOCUMENTED_TOKEN_ESTIMATE',
    ...tokenCosts,
    estimatedMaximumCostUsd: roundUsd(
      tokenCosts.estimatedInputCostUsd + tokenCosts.estimatedTextOutputReserveUsd,
    ),
    actualCostUsd: null,
  });
}
