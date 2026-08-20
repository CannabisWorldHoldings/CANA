// MARKET-STATE SEPARATION LAW — constitution law 5, made mechanical.
// (OWD-REALITY typing kernel; external red-team + vNEXT §VI, adopted.)
//
// Four kinds of market state, never silently mixed:
//
//   OBSERVED_REALITY         directly supported observation — evidence + time
//   ESTIMATED_CURRENT_STATE  probabilistic belief about now — method + basis
//   FORECAST_STATE           prediction about the future — ledger-bound
//   COUNTERFACTUAL_WORLD     estimated world under an intervention — never observed
//
// The courts this kernel ships:
//   MIXING COURT      only fresh OBSERVED_REALITY promotes to listing-fact
//                     eligibility. A forecast is never inventory
//                     (FORECAST_IS_NOT_INVENTORY); an estimate is never evidence
//                     (ESTIMATE_IS_NOT_EVIDENCE); a simulation is never a fact
//                     (SIMULATION_IS_NOT_A_FACT).
//   LAUNDERING COURT  a derived claim carries the WEAKEST kind among its inputs;
//                     declaring a stronger kind is TYPE_LAUNDERING, refused.
//   TRANSITION COURT  observations decay to ESTIMATED by an EXPLICIT, recorded
//                     transition — never by silence; upgrades to OBSERVED happen
//                     only through a NEW observation with evidence
//                     (NO_SILENT_UPGRADE).
//
// This kernel is the contract the market compilers call; wiring it into the
// Prisma claim pipeline is the registry-recorded next bottleneck. It carries
// no I/O — pure, deterministic, courtable.
const text = (v) => typeof v === 'string' && v.trim() !== '';
const validTime = (v) => text(v) && !Number.isNaN(Date.parse(v));
const hasEvidence = (e) => Array.isArray(e) && e.length > 0 && e.every((x) => text(x?.observation) && text(x?.ref));

export class StateLawError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'StateLawError'; this.code = code; }
}
const refuse = (code, msg) => { throw new StateLawError(code, msg); };

export const STATE_KINDS = Object.freeze([
  'OBSERVED_REALITY', 'ESTIMATED_CURRENT_STATE', 'FORECAST_STATE', 'COUNTERFACTUAL_WORLD',
]);
// Strength order for the laundering court (weakest first).
const STRENGTH = Object.freeze({
  COUNTERFACTUAL_WORLD: 0, FORECAST_STATE: 1, ESTIMATED_CURRENT_STATE: 2, OBSERVED_REALITY: 3,
});

/** Validate one market-state assertion. Fail-closed per kind. */
export function validateAssertion(a) {
  if (!a || typeof a !== 'object') refuse('ASSERTION_ABSENT', 'a market-state assertion object is required');
  if (!text(a.target)) refuse('ASSERTION_FIELD', 'target required — which fact about the market?');
  if (!STATE_KINDS.includes(a.state_kind)) refuse('STATE_KIND_REQUIRED', `state_kind must be one of ${STATE_KINDS.join('|')} — untyped market state is the disease this law cures`);

  if (a.state_kind === 'OBSERVED_REALITY') {
    if (!hasEvidence(a.evidence)) refuse('OBSERVATION_UNEVIDENCED', `${a.target}: an observation without evidence refs is a rumor`);
    if (!validTime(a.observed_at)) refuse('OBSERVATION_UNDATED', `${a.target}: observed_at required — reality happens at a time`);
    if (typeof a.probability === 'number') refuse('OBSERVATION_IS_NOT_A_GUESS', `${a.target}: an observation carries no probability — if it is probabilistic, it is an ESTIMATE`);
  }
  if (a.state_kind === 'ESTIMATED_CURRENT_STATE') {
    if (!text(a.method)) refuse('ESTIMATE_METHOD', `${a.target}: an estimate must state its method`);
    if (!(typeof a.confidence === 'number' && a.confidence > 0 && a.confidence < 1)) refuse('ESTIMATE_CONFIDENCE', `${a.target}: confidence strictly between 0 and 1 — certainty is an observation, not an estimate`);
    if (!hasEvidence(a.basis)) refuse('ESTIMATE_BASELESS', `${a.target}: an estimate must cite the observations it rests on`);
    if (!validTime(a.as_of)) refuse('ESTIMATE_UNDATED', `${a.target}: as_of required`);
    if (!text(a.estimator)) refuse('ESTIMATOR_REQUIRED', `${a.target}: estimator identity required — anonymous belief is refused`);
  }
  if (a.state_kind === 'FORECAST_STATE') {
    if (!text(a.forecast_ref) || !a.forecast_ref.startsWith('fc_')) refuse('FORECAST_UNLEDGERED', `${a.target}: a forecast state must reference its forecast-ledger id (fc_…) — predictions live where reality can grade them`);
    if (!validTime(a.resolves_by)) refuse('FORECAST_HORIZON', `${a.target}: resolves_by required`);
    if (a.observed_at != null) refuse('FORECAST_IS_NOT_OBSERVED', `${a.target}: a forecast carries no observed_at — the future has not been seen`);
  }
  if (a.state_kind === 'COUNTERFACTUAL_WORLD') {
    if (!text(a.intervention)) refuse('COUNTERFACTUAL_INTERVENTION', `${a.target}: a counterfactual must name its hypothetical intervention`);
    if (!text(a.method)) refuse('COUNTERFACTUAL_METHOD', `${a.target}: estimation method required`);
    if (a.observed_at != null || a.observed === true) refuse('SIMULATION_IS_NOT_OBSERVED', `${a.target}: a counterfactual world was never observed and never will be — it is an estimate of a road not taken`);
  }
  return Object.freeze({ ...a });
}

