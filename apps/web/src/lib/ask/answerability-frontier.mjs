import { createHash } from 'node:crypto';

export const ANSWERABILITY_FRONTIER_VERSION = 'cana-answerability-frontier/v1';
export const ANSWERABILITY_EVIDENCE_GATE_VERSION = 'current-public-record+subject-cohort/v1';

const DIMENSION_PREDICATES = Object.freeze({
  location: Object.freeze([
    'license_number',
    'license_status',
    'operating_status',
    'regulated_address',
  ]),
  category: Object.freeze(['availability', 'menu']),
  price_max_usd: Object.freeze(['price']),
  fulfillment: Object.freeze(['delivery', 'service_area']),
  open_now: Object.freeze(['hours', 'operating_status']),
});

const SUPPORTED_DIMENSIONS = new Set(['location']);
const CURRENT_VERIFICATIONS = new Set(['SUPPORTED', 'VERIFIED']);
const CONTRADICTED_VERIFICATIONS = new Set(['CONTRADICTED', 'REFUTED']);

function fail(code) {
  throw new Error(code);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function canonicalTenant(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase() || value.length > 253) {
    fail('CANA_ANSWERABILITY_TENANT_INVALID');
  }
  const labels = value.split('.');
  if (labels.length < 2 || labels.some((label) => (
    label.length < 1
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) fail('CANA_ANSWERABILITY_TENANT_INVALID');
  return value;
}

function canonicalDimensionValue(name, value) {
  if (name === 'price_max_usd') {
    if (!Number.isFinite(value) || value <= 0) fail('CANA_ANSWERABILITY_INTENT_INVALID');
    return Number(value);
  }
  if (name === 'open_now') return value === true;
  if (typeof value !== 'string') fail('CANA_ANSWERABILITY_INTENT_INVALID');
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) fail('CANA_ANSWERABILITY_INTENT_INVALID');
  return normalized;
}

function canonicalIntentScope(intent) {
  const dimensions = intent?.dimensions;
  if (!dimensions || typeof dimensions !== 'object') fail('CANA_ANSWERABILITY_INTENT_INVALID');
  const scope = {};
  for (const name of Object.keys(DIMENSION_PREDICATES).sort()) {
    const dimension = dimensions[name];
    if (dimension?.status === 'KNOWN') {
      scope[name] = canonicalDimensionValue(name, dimension.value);
    } else if (dimension?.status !== 'UNKNOWN') {
      fail('CANA_ANSWERABILITY_INTENT_INVALID');
    }
  }
  return Object.freeze(scope);
}

function classifyDecision(decision, clock) {
  if (CONTRADICTED_VERIFICATIONS.has(decision?.verification)) return 'CONTRADICTED';
  if (!decision?.decision_eligible || !CURRENT_VERIFICATIONS.has(decision?.verification)) return 'UNKNOWN';
  const observed = new Date(decision.observed_at ?? decision.observedAt);
  const expires = new Date(decision.freshness_expires_at ?? decision.freshnessExpiresAt);
  if (!Number.isFinite(observed.getTime()) || observed > clock) return 'UNKNOWN';
  if (!Number.isFinite(expires.getTime())) return 'UNKNOWN';
  if (expires <= clock) return 'STALE';
  return 'CURRENT';
}

function canonicalEvidenceRef(decision) {
  return Object.freeze({
    acquisition_event_id: decision.acquisition_event_id ?? decision.acquisitionEventId ?? null,
    evidence_ref: decision.evidence_ref ?? null,
    verification_event_id: decision.verification_event_id ?? decision.verificationEventId ?? null,
  });
}

function subjectCoverage(claimDecisions, requiredPredicates, clock) {
  const subjects = new Map();
  for (const decision of claimDecisions ?? []) {
    const subjectRef = decision?.subject_ref ?? decision?.subjectRef;
    const predicate = decision?.predicate ?? decision?.claimType;
    if (typeof subjectRef !== 'string' || !subjectRef || !requiredPredicates.includes(predicate)) continue;
    const subject = subjects.get(subjectRef) ?? new Map();
    const candidate = {
      predicate,
      state: classifyDecision(decision, clock),
      evidence: canonicalEvidenceRef(decision),
    };
    const prior = subject.get(predicate);
    const priority = { CURRENT: 4, STALE: 3, CONTRADICTED: 2, UNKNOWN: 1 };
    if (!prior || priority[candidate.state] > priority[prior.state]) subject.set(predicate, candidate);
    subjects.set(subjectRef, subject);
  }
  return Object.freeze([...subjects.entries()].map(([subjectRef, predicates]) => {
    const entries = [...predicates.values()].sort((left, right) => left.predicate.localeCompare(right.predicate));
    const byState = (state) => entries.filter((entry) => entry.state === state).map((entry) => entry.predicate);
    return Object.freeze({
      subject_ref: subjectRef,
      current_predicates: Object.freeze(byState('CURRENT')),
      stale_predicates: Object.freeze(byState('STALE')),
      contradicted_predicates: Object.freeze(byState('CONTRADICTED')),
      unknown_predicates: Object.freeze(byState('UNKNOWN')),
      evidence: Object.freeze(entries.map((entry) => Object.freeze({
        predicate: entry.predicate,
        state: entry.state,
        ...entry.evidence,
      }))),
    });
  }).sort((left, right) => (
    right.current_predicates.length - left.current_predicates.length
    || left.subject_ref.localeCompare(right.subject_ref)
  )));
}

export function buildAnswerabilityFrontier({
  tenant,
  intent,
  claimDecisions = [],
  asOf = new Date(),
}) {
  const canonicalTenantValue = canonicalTenant(tenant);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) fail('CANA_ANSWERABILITY_CLOCK_INVALID');
  const intentScope = canonicalIntentScope(intent);
  const knownDimensions = Object.keys(intentScope).sort();
  const unsupportedKnownDimensions = knownDimensions.filter((name) => !SUPPORTED_DIMENSIONS.has(name));
  const requiredPredicates = sortedUnique(knownDimensions.flatMap((name) => DIMENSION_PREDICATES[name]));
  const coverage = subjectCoverage(claimDecisions, requiredPredicates, clock);
  const best = coverage[0] ?? Object.freeze({
    subject_ref: null,
    current_predicates: Object.freeze([]),
    stale_predicates: Object.freeze([]),
    contradicted_predicates: Object.freeze([]),
    unknown_predicates: Object.freeze([]),
    evidence: Object.freeze([]),
  });
  const coveredPredicates = best.current_predicates;
  const blockingPredicates = requiredPredicates.filter((predicate) => !coveredPredicates.includes(predicate));
  const missingEvidence = blockingPredicates.filter((predicate) => (
    !best.stale_predicates.includes(predicate)
    && !best.contradicted_predicates.includes(predicate)
    && !best.unknown_predicates.includes(predicate)
  ));
  const answerable = requiredPredicates.length > 0
    && unsupportedKnownDimensions.length === 0
    && blockingPredicates.length === 0;
  const evidenceDigest = digest({
    schema_version: ANSWERABILITY_FRONTIER_VERSION,
    coverage,
  });
  const frontierBody = {
    schema_version: ANSWERABILITY_FRONTIER_VERSION,
    evidence_gate_version: ANSWERABILITY_EVIDENCE_GATE_VERSION,
    tenant: canonicalTenantValue,
    intent_scope: intentScope,
    required_predicates: requiredPredicates,
    unsupported_known_dimensions: unsupportedKnownDimensions,
    answerable,
    answerable_subject_ref: answerable ? best.subject_ref : null,
    covered_predicates: coveredPredicates,
    blocking_predicates: blockingPredicates,
    stale_predicates: best.stale_predicates,
    contradicted_predicates: best.contradicted_predicates,
    unknown_predicates: best.unknown_predicates,
    missing_evidence: Object.freeze(missingEvidence),
    subject_coverage: coverage,
    evidence_digest: evidenceDigest,
  };
  return Object.freeze({
    ...frontierBody,
    frontier_key: digest(frontierBody),
  });
}

export function projectionClaimDecisions(retailers, requiredPredicates) {
  return Object.freeze((retailers ?? []).flatMap((retailer) => (
    requiredPredicates.map((predicate) => Object.freeze({
      subject_ref: retailer.id,
      predicate,
      verification: 'VERIFIED',
      decision_eligible: true,
      observed_at: retailer.verifiedAt,
      freshness_expires_at: retailer.freshnessExpiresAt,
      evidence_ref: `retailer-current-projection:${retailer.id}`,
    }))
  )));
}
