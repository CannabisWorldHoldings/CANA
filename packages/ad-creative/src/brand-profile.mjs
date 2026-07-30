/**
 * Brand profile: the comprehensive, in-depth analysis of the business an
 * ad is being made for — REQUIRED before any generation happens.
 *
 * Two stages:
 * 1. analyzeBrandLogo — the provider's vision model reads the actual logo
 *    and returns a structured audit (palette, typography, iconography,
 *    tone, do-not-alter elements).
 * 2. buildBrandProfile — fuses that audit with the business's VERIFIED
 *    directory record. Only evidence-eligible products may appear in ads;
 *    the truth constitution applies to marketing exactly as it applies to
 *    the directory.
 */

export const LOGO_ANALYSIS_INSTRUCTION = [
  'You are auditing a business logo before ad-creative generation.',
  'Return STRICT JSON with exactly these keys:',
  '"dominantColorsHex" (array of up to 5 hex strings, most dominant first),',
  '"typographyStyle" (short phrase, e.g. "geometric sans, heavy weight"),',
  '"iconography" (short description of marks/symbols),',
  '"tone" (3-5 adjectives describing the brand voice the logo projects),',
  '"doNotAlter" (array of elements that must never be redrawn or distorted),',
  '"minorsAppealRisk" (boolean: cartoonish/candy-like elements that could appeal to minors).',
  'Describe only what is visibly present. Never invent elements.',
].join(' ');

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Run the provider's vision model over the business logo.
 * @param {{ provider: import('./provider-contract.mjs').Provider, logoBase64: string, mimeType: string }} input
 */
export async function analyzeBrandLogo({ provider, logoBase64, mimeType, providerInput = {} }) {
  if (typeof logoBase64 !== 'string' || logoBase64.length === 0) {
    throw new TypeError('analyzeBrandLogo requires logoBase64');
  }
  const analysis = await provider.analyzeImage({
    ...providerInput,
    imageBase64: logoBase64,
    mimeType,
    instruction: LOGO_ANALYSIS_INSTRUCTION,
  });
  const colors = Array.isArray(analysis.dominantColorsHex)
    ? analysis.dominantColorsHex.filter((hex) => HEX_PATTERN.test(hex))
    : [];
  return Object.freeze({
    dominantColorsHex: Object.freeze(colors),
    typographyStyle: String(analysis.typographyStyle ?? ''),
    iconography: String(analysis.iconography ?? ''),
    tone: String(analysis.tone ?? ''),
    doNotAlter: Object.freeze(
      Array.isArray(analysis.doNotAlter) ? analysis.doNotAlter.map(String) : [],
    ),
    minorsAppealRisk: analysis.minorsAppealRisk === true,
    receipt: analysis.receipt ?? null,
  });
}

/**
 * Fuse the logo audit with the verified business record.
 *
 * @param {{
 *   business: { name: string, licenseNumber: string, licenseSource: string, dataStatus: string },
 *   logoAnalysis: object,
 *   products: Array<{ name: string, category: string, strainType?: string, dataStatus: string }>,
 * }} input
 */
export function buildBrandProfile({ business, logoAnalysis, products }) {
  if (!business || typeof business !== 'object') {
    throw new TypeError('buildBrandProfile requires a business record');
  }
  for (const field of ['name', 'licenseNumber', 'licenseSource']) {
    if (typeof business[field] !== 'string' || business[field].length === 0) {
      throw new TypeError(`business.${field} is required — ads are only made for licensed, identified businesses`);
    }
  }
  if (!logoAnalysis || !Array.isArray(logoAnalysis.dominantColorsHex)) {
    throw new TypeError(
      'buildBrandProfile requires a completed logo analysis — generation before brand analysis is forbidden',
    );
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw new TypeError('buildBrandProfile requires at least one product');
  }
  const eligibleProducts = products.filter(
    (product) => product.dataStatus === 'VERIFIED_CURRENT',
  );
  if (eligibleProducts.length === 0) {
    throw new Error(
      'No VERIFIED_CURRENT products: an ad may only feature products with a live evidence chain',
    );
  }
  return Object.freeze({
    business: Object.freeze({
      name: business.name,
      licenseNumber: business.licenseNumber,
      licenseSource: business.licenseSource,
    }),
    logo: logoAnalysis,
    products: Object.freeze(
      eligibleProducts.map((product) =>
        Object.freeze({
          name: product.name,
          category: product.category,
          strainType: product.strainType ?? null,
          dataStatus: product.dataStatus,
        }),
      ),
    ),
  });
}
