#!/usr/bin/env node
/**
 * CANA SIGNAL-TO-FIX — typed ChangeEvent + governed candidate pipeline
 *
 * WATCH → UNDERSTAND → BRITTLE POINT → ORIGINAL IMPROVEMENT → BUILD
 *       → VERIFY → MEASURE → REMEMBER
 *
 * This is the deterministic, provider-neutral core: it turns competitor
 * evidence into typed events, derives candidates, and refuses to promote
 * anything that lacks evidence. No model call is required, so it runs and is
 * testable today while Hermes' live runtime remains blocked on provider keys.
 *
 * FAIL-CLOSED: a candidate missing evidence, a brittle point, a falsification
 * test, or a rollback is REJECTED — never silently promoted.
 *
 * Usage:
 *   node change_event.mjs --matrix <matrix.json> [--json out.json]
 *   node change_event.mjs --selftest
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(`--${k}`);

export const CHANGE_KINDS = ['VISUAL', 'STRUCTURAL', 'OFFER', 'CONTENT', 'SEO', 'ADVERTISING', 'MERCHANT'];
export const PROMOTION_STAGES = ['PROPOSED', 'VALIDATED', 'SHADOW', 'CANARY', 'PROMOTED'];

const sha = s => createHash('sha256').update(s).digest('hex');
/** Whitespace-only strings are absent. Non-strings are NOT text (verifier MAJOR-1). */
const text = v => typeof v === 'string' && v.trim().length > 0;
/** Strict numeric range — rejects booleans, arrays, strings via coercion (verifier MAJOR-2). */
const ratio = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
/** Delimiter-safe hashing: length-prefix each part so 'a|b'+'c' cannot collide with 'a'+'b|c' (verifier MINOR). */
const joinParts = (...parts) => parts.map(p => { const t = String(p ?? ''); return `${t.length}:${t}`; }).join('|');

/** A typed, evidence-bound observation about a competitor surface. */
export function makeChangeEvent({ source, surface, kind, observedAt, observation, evidenceRef, confidence }) {
  const errors = [];
  if (!text(source)) errors.push('source required (non-blank string)');
  if (!text(surface)) errors.push('surface required (non-blank string)');
  if (!CHANGE_KINDS.includes(kind)) errors.push(`kind must be one of ${CHANGE_KINDS.join('|')}`);
  if (!text(observedAt)) errors.push('observedAt required — an undated observation is not evidence');
  if (!text(observation)) errors.push('observation required (non-blank string)');
  if (!text(evidenceRef)) errors.push('evidenceRef required — every event must cite a retrievable artifact');
  if (!ratio(confidence)) errors.push('confidence must be a finite number in 0..1');
  const ev = {
    event_id: null, source, surface, kind, observed_at: observedAt, observation,
    evidence_ref: evidenceRef, confidence,
    // Freshness is explicit: a 2026-07-23 capture is not current truth.
    freshness_state: 'HISTORICAL_REFERENCE_DATED',
    valid: errors.length === 0, errors,
  };
  // Hash ALL identity-bearing fields, length-prefixed so delimiters cannot be injected.
  ev.event_id = 'ce_' + sha(joinParts(source, surface, kind, observedAt, observation, evidenceRef, confidence)).slice(0, 16);
  return ev;
}

/**
 * A governed response candidate. Requires a brittle point, a falsification
 * test and a rollback — the three things that separate a real experiment from
 * an opinion.
 */
export function makeCandidate({ event, brittlePoint, hypothesis, improvement, falsificationTest, rollback, outcomeMetric, plane }) {
  const errors = [];
  if (!event?.valid) errors.push('candidate requires a VALID ChangeEvent');
  if (!text(brittlePoint)) errors.push('brittlePoint required (non-blank) — without it this is imitation, not improvement');
  if (!text(hypothesis)) errors.push('hypothesis required (non-blank)');
  if (!text(improvement)) errors.push('improvement required (non-blank)');
  if (!text(falsificationTest)) errors.push('falsificationTest required (non-blank) — a candidate that cannot fail is invalid');
  if (!text(rollback)) errors.push('rollback required (non-blank)');
  if (!text(outcomeMetric)) errors.push('outcomeMetric required (non-blank) — no unmeasured change may promote');
  const c = {
    candidate_id: null, event_id: event?.event_id ?? null, plane: plane ?? 'UNASSIGNED',
    brittle_point: brittlePoint, hypothesis, improvement,
    falsification_test: falsificationTest, rollback, outcome_metric: outcomeMetric,
    stage: 'PROPOSED', valid: errors.length === 0, errors,
    // Never copy: recorded explicitly so the intent is auditable.
    originality_assertion: 'Mechanism extracted; no protected branding, layout, reviews or proprietary data copied.',
  };
  c.candidate_id = 'cand_' + sha(joinParts(c.event_id, brittlePoint, improvement, falsificationTest, outcomeMetric)).slice(0, 16);
  return c;
}

