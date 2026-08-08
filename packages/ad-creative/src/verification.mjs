/**
 * Verification gate — nothing posts until this passes AND a human approves.
 *
 * Two-key rule (no self-certification law): a machine PASS is necessary
 * but never sufficient. assertPostable additionally requires a named
 * human approval. The pipeline itself has no posting capability at all;
 * it produces an artifact plus a verification receipt.
 */
import { createHash } from 'node:crypto';
import { REQUIRED_OVERLAY } from './creative-brief.mjs';

/** Health/medical claims are forbidden in cannabis advertising. */
export const FORBIDDEN_CLAIMS = Object.freeze([
  'cure',
  'cures',
  'treats',
  'treatment',
  'heals',
  'medical benefit',
  'therapeutic',
  'fda',
  'doctor recommended',
  'anxiety relief',
  'pain relief',
  'safe',
  'healthy',
]);

export const IMAGE_ANALYSIS_INSTRUCTION = [
  'You are verifying a generated advertisement image before publication.',
  'Return STRICT JSON with exactly these keys:',
  '"containsMinorsAppeal" (boolean: any element that could appeal to minors —',
  'cartoon characters, candy styling, toys, youthful subjects),',
  '"containsHealthClaims" (boolean: any medical/health imagery or implied claims),',
  '"containsRenderedText" (boolean: any legible text, letters, or logos in the image),',
  '"matchesBrand" (boolean: scene plausibly consistent with the supplied palette and tone),',
  '"summary" (one sentence).',
  'Judge only what is visibly present.',
].join(' ');

function textCorpus(brief) {
  return [
    brief.prompt,
    brief.overlayText.headline,
    brief.overlayText.licenseLine,
  ]
    .join(' ')
    .toLowerCase();
}

function claimViolations(corpus) {
  return FORBIDDEN_CLAIMS.filter((claim) => {
    const pattern = new RegExp(`\\b${claim.replace(/ /g, '\\s+')}\\b`, 'i');
    return pattern.test(corpus);
  });
}

/**
 * @param {{
 *   brief: ReturnType<typeof import('./creative-brief.mjs').buildCreativeBrief>,
 *   brandProfile: object,
 *   image: { imageBase64: string, mimeType: string },
 *   imageAnalysis: { containsMinorsAppeal: boolean, containsHealthClaims: boolean, containsRenderedText: boolean, matchesBrand: boolean },
 * }} input
 */
export function verifyCreative({ brief, brandProfile, image, imageAnalysis }) {
  if (!imageAnalysis || typeof imageAnalysis !== 'object') {
    throw new TypeError(
      'verifyCreative requires a post-generation image analysis — verification without inspection is self-certification',
    );
  }
  const checks = [];
  const add = (name, passed, evidence) =>
    checks.push(Object.freeze({ name, status: passed ? 'PASS' : 'FAIL', evidence }));

  add(
    'product-evidence',
    brief.product.dataStatus === 'VERIFIED_CURRENT',
    `product.dataStatus=${brief.product.dataStatus}`,
  );
  add(
    'brand-accuracy',
    brief.business.name === brandProfile.business.name &&
      brief.business.licenseNumber === brandProfile.business.licenseNumber,
    `brief business "${brief.business.name}" vs profile "${brandProfile.business.name}"`,
  );
  add(
    'overlay-compliance',
    brief.overlayText.ageMarker === REQUIRED_OVERLAY.ageMarker &&
      brief.overlayText.sponsoredLabel === REQUIRED_OVERLAY.sponsoredLabel &&
      brief.overlayText.licenseLine.includes(brief.business.licenseNumber),
    'age marker, sponsored label, and license line present and exact',
  );
  const violations = claimViolations(textCorpus(brief));
  add(
    'no-health-claims',
    violations.length === 0,
    violations.length === 0 ? 'no forbidden claims' : `violations: ${violations.join(', ')}`,
  );
  add(
    'image-safety',
    imageAnalysis.containsMinorsAppeal === false &&
      imageAnalysis.containsHealthClaims === false,
    `minorsAppeal=${imageAnalysis.containsMinorsAppeal} healthClaims=${imageAnalysis.containsHealthClaims}`,
  );
  add(
    'no-rendered-text',
    imageAnalysis.containsRenderedText === false,
    'compliance text must live in the deterministic overlay, never in-image',
  );
  add(
    'brand-match',
    imageAnalysis.matchesBrand === true,
    `matchesBrand=${imageAnalysis.matchesBrand}`,
  );
  add(
    'sponsorship-neutrality',
    brief.channel !== 'organic-directory',
    `channel=${brief.channel} — ads never enter organic ordering`,
  );

  const failed = checks.filter((check) => check.status === 'FAIL');
  return Object.freeze({
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    checks: Object.freeze(checks),
    receipt: Object.freeze({
      imageSha256: createHash('sha256')
        .update(Buffer.from(image.imageBase64, 'base64'))
        .digest('hex'),
      verifiedAt: new Date().toISOString(),
      failedChecks: failed.map((check) => check.name),
    }),
  });
}

