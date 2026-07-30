import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createModelRegistry,
  estimateImageOutputCost,
  resolveModelRole,
} from '../../packages/ad-creative/src/model-registry.mjs';
import { ORDERWEEDDC_BRAND_ASSETS } from '../../packages/ad-creative/src/orderweeddc-brand-assets.mjs';

const candidateCount = 4;
const imageSize = process.env.CANA_CREATIVE_IMAGE_SIZE ?? '2K';
const imageRole = process.env.CANA_CREATIVE_IMAGE_ROLE ?? 'FAST_IMAGE_ITERATOR';
const registry = createModelRegistry();
const model = resolveModelRole(registry, imageRole, 'image').model;
const estimate = estimateImageOutputCost({ model, imageSize, candidateCount });
const canonicalBase = '375fe9be06e48010b8ef5176b74e98fde980246a';
let canonicalMainVerified = false;
try {
  execFileSync('git', ['merge-base', '--is-ancestor', canonicalBase, 'HEAD'], {
    stdio: 'ignore',
  });
  canonicalMainVerified = true;
} catch {
  canonicalMainVerified = false;
}

const logoReceipts = [];
for (const [name, asset] of Object.entries(ORDERWEEDDC_BRAND_ASSETS)) {
  const bytes = await readFile(resolve(asset.path));
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  logoReceipts.push({
    name,
    path: asset.path,
    expectedSha256: asset.sha256,
    actualSha256,
    valid: actualSha256 === asset.sha256,
  });
}

const gates = Object.freeze({
  canonicalMainVerified,
  grantEligibilityVerified: process.env.CANA_CREATIVE_GRANT_ELIGIBILITY_VERIFIED === 'true',
  paidGovernanceAuthorized: process.env.CANA_CREATIVE_PAID_GOVERNANCE_AUTHORIZED === 'true',
  serverSecretConfigured:
    Boolean(process.env.GEMINI_API_KEY) || process.env.CANA_VERTEX_ADC_CONFIGURED === 'true',
  ownerApprovedPaidCall: process.env.CANA_CREATIVE_OWNER_APPROVED_PAID_CALL === 'true',
  independentVerifierConfigured:
    process.env.CANA_CREATIVE_INDEPENDENT_VERIFIER_CONFIGURED === 'true',
  allBrandHashesValid: logoReceipts.every((receipt) => receipt.valid),
});
const operatorAttestationsComplete = Object.values(gates).every(Boolean);
const ready = false;

process.stdout.write(
  `${JSON.stringify(
    {
      mission: 'ORDERWEEDDC_HOMEPAGE_HERO_FOUR_CANDIDATES',
      activationMode: 'DRAFT_ONLY',
      readyForPaidGeneration: ready,
      operatorAttestationsComplete,
      gates,
      request: {
        candidateCount,
        materiallyDifferentCandidatesRequired: true,
        modelRole: imageRole,
        model,
        imageSize,
        exactLogoCompositing: true,
        responsiveDerivatives: true,
        automaticPublish: false,
      },
      estimate,
      grant: {
        verifiedBalanceBeforeUsd: null,
        verifiedBalanceAfterUsd: null,
        reason: 'Grant amount and eligibility have not been owner-verified against Google billing.',
      },
      logoReceipts,
      actualGenerationCostUsd: 0,
      blockReason:
        'This preflight never authorizes a paid call. The provider also requires a call-time CANA paid-governance receipt.',
    },
    null,
    2,
  )}\n`,
);

if (!ready) process.exitCode = 2;