/**
 * Promotion court. Stage advances ONE step at a time and only with the
 * evidence that stage requires. Stage-skipping is refused.
 */
export function promote(candidate, { toStage, evidence }) {
  const cur = PROMOTION_STAGES.indexOf(candidate.stage);
  const next = PROMOTION_STAGES.indexOf(toStage);
  if (!candidate.valid) return deny(candidate, 'CANDIDATE_INVALID', candidate.errors.join('; '));
  if (next === -1) return deny(candidate, 'UNKNOWN_STAGE', toStage);
  if (next !== cur + 1) return deny(candidate, 'STAGE_SKIP_DENIED', `${candidate.stage} -> ${toStage}`);
  const need = { VALIDATED: 'test_result', SHADOW: 'shadow_observation', CANARY: 'exposure_record', PROMOTED: 'outcome_measurement' }[toStage];
  if (need && !evidence?.[need]) return deny(candidate, 'EVIDENCE_MISSING', `${toStage} requires ${need}`);
  if (toStage === 'PROMOTED' && evidence.outcome_measurement?.improved !== true) {
    return deny(candidate, 'NO_MEASURED_IMPROVEMENT', 'promotion requires a measured improvement');
  }
  return { ...candidate, stage: toStage, decision: 'ALLOWED', denial_code: null,
    receipt: { at: new Date().toISOString(), stage: toStage, evidence_sha256: sha(JSON.stringify(evidence ?? {})) } };
}
function deny(candidate, code, detail) {
  return { ...candidate, decision: 'DENIED', denial_code: code, denial_detail: detail,
    receipt: { at: new Date().toISOString(), stage: candidate.stage, denied: true } };
}

/** Winner Memory: only measured outcomes are remembered as lessons. */
export function toWinnerMemory(candidate, outcome) {
  // CRITICAL FIX (independent verifier): gating on the .stage STRING alone let a
  // forged object literal {stage:'PROMOTED'} be stored as a validated lesson, and
  // silently stored genuine DENIED court results. Winner Memory must verify the
  // whole decision, and must see the measured improvement itself.
  if (!candidate || typeof candidate !== 'object') return { stored: false, reason: 'candidate must be a court result object' };
  if (candidate.stage !== 'PROMOTED') return { stored: false, reason: 'only PROMOTED candidates enter Winner Memory' };
  if (candidate.valid !== true) return { stored: false, reason: 'candidate is not valid' };
  if (candidate.decision !== 'ALLOWED') return { stored: false, reason: `candidate decision is ${candidate.decision ?? 'absent'} — only ALLOWED court results may be remembered` };
  if (candidate.denial_code != null) return { stored: false, reason: `candidate carries denial_code ${candidate.denial_code}` };
  if (!candidate.receipt?.evidence_sha256) return { stored: false, reason: 'candidate lacks a court receipt — it never passed through promote()' };
  if (!text(candidate.candidate_id) || !text(candidate.brittle_point)) return { stored: false, reason: 'candidate is missing identity or brittle point' };
  if (outcome?.improved !== true) return { stored: false, reason: 'Winner Memory stores only measured improvements (outcome.improved must be true)' };
  return { stored: true, lesson_id: 'wm_' + sha(candidate.candidate_id).slice(0, 12),
    plane: candidate.plane, brittle_point: candidate.brittle_point, improvement: candidate.improvement,
    outcome_metric: candidate.outcome_metric, measured: outcome, learned_at: new Date().toISOString() };
}