/**
 * The two-key posting gate. Throws unless machine verification PASSED and
 * a named human approved. This function is the ONLY sanctioned path to a
 * postable=true artifact.
 */
export function assertPostable({ verification, humanApproval }) {
  if (verification?.status !== 'PASS') {
    throw new Error(
      `Creative failed verification (${(verification?.receipt?.failedChecks ?? []).join(', ') || 'no verification'}) — posting is forbidden`,
    );
  }
  if (
    typeof humanApproval?.approvedBy !== 'string' ||
    humanApproval.approvedBy.length === 0 ||
    typeof humanApproval?.approvedAt !== 'string'
  ) {
    throw new Error(
      'Machine PASS is not sufficient: a named human approval (approvedBy, approvedAt) is required before posting',
    );
  }
  return Object.freeze({
    postable: true,
    approvedBy: humanApproval.approvedBy,
    approvedAt: humanApproval.approvedAt,
    imageSha256: verification.receipt.imageSha256,
  });
}

/** Canonical machine court for local campaign-system assets. */
export function verifyCampaignSystemCreative({ brief, image, imageAnalysis }) {
  if (!brief || brief.schemaVersion !== 'ad-creative.campaign-system-brief/1.0.0') {
    throw new TypeError('campaign-system verification requires its canonical brief');
  }
  if (!imageAnalysis || typeof imageAnalysis !== 'object') {
    throw new TypeError('campaign-system verification requires post-generation inspection');
  }
  const imageSha256 = createHash('sha256').update(Buffer.from(image.imageBase64, 'base64')).digest('hex');
  const checks = [
    ['repository-rights', brief.rightsState === 'CANA_OWNED_ORIGINAL_VECTOR', `rights=${brief.rightsState}`],
    ['review-policy', brief.policyResult === 'PASS_FOR_OWNER_REVIEW', `policy=${brief.policyResult}`],
    ['sponsorship-neutrality', brief.channel === 'featured-placement', `channel=${brief.channel}`],
    ['responsive-identity', brief.responsiveIdentity === brief.campaignSystemId, `identity=${brief.responsiveIdentity}`],
    ['image-safety', imageAnalysis.containsMinorsAppeal === false && imageAnalysis.containsHealthClaims === false,
      `minorsAppeal=${imageAnalysis.containsMinorsAppeal} healthClaims=${imageAnalysis.containsHealthClaims}`],
    ['no-rendered-text', imageAnalysis.containsRenderedText === false, `renderedText=${imageAnalysis.containsRenderedText}`],
    ['deterministic-svg', image.mimeType === 'image/svg+xml' && imageAnalysis.matchesBrand === true,
      `mime=${image.mimeType} inspected=${imageAnalysis.matchesBrand}`],
    ['receipt-integrity', image.receipt?.imageSha256 === imageSha256 && imageAnalysis.receipt?.imageSha256 === imageSha256,
      `recomputed=${imageSha256}`],
    ['zero-network', image.receipt?.networkExecution === false && imageAnalysis.receipt?.networkExecution === false,
      'generation and inspection are local'],
  ].map(([name, passed, evidence]) => Object.freeze({ name, status: passed ? 'PASS' : 'FAIL', evidence }));
  const failed = checks.filter((check) => check.status === 'FAIL');
  return Object.freeze({
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    checks: Object.freeze(checks),
    receipt: Object.freeze({ imageSha256, failedChecks: Object.freeze(failed.map((check) => check.name)) }),
  });
}
