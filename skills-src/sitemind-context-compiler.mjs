#!/usr/bin/env node
/**
 * SITEMIND CONTEXT COMPILER
 *
 * RSI/SiteMind plane. Compiles a SEALED MISSION PACKET from labeled state so an
 * executing agent receives exactly the context a task needs — with provenance
 * attached and nothing unlabeled able to drive actuation.
 *
 * THE PROBLEM IT SOLVES, observed repeatedly in this very run:
 *   - a stale server served a 404 and a court measured the wrong build
 *   - a mutation script ran from the wrong directory and silently no-opped
 *   - unlabeled competitor facts dated 2026-07-23 risked being read as current
 * Each was a CONTEXT failure, not a logic failure. An agent acted on state it
 * had not verified was the state it thought it had.
 *
 * DESIGN LAWS (each enforced, not documented):
 *   1. NOTHING UNLABELED ACTUATES. Every fact carries authority, truth_status
 *      and freshness. Facts below the actuation bar are included as REFERENCE
 *      and explicitly marked non-actionable.
 *   2. CONTRADICTIONS ARE PRESERVED, NEVER COLLAPSED. Two sources disagreeing
 *      is itself a finding; silently picking one destroys the signal.
 *   3. STALENESS IS COMPUTED, NOT ASSUMED. A fact with an observation date past
 *      its freshness window is demoted automatically.
 *   4. THE PACKET IS SEALED. Its digest covers the exact facts included, so a
 *      receipt can prove which context produced which action.
 *   5. BUDGETED. Context is finite; facts are admitted by priority and the
 *      packet records what was excluded and why, rather than silently dropping.
 *
 * Usage:
 *   node compiler.mjs --selftest
 *   node compiler.mjs --state <mission_state.json> [--objective "..."] [--json out.json]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };

const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * A fact may only drive actuation when its evidence is CURRENT. Hoisted to module
 * scope so labelFact and findContradictions cannot drift apart: the contradiction
 * summary must judge "is the strongest authority usable?" by the SAME rule the
 * labeller uses to permit action.
 */
const FRESHNESS_ALLOWS_ACTUATION = new Set(['CURRENT']);

/** Authority ranking from the V9 data-labeling contract. Lower index = stronger. */
export const AUTHORITY_ORDER = Object.freeze([
  'OWNER_EXPLICIT_DIRECTIVE', 'OWNER_APPROVED_ARTIFACT', 'INDEPENDENTLY_VERIFIED_RECEIPT',
  'LIVE_RUNTIME_OR_BROWSER_EVIDENCE', 'CURRENT_SOURCE_CODE', 'HASHED_SOURCE_ARTIFACT',
  'DERIVED_REPORT', 'HISTORICAL_REFERENCE', 'RESEARCH_CANDIDATE', 'MODEL_INFERENCE',
  'UNKNOWN_AUTHORITY',
]);
/** Truth states that may drive actuation. Everything else is reference only. */
export const ACTUATION_TRUTH = new Set(['VERIFIED', 'OBSERVED', 'TESTED', 'RUNNING', 'RECOVERED']);
/** The strongest authority that still may NOT actuate on its own. */
const NON_ACTUATING_AUTHORITY = new Set(['HISTORICAL_REFERENCE', 'RESEARCH_CANDIDATE', 'MODEL_INFERENCE', 'UNKNOWN_AUTHORITY']);

const rank = (a) => { const i = AUTHORITY_ORDER.indexOf(a); return i === -1 ? AUTHORITY_ORDER.length : i; };

/**
 * Normalize a raw fact into a labeled one, computing staleness rather than
 * trusting a caller-supplied flag.
 */