// ---------------- self-test: the court must be able to DENY ----------------
if (has('selftest')) {
  let pass = 0, fail = 0;
  const t = (name, cond) => { cond ? (pass++, console.log(`  ok   ${name}`)) : (fail++, console.log(`  FAIL ${name}`)); };

  const good = makeChangeEvent({ source: 'Leafly', surface: '/dispensaries/district-of-columbia', kind: 'ADVERTISING',
    observedAt: '2026-07-23', observation: 'first 5 results sponsored, no per-card badge',
    evidenceRef: 'leafly-field-recon-2026-07-23.md', confidence: 0.9 });
  t('valid event accepted', good.valid);
  // Determinism = identical inputs -> identical id. evidenceRef and confidence
  // are now part of the hash (verifier: the old hash was not injective), so a
  // DIFFERENT evidenceRef must produce a DIFFERENT id.
  t('event id is deterministic for identical inputs', good.event_id === makeChangeEvent({ source: 'Leafly', surface: '/dispensaries/district-of-columbia', kind: 'ADVERTISING', observedAt: '2026-07-23', observation: 'first 5 results sponsored, no per-card badge', evidenceRef: 'leafly-field-recon-2026-07-23.md', confidence: 0.9 }).event_id);
  t('event id changes when evidenceRef changes', good.event_id !== makeChangeEvent({ ...good, source: 'Leafly', surface: '/dispensaries/district-of-columbia', kind: 'ADVERTISING', observedAt: '2026-07-23', observation: 'first 5 results sponsored, no per-card badge', evidenceRef: 'other.md', confidence: 0.9 }).event_id);
  t('delimiter injection cannot collide ids', makeChangeEvent({ ...good, source: 'a|b', surface: 'c' }).event_id !== makeChangeEvent({ ...good, source: 'a', surface: 'b|c' }).event_id);
  t('undated observation rejected', !makeChangeEvent({ ...good, observedAt: null }).valid);
  t('unsourced observation rejected', !makeChangeEvent({ ...good, evidenceRef: null }).valid);
  t('bad kind rejected', !makeChangeEvent({ ...good, kind: 'VIBES' }).valid);
  t('out-of-range confidence rejected', !makeChangeEvent({ ...good, confidence: 1.7 }).valid);
  // MAJOR-1/2 regression guards from independent verification:
  t('whitespace-only source rejected', !makeChangeEvent({ ...good, source: '   ' }).valid);
  t('whitespace-only evidenceRef rejected', !makeChangeEvent({ ...good, evidenceRef: '\t' }).valid);
  t('array masquerading as text rejected', !makeChangeEvent({ ...good, observation: [] }).valid);
  t('object masquerading as text rejected', !makeChangeEvent({ ...good, surface: {} }).valid);
  for (const bad of [false, true, '', ' ', [], [0.5], {}, '0.5']) {
    t(`confidence coercion attack rejected: ${JSON.stringify(bad)}`, !makeChangeEvent({ ...good, confidence: bad }).valid);
  }
  t('whitespace-only brittlePoint rejected', !makeCandidate({ event: good, brittlePoint: '   ', hypothesis: 'h', improvement: 'i', falsificationTest: 'f', rollback: 'r', outcomeMetric: 'm' }).valid);

  const cand = makeCandidate({ event: good, plane: 'advertising',
    brittlePoint: 'disclosure is one header, not per-card',
    hypothesis: 'per-card sponsorship labels + provably unchanged organic order raise trust without losing revenue',
    improvement: 'per-card badge + ordering guard test',
    falsificationTest: 'toggle sponsorship and assert organic order is byte-identical',
    rollback: 'revert badge component; guard test remains',
    outcomeMetric: 'ranking positions changed by sponsorship state (target 0)' });
  t('valid candidate accepted', cand.valid);
  t('candidate without brittle point rejected', !makeCandidate({ ...cand, event: good, brittlePoint: null }).valid);
  t('candidate without falsification test rejected', !makeCandidate({ ...cand, event: good, falsificationTest: null }).valid);
  t('candidate without rollback rejected', !makeCandidate({ ...cand, event: good, rollback: null }).valid);
  t('candidate without outcome metric rejected', !makeCandidate({ ...cand, event: good, outcomeMetric: null }).valid);
  t('candidate on invalid event rejected', !makeCandidate({ ...cand, event: { valid: false } }).valid);

  t('stage skip denied', promote(cand, { toStage: 'PROMOTED', evidence: { outcome_measurement: { improved: true } } }).denial_code === 'STAGE_SKIP_DENIED');
  t('validate without test result denied', promote(cand, { toStage: 'VALIDATED', evidence: {} }).denial_code === 'EVIDENCE_MISSING');
  const v = promote(cand, { toStage: 'VALIDATED', evidence: { test_result: { passed: true } } });
  t('validate with test result allowed', v.decision === 'ALLOWED' && v.stage === 'VALIDATED');
  const s = promote(v, { toStage: 'SHADOW', evidence: { shadow_observation: { ok: true } } });
  t('shadow allowed with observation', s.decision === 'ALLOWED');
  const cn = promote(s, { toStage: 'CANARY', evidence: { exposure_record: { pct: 5 } } });
  t('canary allowed with exposure record', cn.decision === 'ALLOWED');
  t('promote denied without measured improvement', promote(cn, { toStage: 'PROMOTED', evidence: { outcome_measurement: { improved: false } } }).denial_code === 'NO_MEASURED_IMPROVEMENT');
  const p = promote(cn, { toStage: 'PROMOTED', evidence: { outcome_measurement: { improved: true, delta: 1 } } });
  t('promote allowed with measured improvement', p.decision === 'ALLOWED' && p.stage === 'PROMOTED');
  t('receipt carries evidence hash', !!p.receipt.evidence_sha256);

  t('winner memory rejects unpromoted', toWinnerMemory(cand, {}).stored === false);
  t('winner memory accepts promoted WITH measured improvement', toWinnerMemory(p, { improved: true, delta: 1 }).stored === true);
  t('winner memory refuses promoted WITHOUT measured improvement', toWinnerMemory(p, { delta: 1 }).stored === false);
  // CRITICAL regression guards from independent verification:
  t('winner memory refuses a FORGED object literal', toWinnerMemory({ stage: 'PROMOTED' }, { improved: true }).stored === false);
  t('winner memory refuses a DENIED court result', toWinnerMemory(promote(p, { toStage: 'PROMOTED', evidence: { outcome_measurement: { improved: true } } }), { improved: true }).stored === false);
  t('winner memory refuses a candidate with no court receipt', toWinnerMemory({ ...p, receipt: undefined }, { improved: true }).stored === false);
  t('winner memory refuses non-object input', toWinnerMemory('PROMOTED', { improved: true }).stored === false);

  console.log(`\n  Signal-to-Fix self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------- pipeline over the compiled matrix ----------------
const MATRIX = arg('matrix', null);
if (MATRIX) {
  const rows = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const out = [];
  for (const r of rows) {
    const ev = makeChangeEvent({ source: r.source, surface: r.surface, kind: r.kind,
      observedAt: r.observed_at, observation: r.observation, evidenceRef: r.evidence_ref, confidence: r.confidence });
    const cand = makeCandidate({ event: ev, plane: r.plane, brittlePoint: r.brittle_point,
      hypothesis: r.hypothesis, improvement: r.improvement, falsificationTest: r.falsification_test,
      rollback: r.rollback, outcomeMetric: r.outcome_metric });
    out.push({ event: ev, candidate: cand });
  }
  const valid = out.filter(x => x.candidate.valid).length;
  console.log(`\n=== SIGNAL-TO-FIX PIPELINE ===`);
  console.log(`  events in: ${rows.length}  valid events: ${out.filter(x => x.event.valid).length}  valid candidates: ${valid}  rejected: ${out.length - valid}`);
  for (const x of out) {
    const mark = x.candidate.valid ? '✓' : '✗';
    console.log(`  ${mark} [${x.event.kind}] ${x.event.source} ${x.event.surface}`);
    console.log(`      brittle: ${String(x.candidate.brittle_point).slice(0, 88)}`);
    if (!x.candidate.valid) console.log(`      REJECTED: ${x.candidate.errors.join('; ')}`);
  }
  const J = arg('json', null);
  if (J) { fs.writeFileSync(J, JSON.stringify(out, null, 2)); console.log(`\n  -> ${J}`); }
}
