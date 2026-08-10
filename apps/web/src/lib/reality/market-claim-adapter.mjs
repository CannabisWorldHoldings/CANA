const PUBLIC_FIELDS = Object.freeze([
  'license',
  'name',
  'address',
  'location',
  'is_open',
  'hours',
  'phone',
  'website',
  'service_area',
  'delivery',
  'menu',
  'price',
  'availability',
  'deals',
]);

const PREDICATE_FIELD = Object.freeze({
  license_number: 'license',
  license_status: 'license',
  license_type: 'license',
  license_expiration: 'license',
  facility_name: 'name',
  regulated_address: 'address',
  located_at: 'location',
  operating_status: 'is_open',
  hours: 'hours',
  phone: 'phone',
  website: 'website',
  service_area: 'service_area',
  delivery: 'delivery',
  menu: 'menu',
  price: 'price',
  availability: 'availability',
  deals: 'deals',
});

function unknown(reason = 'NO_DECISION_ELIGIBLE_CLAIM') {
  return Object.freeze({ state: 'UNKNOWN', reason });
}

function eligible(decision, asOf) {
  if (!decision?.decision_eligible || !['VERIFIED', 'SUPPORTED'].includes(decision.verification)) return false;
  const observed = new Date(decision.observed_at);
  const expires = new Date(decision.freshness_expires_at);
  return Number.isFinite(observed.getTime()) && Number.isFinite(expires.getTime()) && observed <= asOf && expires > asOf;
}

function known(decisions) {
  const values = Object.fromEntries(decisions.map((decision) => [decision.predicate, decision.value]));
  return Object.freeze({
    state: 'KNOWN',
    value: decisions.length === 1 ? decisions[0].value : Object.freeze(values),
    provenance: Object.freeze(decisions.map((decision) => Object.freeze({
      source_id: decision.source_id,
      observed_at: decision.observed_at,
      freshness_expires_at: decision.freshness_expires_at,
      confidence: decision.confidence ?? null,
      court_version: decision.court_version ?? null,
    }))),
  });
}

export function compileRetailerTruth({ retailer, claimDecisions = [], asOf = new Date() }) {
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_MARKET_TRUTH_AS_OF_INVALID');
  const projection = { retailer_id: retailer?.id ?? null };
  for (const field of PUBLIC_FIELDS) projection[field] = unknown();
  const byField = new Map();
  for (const decision of claimDecisions) {
    const field = PREDICATE_FIELD[decision?.predicate];
    if (!field || !eligible(decision, clock)) continue;
    const entries = byField.get(field) ?? [];
    entries.push(decision);
    byField.set(field, entries);
  }
  for (const [field, decisions] of byField) {
    decisions.sort((left, right) => String(right.observed_at).localeCompare(String(left.observed_at)) || Number(right.confidence ?? 0) - Number(left.confidence ?? 0));
    projection[field] = known(decisions);
  }
  return Object.freeze(projection);
}

export function compileAbsenceClaim({ predicate, completeness, sourceAllowsAbsenceInference }) {
  if (completeness !== 'COMPLETE') return unknown('SNAPSHOT_NOT_COMPLETE');
  if (!sourceAllowsAbsenceInference) return unknown('SOURCE_DOES_NOT_AUTHORIZE_ABSENCE_INFERENCE');
  return Object.freeze({
    state: 'KNOWN',
    predicate,
    value: 'ABSENT_FROM_COMPLETE_AUTHORIZED_COHORT',
  });
}