export function labelFact(raw, now = new Date()) {
  const errors = [];
  if (!text(raw?.id)) errors.push('id required');
  if (!text(raw?.claim)) errors.push('claim required');
  if (!AUTHORITY_ORDER.includes(raw?.authority)) errors.push(`authority must be one of ${AUTHORITY_ORDER.length} known values`);
  if (!text(raw?.truth_status)) errors.push('truth_status required');
  if (!text(raw?.source)) errors.push('source required — an uncited fact is not a fact');

  const observedAt = raw?.observed_at ? new Date(raw.observed_at) : null;
  // C-HIGH (independent verifier): a STRINGIFIED valid_for_days ('7') failed the
  // Number.isFinite test, became null, and disabled staleness entirely — a
  // 6.5-year-old fact stayed actionable. Coerce numeric strings, then demand a
  // sane positive finite window.
  const rawWindow = typeof raw?.valid_for_days === 'string' && raw.valid_for_days.trim() !== ''
    ? Number(raw.valid_for_days) : raw?.valid_for_days;
  //
  // V2-D (independent verifier, LOW): there was NO CEILING on the declared
  // window, so valid_for_days = 1e9 kept a 2,398-day-old fact reading CURRENT
  // and actionable — roughly 2.7 million years of self-declared validity. The
  // design says staleness is COMPUTED, not asserted; an unbounded self-declared
  // window hands that decision straight back to the fact's author. Cap it. A
  // window beyond the ceiling is treated as an unusable declaration
  // (DATED_NO_WINDOW -> not actionable) rather than silently clamped, because
  // clamping would quietly rewrite the author's claim.
  const MAX_VALID_FOR_DAYS = 3650; // 10 years; longer is not a freshness claim
  const validForDays =
    Number.isFinite(rawWindow) && rawWindow >= 0 && rawWindow <= MAX_VALID_FOR_DAYS
      ? rawWindow : null;
  let freshness = 'UNDATED';
  let ageDays = null;
  if (observedAt && !Number.isNaN(observedAt.getTime())) {
    ageDays = Math.floor((now - observedAt) / 86400_000);
    // C1 (independent verifier, CRITICAL): a FUTURE-dated observation produced a
    // NEGATIVE age, so `ageDays <= validForDays` was trivially true and the fact
    // read as CURRENT and actionable. An impossible timestamp is the strongest
    // signal a fact is untrustworthy, and it had become the easiest way to make
    // one drive actuation. A small clock-skew allowance is legitimate; a
    // genuinely future observation is not.
    const SKEW_DAYS = 1;
    if (ageDays < -SKEW_DAYS) freshness = 'FUTURE_DATED';
    else freshness = validForDays == null ? 'DATED_NO_WINDOW'
      : ageDays <= validForDays ? 'CURRENT' : 'STALE';
  }

  // LAW 1 + 3: actuation requires strong authority, an actuating truth state,
  // and non-stale evidence. Staleness is computed here, never asserted.
  // C-HIGH: UNDATED facts were actionable. A fact whose observation time is
  // unknown cannot be shown to be current, and "we don't know when this was
  // true" is not a basis for action. DATED_NO_WINDOW is likewise refused: a date
  // with no declared validity window cannot be tested for staleness.
  const actionable =
    errors.length === 0 &&
    !NON_ACTUATING_AUTHORITY.has(raw.authority) &&
    ACTUATION_TRUTH.has(raw.truth_status) &&
    FRESHNESS_ALLOWS_ACTUATION.has(freshness);

  const reasons = [];
  if (errors.length) reasons.push('malformed');
  if (NON_ACTUATING_AUTHORITY.has(raw?.authority)) reasons.push(`authority ${raw.authority} is reference-only`);
  if (!ACTUATION_TRUTH.has(raw?.truth_status)) reasons.push(`truth_status ${raw?.truth_status} does not permit actuation`);
  if (freshness === 'STALE') reasons.push(`observation is ${ageDays}d old, past its ${validForDays}d window`);
  if (freshness === 'FUTURE_DATED') reasons.push(`observation is dated ${Math.abs(ageDays)}d in the FUTURE — an impossible timestamp cannot be evidence`);
  if (freshness === 'UNDATED') reasons.push('no observation date — a fact that cannot be dated cannot be shown to be current');
  if (freshness === 'DATED_NO_WINDOW') reasons.push('no valid_for_days window — staleness cannot be evaluated');

  return {
    id: raw?.id, claim: raw?.claim, authority: raw?.authority, truth_status: raw?.truth_status,
    source: raw?.source, observed_at: raw?.observed_at ?? null,
    freshness, age_days: ageDays, valid_for_days: validForDays,
    actionable, non_actionable_reasons: reasons,
    authority_rank: rank(raw?.authority), valid: errors.length === 0, errors,
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
  };
}

