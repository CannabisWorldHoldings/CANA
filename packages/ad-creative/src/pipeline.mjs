/**
 * Ad-creative pipeline: analyze -> brief -> generate -> inspect -> verify.
 *
 * ORDER IS LAW: brand analysis happens BEFORE generation; verification
 * happens AFTER generation and BEFORE anything is postable. The pipeline
 * has no posting capability — it returns an artifact plus receipts, and
 * only verification.assertPostable (machine PASS + named human approval)
 * can mark an artifact postable.
 */
import { analyzeBrandLogo, buildBrandProfile } from './brand-profile.mjs';
import { buildCreativeBrief } from './creative-brief.mjs';
import { verifyCreative, IMAGE_ANALYSIS_INSTRUCTION } from './verification.mjs';
import { assertIndependentProviders } from './provider-contract.mjs';

export const POSTING_LAW =
  'No ad creative is ever posted from generation alone: it must pass machine verification ' +
  '(evidence chain, brand accuracy, overlay compliance, health-claim scan, post-generation ' +
  'image inspection) AND carry a named human approval. The pipeline itself cannot post.';

/**
 * Run the full pipeline for one business. Produces one creative per
 * eligible product (every advertisement features a different verified
 * product), or a single product when `productName` narrows it.
 *
 * @param {{
 *   generatorProvider: ReturnType<typeof import('./provider-contract.mjs').createProvider>,
 *   verifierProvider: ReturnType<typeof import('./provider-contract.mjs').createProvider>,
 *   business: { name: string, licenseNumber: string, licenseSource: string },
 *   logo: { imageBase64: string, mimeType: string },
 *   products: Array<object>,
 *   campaign: { channel: string, aspectRatio?: string, sceneDirection?: string, headline?: string },
 *   productName?: string,
 * }} input
 */
export async function runAdCreativePipeline({
  generatorProvider,
  verifierProvider,
  business,
  logo,
  products,
  campaign,
  productName,
}) {
  assertIndependentProviders(generatorProvider, verifierProvider);
  // 1. Comprehensive brand analysis — BEFORE any generation.
  const logoAnalysis = await analyzeBrandLogo({
    provider: verifierProvider,
    logoBase64: logo.imageBase64,
    mimeType: logo.mimeType,
  });
  if (logoAnalysis.minorsAppealRisk) {
    throw new Error(
      `Brand logo for "${business.name}" flagged for minors-appeal risk — escalate to human review before any ad work`,
    );
  }
  const brandProfile = buildBrandProfile({
    business,
    logoAnalysis,
    products,
  });

  const targets = productName
    ? brandProfile.products.filter((product) => product.name === productName)
    : brandProfile.products;
  if (targets.length === 0) {
    throw new Error(`No eligible product named "${productName}"`);
  }

  const creatives = [];
  for (const product of targets) {
    // 2. Deterministic per-product brief.
    const brief = buildCreativeBrief({ brandProfile, product, campaign });

    // 3. Generation via the pluggable provider.
    const image = await generatorProvider.generateImage({
      prompt: brief.prompt,
      aspectRatio: brief.aspectRatio,
      referenceImages: [logo],
    });

    // 4. Post-generation inspection of the ACTUAL output.
    const imageAnalysis = await verifierProvider.analyzeImage({
      imageBase64: image.imageBase64,
      mimeType: image.mimeType,
      instruction: IMAGE_ANALYSIS_INSTRUCTION,
    });

    // 5. Verification gate.
    const verification = verifyCreative({
      brief,
      brandProfile,
      image,
      imageAnalysis,
    });

    creatives.push(
      Object.freeze({
        brief,
        image,
        imageAnalysis,
        verification,
        postable: false, // only assertPostable may flip this, and it returns a new object
      }),
    );
  }

  return Object.freeze({
    brandProfile,
    creatives: Object.freeze(creatives),
    postingLaw: POSTING_LAW,
  });
}