/**
 * MIXING COURT — listing-fact eligibility. Only fresh OBSERVED_REALITY passes.
 * Refusal codes name the exact confusion being prevented.
 */
export function promoteToListingFact(a, { now = new Date(), maxAgeDays = 30 } = {}) {
  validateAssertion(a);
  if (a.state_kind === 'FORECAST_STATE') refuse('FORECAST_IS_NOT_INVENTORY', `${a.target}: a prediction of stock is not stock — resolve the forecast, then observe`);
  if (a.state_kind === 'ESTIMATED_CURRENT_STATE') refuse('ESTIMATE_IS_NOT_EVIDENCE', `${a.target}: a belief about now is not an observation of now`);
  if (a.state_kind === 'COUNTERFACTUAL_WORLD') refuse('SIMULATION_IS_NOT_A_FACT', `${a.target}: a simulated world cannot appear on a listing`);
  const age = now.getTime() - Date.parse(a.observed_at);
  if (age > maxAgeDays * 86400000) {
    refuse('OBSERVATION_STALE', `${a.target}: observed ${Math.round(age / 86400000)}d ago (limit ${maxAgeDays}d) — degrade it to an ESTIMATE explicitly or observe again`);
  }
  return { eligible: true, target: a.target, state_kind: a.state_kind, observed_at: a.observed_at };
}

/**
 * LAUNDERING COURT — derivation typing. The output kind is the WEAKEST input
 * kind; any declared kind stronger than that is TYPE_LAUNDERING.
 */
export function deriveClaim({ target, inputs, declared_kind }) {
  if (!text(target)) refuse('ASSERTION_FIELD', 'derived claim needs a target');
  if (!Array.isArray(inputs) || inputs.length === 0) refuse('DERIVATION_EMPTY', 'a derivation without inputs derives nothing');
  for (const i of inputs) validateAssertion(i);
  const weakest = inputs.reduce((w, i) => (STRENGTH[i.state_kind] < STRENGTH[w] ? i.state_kind : w), 'OBSERVED_REALITY');
  if (declared_kind != null) {
    if (!STATE_KINDS.includes(declared_kind)) refuse('STATE_KIND_REQUIRED', `declared_kind must be one of ${STATE_KINDS.join('|')}`);
    if (STRENGTH[declared_kind] > STRENGTH[weakest]) {
      refuse('TYPE_LAUNDERING', `${target}: derivation includes ${weakest} inputs but declares ${declared_kind} — a chain is as observed as its least-observed link`);
    }
  }
  return {
    target,
    state_kind: declared_kind ?? weakest,
    derived: true,
    derivation: inputs.map((i) => ({ target: i.target, state_kind: i.state_kind })),
    law: 'a derived claim carries the weakest kind among its inputs',
  };
}

/**
 * TRANSITION COURT — explicit, recorded decay; no silent upgrades.
 */
export function transition(a, { to, method, estimator, evidence, now = new Date() }) {
  validateAssertion(a);
  if (!STATE_KINDS.includes(to)) refuse('STATE_KIND_REQUIRED', `transition target kind must be one of ${STATE_KINDS.join('|')}`);
  if (STRENGTH[to] > STRENGTH[a.state_kind]) {
    if (a.state_kind !== 'ESTIMATED_CURRENT_STATE' || to !== 'OBSERVED_REALITY') {
      refuse('NO_SILENT_UPGRADE', `${a.target}: ${a.state_kind} cannot strengthen to ${to} — only a NEW observation upgrades an estimate`);
    }
    if (!hasEvidence(evidence)) refuse('NO_SILENT_UPGRADE', `${a.target}: upgrading an estimate to observed requires NEW observation evidence`);
    return {
      transitioned: true, from: a.state_kind, to,
      record: validateAssertion({ target: a.target, state_kind: 'OBSERVED_REALITY', evidence, observed_at: now.toISOString() }),
      note: 'upgrade earned by new observation — not by confidence, not by time',
    };
  }
  // Downgrade path: observed → estimated (decay), anything → weaker is honest.
  if (a.state_kind === 'OBSERVED_REALITY' && to === 'ESTIMATED_CURRENT_STATE') {
    if (!text(method) || !text(estimator)) refuse('ESTIMATE_METHOD', `${a.target}: decay to estimate must state method + estimator`);
    return {
      transitioned: true, from: a.state_kind, to,
      record: validateAssertion({
        target: a.target, state_kind: 'ESTIMATED_CURRENT_STATE',
        method, estimator, confidence: 0.5,
        basis: a.evidence, as_of: now.toISOString(),
        decayed_from_observation_at: a.observed_at,
      }),
      note: 'explicit decay recorded — staleness never masquerades as currency',
    };
  }
  refuse('TRANSITION_UNDEFINED', `${a.target}: no lawful transition ${a.state_kind} → ${to}`);
}