/**
 * LAW 2: detect facts that contradict each other and PRESERVE both.
 * Two facts conflict when they share a subject tag but assert different claims.
 */
export function findContradictions(facts) {
  // C-HIGH (independent verifier): using .find took only the FIRST subject tag,
  // so a fact tagged with several subjects was compared under one of them and
  // silently escaped contradiction detection under the others. Index under EVERY
  // subject a fact claims.
  //
  // TWO FURTHER DEFECTS the second independent verifier found in THIS fix:
  //
  //  V2-A (correctness regression the patch introduced): .filter + push let the
  //     SAME fact enter one group twice when it carried a duplicate subject tag
  //     (['subject:s','subject:s']), inflating claims.length. Two facts reported
  //     as three conflicting claims is a fabricated count. Dedupe per fact.
  //  V2-B (MEDIUM escape): subject tags were matched raw, so 'subject:Repo' and
  //     'subject:repo ' were different subjects and a contradiction escaped
  //     silently by trivial case/whitespace variation. LAW 2 says a
  //     contradiction must never be silently collapsed; being silently MISSED is
  //     the same harm. Subjects are normalized for GROUPING while the original
  //     spelling is preserved for the operator.
  const norm = (t) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  const bySubject = new Map();
  for (const f of facts) {
    const seenForThisFact = new Set();
    for (const raw of f.tags.filter((t) => typeof t === 'string' && t.trim().toLowerCase().startsWith('subject:'))) {
      const key = norm(raw);
      if (seenForThisFact.has(key)) continue; // V2-A: one membership per fact
      seenForThisFact.add(key);
      if (!bySubject.has(key)) bySubject.set(key, { display: raw.trim(), facts: [] });
      bySubject.get(key).facts.push(f);
    }
  }
  const out = [];
  for (const [key, { display, facts: group }] of bySubject) {
    const claims = new Set(group.map((g) => g.claim));
    if (claims.size > 1) {
      const sorted = [...group].sort((a, b) => a.authority_rank - b.authority_rank);
      const strongest = sorted[0];
      // V2-C (MEDIUM): the summary told the operator to prefer the strongest
      // authority without checking whether that fact was still usable. A STALE
      // OWNER_EXPLICIT_DIRECTIVE outranks a fresh live observation, so the
      // guidance could point at evidence the compiler itself refuses to act on.
      // Name that explicitly rather than leaving it inferable from per-claim
      // freshness the reader may not cross-check.
      const strongestActionable = FRESHNESS_ALLOWS_ACTUATION.has(strongest.freshness);
      const freshestStrong = sorted.find((g) => FRESHNESS_ALLOWS_ACTUATION.has(g.freshness)) ?? null;
      out.push({
        subject: display,
        subject_key: key,
        claims: group.map((g) => ({ id: g.id, claim: g.claim, authority: g.authority, source: g.source, freshness: g.freshness })),
        // Record which is stronger WITHOUT deleting the weaker one.
        strongest_authority: strongest.authority,
        strongest_id: strongest.id,
        strongest_is_actionable: strongestActionable,
        strongest_freshness: strongest.freshness,
        strongest_actionable_id: freshestStrong ? freshestStrong.id : null,
        resolution: 'PRESERVED_UNRESOLVED',
        note: strongestActionable
          ? 'Both claims retained. Authority ranking indicates which to prefer, but the disagreement is itself evidence and must reach the operator.'
          : `Both claims retained. WARNING: the strongest authority (${strongest.id}, ${strongest.authority}) is ${strongest.freshness} and is NOT actionable. Do not prefer it on authority alone. ${freshestStrong ? `The strongest ACTIONABLE claim is ${freshestStrong.id} (${freshestStrong.authority}).` : 'NO claim on this subject is actionable.'}`,
      });
    }
  }
  return out;
}

/**
 * Compile a sealed mission packet.
 * LAW 5: admits facts by priority within a budget and records exclusions.
 */
