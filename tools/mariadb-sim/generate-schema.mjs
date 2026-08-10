import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'apps', 'web', 'prisma', 'schema.prisma');
const DESTINATION = path.join(ROOT, 'tools', 'mariadb-sim', 'schema.prisma');

const TEXT_FIELDS = new Map([
  ['Brand', new Set(['description'])],
  ['LicenseEvidence', new Set(['notes'])],
  ['Product', new Set(['description'])],
  ['Deal', new Set(['description'])],
  ['AuditLog', new Set(['details'])],
  ['SiteObservation', new Set(['summary', 'evidence', 'uncertainty', 'preparedAction'])],
  ['LoyaltyTransaction', new Set(['description'])],
  ['Article', new Set(['content'])],
  ['Dispute', new Set(['oldValue', 'newValue'])],
  ['StagingABCARetailer', new Set(['rawJson'])],
  ['DemandCreditEntry', new Set(['evidenceChain'])],
  ['ContinuationReceipt', new Set(['evidence'])],
  ['Opportunity', new Set(['evidence', 'observedState'])],
  ['AskIntentSignal', new Set(['intentIr', 'answerSummary'])],
  ['MarketSourceSnapshot', new Set(['queryParameters', 'payloadJson'])],
  ['MarketObservation', new Set(['rawValue', 'normalizedValue', 'uncertaintyJson'])],
  ['MarketEntityResolution', new Set(['candidateIds'])],
  ['MarketClaim', new Set(['claimValue', 'uncertaintyJson'])],
  ['MarketClaimContradiction', new Set(['earlierObservationIdsJson', 'laterObservationIdsJson'])],
  ['MarketVerificationEvent', new Set(['reason'])],
  ['MarketSourceAcquisitionEvent', new Set(['predicateScope', 'errorDetail'])],
  ['MarketSourceCapabilityReceipt', new Set(['capabilitiesJson', 'limitsJson'])],
  ['MarketEvidenceRevocationEvent', new Set(['cause'])],
]);

export function generateCandidate(source) {
  let model = null;
  const transformed = source.split('\n').map((line) => {
    const modelMatch = line.match(/^model\s+(\w+)\s+\{$/);
    if (modelMatch) model = modelMatch[1];
    if (line === '}') model = null;
    if (!model || !TEXT_FIELDS.has(model)) return line;

    const fieldMatch = line.match(/^(\s+)(\w+)(\s+String\??)(.*)$/);
    if (!fieldMatch || !TEXT_FIELDS.get(model).has(fieldMatch[2])) return line;
    const [, indent, field, type, suffix] = fieldMatch;
    if (/@db\.(?:Text|MediumText|LongText)/.test(suffix)) return line;
    return `${indent}${field}${type} @db.Text${suffix}`.trimEnd();
  }).join('\n');

  const provider = transformed
    .replace(
      /datasource db \{\n\s+provider\s+=\s+"postgresql"/,
      'datasource db {\n  provider = "mysql"',
    )
    .replace(/\n\s*directUrl\s*=\s*env\("DIRECT_URL"\)/, '')
    .replace(/\n\s*extensions\s*=\s*\[postgis\]/, '')
    .replace(/\n\s*previewFeatures\s*=\s*\["postgresqlExtensions"\]/, '')
    .replaceAll('Unsupported("geometry(Point, 4326)")', 'Unsupported("geometry")');
  if (provider === transformed) {
    throw new Error('source schema does not contain the expected PostgreSQL datasource');
  }
  return [
    '// GENERATED PROVIDER CANDIDATE. Do not merge this provider flip into the live schema.',
    '// Regenerate with: node tools/mariadb-sim/generate-schema.mjs',
    provider,
  ].join('\n');
}

export function writeCandidate() {
  const candidate = generateCandidate(fs.readFileSync(SOURCE, 'utf8'));
  fs.writeFileSync(DESTINATION, candidate, { encoding: 'utf8', mode: 0o644 });
  return DESTINATION;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${writeCandidate()}\n`);
}
