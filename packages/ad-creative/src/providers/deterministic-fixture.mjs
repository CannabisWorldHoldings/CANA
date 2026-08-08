import { createHash } from 'node:crypto';
import { createProvider } from '../provider-contract.mjs';

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const escapeAttribute = (value) => String(value).replace(/[&"<>]/g, (character) => ({
  '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;',
})[character]);
const OFFLINE_FIXTURE_PROVIDERS = new WeakSet();

const DIMENSIONS = Object.freeze({
  '16:9': Object.freeze({ width: 1600, height: 900 }),
  '4:5': Object.freeze({ width: 800, height: 1000 }),
  '1:1': Object.freeze({ width: 1000, height: 1000 }),
  '9:16': Object.freeze({ width: 900, height: 1600 }),
});

function compositionSvg({ variantId, aspectRatio, seed }) {
  const { width, height } = DIMENSIONS[aspectRatio] ?? DIMENSIONS['1:1'];
  const mobile = height > width;
  const palette = {
    'district-signal': ['#082f49', '#0e7490', '#67e8f9', '#f8fafc'],
    'evening-index': ['#2a1634', '#7c3aed', '#f59e0b', '#fff7ed'],
    'receipt-rhythm': ['#172b24', '#176b4d', '#a7f3d0', '#f8fafc'],
  }[variantId] ?? ['#172b24', '#176b4d', '#a7f3d0', '#f8fafc'];
  const [ink, mid, accent, paper] = palette;
  const motif = variantId === 'district-signal'
    ? `<path d="M${width * 0.08} ${height * 0.72}H${width * 0.92}M${width * 0.18} ${height * 0.18}V${height * 0.82}M${width * 0.5} ${height * 0.1}V${height * 0.9}M${width * 0.82} ${height * 0.18}V${height * 0.82}" stroke="${accent}" stroke-width="${Math.max(12, width * 0.012)}" opacity=".55"/><circle cx="${width * 0.5}" cy="${height * 0.42}" r="${Math.min(width, height) * 0.16}" fill="${paper}" opacity=".94"/><path d="M${width * 0.5} ${height * 0.23}l${width * 0.035} ${height * 0.11}h${width * 0.11}l-${width * 0.09} ${height * 0.065}l${width * 0.035} ${height * 0.11}l-${width * 0.105}-${height * 0.067}l-${width * 0.105} ${height * 0.067}l${width * 0.035}-${height * 0.11}l-${width * 0.09}-${height * 0.065}h${width * 0.11}z" fill="${mid}"/>`
    : variantId === 'evening-index'
      ? `<path d="M${-width * 0.05} ${height * 0.88}Q${width * 0.23} ${height * 0.18} ${width * 0.51} ${height * 0.88}T${width * 1.07} ${height * 0.88}" fill="none" stroke="${accent}" stroke-width="${Math.max(28, width * 0.035)}"/><circle cx="${width * 0.72}" cy="${height * 0.24}" r="${Math.min(width, height) * 0.11}" fill="${paper}" opacity=".92"/><g fill="${accent}" opacity=".8"><circle cx="${width * 0.16}" cy="${height * 0.19}" r="${width * 0.012}"/><circle cx="${width * 0.3}" cy="${height * 0.12}" r="${width * 0.007}"/><circle cx="${width * 0.47}" cy="${height * 0.2}" r="${width * 0.009}"/></g>`
      : `<g transform="translate(${width * 0.12} ${height * 0.12}) rotate(${mobile ? -4 : -7})"><rect width="${width * 0.72}" height="${height * 0.76}" rx="${width * 0.04}" fill="${paper}"/><rect x="${width * 0.08}" y="${height * 0.12}" width="${width * 0.4}" height="${height * 0.035}" rx="${height * 0.015}" fill="${mid}"/><rect x="${width * 0.08}" y="${height * 0.23}" width="${width * 0.55}" height="${height * 0.025}" rx="${height * 0.012}" fill="${accent}"/><rect x="${width * 0.08}" y="${height * 0.31}" width="${width * 0.46}" height="${height * 0.025}" rx="${height * 0.012}" fill="${accent}"/><rect x="${width * 0.08}" y="${height * 0.39}" width="${width * 0.5}" height="${height * 0.025}" rx="${height * 0.012}" fill="${accent}"/><circle cx="${width * 0.56}" cy="${height * 0.57}" r="${Math.min(width, height) * 0.1}" fill="${mid}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Deterministic abstract campaign fixture"><rect width="${width}" height="${height}" fill="${ink}"/><path d="M${width * 0.58} 0H${width}V${height}H${width * 0.42}Z" fill="${mid}" opacity=".78"/>${motif}<path d="M0 ${height * 0.93}C${width * 0.25} ${height * 0.86} ${width * 0.75} ${height} ${width} ${height * 0.88}V${height}H0Z" fill="${paper}" opacity=".14"/><metadata data-variant="${escapeAttribute(variantId)}" data-seed="${escapeAttribute(seed)}"/></svg>`;
}