export function compile({ objective, facts, now = new Date(), maxFacts = 40, requireActionable = true }) {
  const errors = [];
  if (!text(objective)) errors.push('objective required — a packet without a goal cannot be scoped');
  if (!Array.isArray(facts)) errors.push('facts must be an array');
  if (errors.length) return { valid: false, errors, packet: null };

  const labeled = facts.map((f) => labelFact(f, now));
  const malformed = labeled.filter((f) => !f.valid);
  const wellFormed = labeled.filter((f) => f.valid);

  const contradictions = findContradictions(wellFormed);

  // Relevance: facts tagged for this objective rank first, then by authority,
  // then by freshness. Deterministic so the same inputs seal the same packet.
  const objTokens = objective.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const relevance = (f) => {
    const hay = `${f.claim} ${f.tags.join(' ')}`.toLowerCase();
    return objTokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
  };
  const ordered = [...wellFormed].sort((a, b) =>
    relevance(b) - relevance(a) ||
    a.authority_rank - b.authority_rank ||
    (a.freshness === 'CURRENT' ? -1 : 1) - (b.freshness === 'CURRENT' ? -1 : 1) ||
    String(a.id).localeCompare(String(b.id)));

  const admitted = ordered.slice(0, maxFacts);
  const excluded = ordered.slice(maxFacts).map((f) => ({ id: f.id, reason: 'context budget exceeded' }))
    .concat(malformed.map((f) => ({ id: f.id ?? '(no id)', reason: `malformed: ${f.errors.join('; ')}` })));

  const actionable = admitted.filter((f) => f.actionable);
  const reference = admitted.filter((f) => !f.actionable);

  if (requireActionable && actionable.length === 0) {
    return {
      valid: false,
      errors: ['no actionable fact survived labeling — refusing to seal a packet that could only drive action from unlabeled or stale evidence'],
      packet: null,
      diagnostics: { admitted: admitted.length, reference: reference.length, excluded: excluded.length },
    };
  }

  const body = {
    objective,
    compiled_at: now.toISOString(),
    actionable_facts: actionable.map(({ authority_rank, valid, errors, ...f }) => f),
    reference_facts: reference.map(({ authority_rank, valid, errors, ...f }) => f),
    contradictions,
    excluded,
    counts: { actionable: actionable.length, reference: reference.length, contradictions: contradictions.length, excluded: excluded.length },
    actuation_rule: 'Only actionable_facts may drive an action. reference_facts inform reasoning but must not be cited as justification for actuation.',
  };
  // LAW 4: seal over the exact content so a receipt can prove provenance.
  const packet_digest = sha(JSON.stringify(body));
  return { valid: true, errors: [], packet: { ...body, packet_digest } };
}

