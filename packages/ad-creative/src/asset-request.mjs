export const ASSET_CLASSES = Object.freeze([
  'HERO',
  'BILLBOARD',
  'DISPLAY_AD',
  'SOCIAL_AD',
  'PRODUCT_CARD',
  'PRODUCT_SCENE',
  'MERCHANT_PREVIEW',
  'NEIGHBORHOOD_SCENE',
  'EMAIL_BANNER',
  'APP_SCREENSHOT',
  'INFOGRAPHIC',
  'LOGO_COMPOSITION',
  'UI_DIRECTION',
  'UI_COMPONENT',
  'RESPONSIVE_VARIANT',
]);

function baseRequest(input) {
  if (!ASSET_CLASSES.includes(input?.assetClass)) {
    throw new Error(`unsupported asset class: ${input?.assetClass}`);
  }
  if (typeof input.prompt !== 'string' || input.prompt.length === 0) {
    throw new TypeError('asset request prompt is required');
  }
  if (!input.creativeBrief || typeof input.creativeBrief !== 'object') {
    throw new TypeError('asset request must retain its CreativeBrief');
  }
  return {
    schemaVersion: 1,
    assetClass: input.assetClass,
    creativeBrief: input.creativeBrief,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio ?? '1:1',
    imageSize: input.imageSize ?? '1K',
    referenceImages: Object.freeze([...(input.referenceImages ?? [])]),
    draftOnly: true,
  };
}

export function createGenerationRequest(input) {
  return Object.freeze({ ...baseRequest(input), operation: 'GENERATE_IMAGE' });
}

export function createEditingRequest(input) {
  const request = baseRequest(input);
  if (request.referenceImages.length === 0) {
    throw new Error('image editing requires at least one authorized reference image');
  }
  return Object.freeze({ ...request, operation: 'EDIT_IMAGE' });
}