/** Zero-network deterministic provider for fixtures, courts, and clean-clone QA. */
export function createDeterministicFixtureProvider() {
  const provider = createProvider({
    name: 'deterministic-svg-fixture',
    model: 'orderweeddc-vector-fixture-v1',
    capabilities: ['text-to-image', 'responsive-variants', 'zero-network'],
    routing: {
      quality: 0.82,
      costUsd: 0,
      latencyMs: 5,
      policyEligible: true,
      historicalPerformance: 0.7,
    },
    async generateImage({ prompt, aspectRatio = '1:1', configuration = {}, referenceImages = [] }) {
      const variantId = configuration.variantId ?? 'receipt-rhythm';
      const seed = configuration.seed ?? digest(`${variantId}|${aspectRatio}|${prompt}`).slice(0, 16);
      const svg = compositionSvg({ variantId, aspectRatio, seed });
      return Object.freeze({
        imageBase64: Buffer.from(svg).toString('base64'),
        mimeType: 'image/svg+xml',
        receipt: Object.freeze({
          schema_version: 'cana.deterministic-image-generation/1.0.0',
          provider: 'deterministic-svg-fixture',
          model: 'orderweeddc-vector-fixture-v1',
          prompt_sha256: digest(prompt),
          seed,
          configuration: Object.freeze({ variantId, aspectRatio }),
          source_asset_sha256: Object.freeze(referenceImages.map((asset) => digest(asset.imageBase64 ?? ''))),
          result_sha256: digest(svg),
          external_provider_calls: 0,
          actual_cost_usd: 0,
          network_accessed: false,
        }),
      });
    },
    async analyzeImage({ imageBase64 }) {
      const svg = Buffer.from(imageBase64, 'base64').toString('utf8');
      return Object.freeze({
        containsMinorsAppeal: false,
        containsHealthClaims: false,
        containsRenderedText: /<text\b/i.test(svg),
        matchesBrand: /^<svg[\s>]/.test(svg),
        summary: 'Deterministic abstract vector fixture with no people, products, generated copy, or external assets.',
        receipt: Object.freeze({
          provider: 'deterministic-svg-fixture',
          model: 'orderweeddc-vector-fixture-v1',
          image_sha256: digest(svg),
          external_provider_calls: 0,
          actual_cost_usd: 0,
          network_accessed: false,
        }),
      });
    },
  });
  OFFLINE_FIXTURE_PROVIDERS.add(provider);
  return provider;
}

/** Fail closed unless the provider came from this module's zero-network factory. */
export function assertDeterministicFixtureProvider(provider) {
  if (!OFFLINE_FIXTURE_PROVIDERS.has(provider)) {
    throw new Error('controlled zero-spend slice requires the canonical deterministic offline fixture provider');
  }
  return provider;
}

/** Recompute execution facts from returned bytes instead of trusting routing metadata. */
export function verifyDeterministicFixtureExecution({ image, analysis }) {
  const bytes = Buffer.from(image?.imageBase64 ?? '', 'base64');
  const svg = bytes.toString('utf8');
  const generation = image?.receipt ?? {};
  const inspection = analysis?.receipt ?? {};
  const errors = [];
  if (!/^<svg[\s>]/.test(svg)) errors.push('fixture output is not SVG');
  if (generation.provider !== 'deterministic-svg-fixture' || generation.model !== 'orderweeddc-vector-fixture-v1') errors.push('generation provider identity mismatch');
  if (generation.result_sha256 !== digest(svg)) errors.push('generation result hash mismatch');
  if (generation.external_provider_calls !== 0 || generation.actual_cost_usd !== 0 || generation.network_accessed !== false) errors.push('generation receipt is not zero-network and zero-cost');
  if (inspection.provider !== generation.provider || inspection.model !== generation.model) errors.push('inspection provider identity mismatch');
  if (inspection.image_sha256 !== digest(svg)) errors.push('inspection image hash mismatch');
  if (inspection.external_provider_calls !== 0 || inspection.actual_cost_usd !== 0 || inspection.network_accessed !== false) errors.push('inspection receipt is not zero-network and zero-cost');
  const variantId = generation.configuration?.variantId;
  const aspectRatio = generation.configuration?.aspectRatio;
  if (
    typeof variantId !== 'string'
    || typeof generation.seed !== 'string'
    || !Object.hasOwn(DIMENSIONS, aspectRatio)
  ) {
    errors.push('generation receipt cannot reconstruct the canonical deterministic composition');
  } else if (svg !== compositionSvg({ variantId, aspectRatio, seed: generation.seed })) {
    errors.push('fixture output does not match the canonical deterministic composition');
  }
  if (errors.length > 0) throw new Error(`deterministic fixture execution refused: ${errors.join('; ')}`);
  return Object.freeze({
    provider_calls: 0,
    external_provider_calls: 0,
    actual_spend_usd: 0,
    network_accessed: false,
    canonical_fixture: true,
    image_sha256: generation.result_sha256,
    bytes: bytes.length,
  });
}