// ---------------- self-test ----------------
if (has('selftest')) {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
  const now = new Date('2026-07-26T12:00:00Z');
  const f = (o) => ({ id: 'f1', claim: 'c', authority: 'INDEPENDENTLY_VERIFIED_RECEIPT', truth_status: 'VERIFIED',
    source: 's', observed_at: '2026-07-25', valid_for_days: 30, tags: [], ...o });

  t('well-formed fact is actionable', labelFact(f(), now).actionable);
  t('uncited fact rejected', !labelFact(f({ source: '' }), now).valid);
  t('unknown authority rejected', !labelFact(f({ authority: 'VIBES' }), now).valid);
  t('HISTORICAL_REFERENCE cannot actuate', !labelFact(f({ authority: 'HISTORICAL_REFERENCE' }), now).actionable);
  t('MODEL_INFERENCE cannot actuate', !labelFact(f({ authority: 'MODEL_INFERENCE' }), now).actionable);
  t('RESEARCH_CANDIDATE cannot actuate', !labelFact(f({ authority: 'RESEARCH_CANDIDATE' }), now).actionable);
  t('BLOCKED truth cannot actuate', !labelFact(f({ truth_status: 'BLOCKED' }), now).actionable);
  t('REPORTED truth cannot actuate', !labelFact(f({ truth_status: 'REPORTED' }), now).actionable);

  const stale = labelFact(f({ observed_at: '2026-01-01', valid_for_days: 30 }), now);
  t('staleness is COMPUTED not asserted', stale.freshness === 'STALE' && !stale.actionable);
  t('stale reason names the age', stale.non_actionable_reasons.some((r) => /past its 30d window/.test(r)));
  t('undated fact is labeled UNDATED', labelFact(f({ observed_at: null }), now).freshness === 'UNDATED');

  const contra = findContradictions([
    labelFact(f({ id: 'a', claim: 'repo is reachable', authority: 'LIVE_RUNTIME_OR_BROWSER_EVIDENCE', tags: ['subject:repo'] }), now),
    labelFact(f({ id: 'b', claim: 'repo returns 404', authority: 'DERIVED_REPORT', tags: ['subject:repo'] }), now),
  ]);
  t('contradiction detected', contra.length === 1);
  t('contradiction PRESERVES both claims', contra[0].claims.length === 2);
  t('contradiction names the stronger authority without deleting the weaker',
    contra[0].strongest_authority === 'LIVE_RUNTIME_OR_BROWSER_EVIDENCE' && contra[0].resolution === 'PRESERVED_UNRESOLVED');

  const good = compile({ objective: 'verify the sponsorship badge renders only from a paid entitlement',
    facts: [f({ id: 'g1', claim: 'sponsorship badge resolves from persisted ledger rows', tags: ['subject:sponsorship'] }),
            f({ id: 'g2', claim: 'competitor discloses a sponsored block with one header', authority: 'HISTORICAL_REFERENCE', truth_status: 'OBSERVED', tags: ['subject:competitor'] })], now });
  t('packet compiles', good.valid);
  t('actionable and reference are SEPARATED', good.packet.counts.actionable === 1 && good.packet.counts.reference === 1);
  t('packet is sealed with a digest', /^[0-9a-f]{64}$/.test(good.packet.packet_digest));
  t('identical inputs seal identically',
    compile({ objective: good.packet.objective, facts: [f({ id: 'g1', claim: 'sponsorship badge resolves from persisted ledger rows', tags: ['subject:sponsorship'] }), f({ id: 'g2', claim: 'competitor discloses a sponsored block with one header', authority: 'HISTORICAL_REFERENCE', truth_status: 'OBSERVED', tags: ['subject:competitor'] })], now }).packet.packet_digest === good.packet.packet_digest);
  t('different facts seal differently',
    compile({ objective: good.packet.objective, facts: [f({ id: 'g1', claim: 'DIFFERENT CLAIM', tags: ['subject:sponsorship'] })], now }).packet.packet_digest !== good.packet.packet_digest);

  t('objective required', !compile({ objective: '', facts: [f()], now }).valid);
  t('objective whitespace-only rejected', !compile({ objective: '   ', facts: [f()], now }).valid);
  const noAct = compile({ objective: 'do something', facts: [f({ authority: 'MODEL_INFERENCE' })], now });
  t('REFUSES to seal when nothing is actionable', !noAct.valid && /refusing to seal/.test(noAct.errors[0]));
  t('malformed facts are EXCLUDED with a reason, not silently dropped',
    compile({ objective: 'x objective', facts: [f(), f({ id: 'bad', source: '' })], now }).packet.excluded.some((e) => /malformed/.test(e.reason)));

  const budget = compile({ objective: 'budget test objective',
    facts: Array.from({ length: 10 }, (_, i) => f({ id: `b${i}` })), now, maxFacts: 3 });
  t('context budget admits only maxFacts', budget.packet.counts.actionable + budget.packet.counts.reference === 3);
  t('budget exclusions are RECORDED', budget.packet.excluded.filter((e) => /budget/.test(e.reason)).length === 7);

  // ---- C1 CRITICAL + HIGH regressions from independent verification
  const future1 = labelFact(f({ observed_at: '2027-06-01', valid_for_days: 30 }), now);
  t('C1: FUTURE-dated observation is NOT actionable', !future1.actionable && future1.freshness === 'FUTURE_DATED');
  t('C1: future-dating reason names the impossibility',
    future1.non_actionable_reasons.some((r) => /FUTURE/.test(r)));
  t('C1: small clock skew is tolerated',
    labelFact(f({ observed_at: new Date(now.getTime() + 3600_000).toISOString(), valid_for_days: 30 }), now).actionable);

  t('C-HIGH: stringified valid_for_days still enforces staleness',
    !labelFact(f({ observed_at: '2020-01-01', valid_for_days: '7' }), now).actionable);
  t('C-HIGH: stringified window still allows a fresh fact',
    labelFact(f({ observed_at: '2026-07-25', valid_for_days: '7' }), now).actionable);
  t('C-HIGH: UNDATED fact is NOT actionable', !labelFact(f({ observed_at: null }), now).actionable);
  t('C-HIGH: dated fact with NO window is NOT actionable',
    !labelFact(f({ observed_at: '2026-07-25', valid_for_days: null }), now).actionable);
  for (const bad of [-5, Infinity, NaN, [], {}, true]) {
    t(`C-HIGH: valid_for_days ${JSON.stringify(bad)} does not disable staleness`,
      !labelFact(f({ observed_at: '2020-01-01', valid_for_days: bad }), now).actionable);
  }

  // Multi-subject contradiction suppression.
  const multi = findContradictions([
    labelFact(f({ id: 'm1', claim: 'repo reachable', tags: ['subject:alpha', 'subject:repo'] }), now),
    labelFact(f({ id: 'm2', claim: 'repo returns 404', tags: ['subject:repo'] }), now),
  ]);
  t('C-HIGH: a multi-subject fact cannot hide a contradiction',
    multi.some((c) => c.subject === 'subject:repo' && c.claims.length === 2));

  // ---- SECOND INDEPENDENT VERIFIER regressions (V2-A..V2-D)
  // V2-A: a duplicate subject tag must not inflate the conflicting-claim count.
  const dupTag = findContradictions([
    labelFact(f({ id: 'd1', claim: 'x is true', tags: ['subject:s', 'subject:s'] }), now),
    labelFact(f({ id: 'd2', claim: 'x is false', tags: ['subject:s'] }), now),
  ]);
  t('V2-A: a duplicate subject tag does NOT inflate the claim count',
    dupTag.length === 1 && dupTag[0].claims.length === 2);
  t('V2-A: no fact is listed twice in one contradiction',
    new Set(dupTag[0].claims.map((c) => c.id)).size === dupTag[0].claims.length);

  // V2-B: case and whitespace must not let a contradiction escape.
  for (const [ta, tb] of [['subject:Repo', 'subject:repo'], ['subject:repo', 'subject:repo '],
                          ['subject:REPO', ' subject:repo'], ['subject:re  po', 'subject:re po']]) {
    const esc = findContradictions([
      labelFact(f({ id: 'e1', claim: 'reachable', tags: [ta] }), now),
      labelFact(f({ id: 'e2', claim: 'returns 404', tags: [tb] }), now),
    ]);
    t(`V2-B: ${JSON.stringify(ta)} vs ${JSON.stringify(tb)} cannot hide a contradiction`,
      esc.length === 1 && esc[0].claims.length === 2);
  }

  // V2-C: guidance must not point at a stale strongest authority.
  const old = new Date(now.getTime() - 400 * 86400_000).toISOString();
  const staleStrong = findContradictions([
    labelFact(f({ id: 'strong', claim: 'ship it', authority: 'OWNER_EXPLICIT_DIRECTIVE',
                  tags: ['subject:release'], observed_at: old, valid_for_days: 7 }), now),
    labelFact(f({ id: 'fresh', claim: 'do not ship', authority: 'LIVE_RUNTIME_OR_BROWSER_EVIDENCE',
                  tags: ['subject:release'] }), now),
  ]);
  t('V2-C: a stale strongest authority is flagged NOT actionable',
    staleStrong[0].strongest_id === 'strong' && staleStrong[0].strongest_is_actionable === false);
  t('V2-C: the note WARNS instead of saying "prefer the stronger"',
    /WARNING/.test(staleStrong[0].note) && /NOT actionable/.test(staleStrong[0].note));
  t('V2-C: the strongest ACTIONABLE claim is named instead',
    staleStrong[0].strongest_actionable_id === 'fresh');
  // And when the strongest IS current, the original guidance stands.
  const freshStrong = findContradictions([
    labelFact(f({ id: 's2', claim: 'ship it', authority: 'OWNER_EXPLICIT_DIRECTIVE', tags: ['subject:r2'] }), now),
    labelFact(f({ id: 'w2', claim: 'do not ship', authority: 'DERIVED_REPORT', tags: ['subject:r2'] }), now),
  ]);
  t('V2-C: a CURRENT strongest authority keeps normal guidance',
    freshStrong[0].strongest_is_actionable === true && !/WARNING/.test(freshStrong[0].note));

  // V2-D: an absurd self-declared window cannot resurrect an ancient fact.
  const ancient = new Date(now.getTime() - 2398 * 86400_000).toISOString();
  for (const w of [1e9, '1e9', 3651, 999999]) {
    const lf = labelFact(f({ id: 'w', claim: 'ancient', observed_at: ancient, valid_for_days: w }), now);
    t(`V2-D: valid_for_days ${JSON.stringify(w)} does not make an ancient fact actionable`,
      lf.actionable === false && lf.freshness !== 'CURRENT');
  }
  // A window at the ceiling still works, so the cap is not a blanket refusal.
  t('V2-D: a legitimate window at the ceiling is still honoured',
    labelFact(f({ id: 'ok', claim: 'recent', valid_for_days: 3650 }), now).freshness === 'CURRENT');

  console.log(`\n  Context Compiler self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------- compile from a mission state file ----------------
const STATE = arg('state', null);
if (STATE) {
  const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const facts = [];
  const push = (id, claim, authority, truth, source, tags = []) =>
    facts.push({ id, claim, authority, truth_status: truth, source, observed_at: raw.updated ?? null, valid_for_days: 7, tags });

  if (raw.verified_state) for (const [k, v] of Object.entries(raw.verified_state))
    push(`vs.${k}`, `${k} = ${JSON.stringify(v)}`, 'INDEPENDENTLY_VERIFIED_RECEIPT', 'VERIFIED', 'MISSION_STATE.verified_state', [`subject:${k}`]);
  if (raw.blockers) for (const [k, v] of Object.entries(raw.blockers))
    push(`bl.${k}`, `${k}: ${typeof v === 'object' ? v.status ?? JSON.stringify(v).slice(0, 90) : v}`, 'LIVE_RUNTIME_OR_BROWSER_EVIDENCE', 'BLOCKED', 'MISSION_STATE.blockers', [`subject:${k}`]);
  // Each correction and each backlog item is a DISTINCT subject. Tagging them
  // all 'subject:owner' / 'subject:backlog' made N unrelated statements look
  // like N conflicting claims about one thing — a false contradiction storm
  // that would train an operator to ignore the warning.
  if (Array.isArray(raw.owner_corrections)) for (const c of raw.owner_corrections)
    push(`oc.${c.id}`, c.correction, 'OWNER_EXPLICIT_DIRECTIVE', 'VERIFIED', 'OWNER_CORRECTIONS', [`subject:correction:${c.id}`, 'kind:owner_correction']);
  if (Array.isArray(raw.next_actions)) raw.next_actions.forEach((a, i) =>
    push(`na.${i}`, a, 'DERIVED_REPORT', 'REPORTED', 'MISSION_STATE.next_actions', [`subject:backlog:${i}`, 'kind:backlog']));

  const res = compile({ objective: arg('objective', 'continue the highest-value unfinished objective'), facts });
  if (!res.valid) { console.error('  REFUSED:', res.errors.join('; ')); process.exit(1); }
  const p = res.packet;
  console.log(`\n=== SEALED MISSION PACKET ===`);
  console.log(`  objective    : ${p.objective}`);
  console.log(`  actionable   : ${p.counts.actionable}`);
  console.log(`  reference    : ${p.counts.reference}`);
  console.log(`  contradictions: ${p.counts.contradictions}`);
  console.log(`  excluded     : ${p.counts.excluded}`);
  console.log(`  digest       : ${p.packet_digest.slice(0, 24)}…`);
  for (const c of p.contradictions) console.log(`    ⚠ ${c.subject}: ${c.claims.length} conflicting claims (strongest: ${c.strongest_authority})`);
  const J = arg('json', null);
  if (J) { fs.writeFileSync(J, JSON.stringify(p, null, 2)); console.log(`\n  -> ${J}`); }
}
