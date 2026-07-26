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
  const validForDays = Number.isFinite(raw?.valid_for_days) ? raw.valid_for_days : null;
  let freshness = 'UNDATED';
  let ageDays = null;
  if (observedAt && !Number.isNaN(observedAt.getTime())) {
    ageDays = Math.floor((now - observedAt) / 86400_000);
    freshness = validForDays == null ? 'DATED_NO_WINDOW'
      : ageDays <= validForDays ? 'CURRENT' : 'STALE';
  }

  // LAW 1 + 3: actuation requires strong authority, an actuating truth state,
  // and non-stale evidence. Staleness is computed here, never asserted.
  const actionable =
    errors.length === 0 &&
    !NON_ACTUATING_AUTHORITY.has(raw.authority) &&
    ACTUATION_TRUTH.has(raw.truth_status) &&
    freshness !== 'STALE';

  const reasons = [];
  if (errors.length) reasons.push('malformed');
  if (NON_ACTUATING_AUTHORITY.has(raw?.authority)) reasons.push(`authority ${raw.authority} is reference-only`);
  if (!ACTUATION_TRUTH.has(raw?.truth_status)) reasons.push(`truth_status ${raw?.truth_status} does not permit actuation`);
  if (freshness === 'STALE') reasons.push(`observation is ${ageDays}d old, past its ${validForDays}d window`);

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
  const bySubject = new Map();
  for (const f of facts) {
    const subj = f.tags.find((t) => t.startsWith('subject:'));
    if (!subj) continue;
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj).push(f);
  }
  const out = [];
  for (const [subject, group] of bySubject) {
    const claims = new Set(group.map((g) => g.claim));
    if (claims.size > 1) {
      const sorted = [...group].sort((a, b) => a.authority_rank - b.authority_rank);
      out.push({
        subject,
        claims: group.map((g) => ({ id: g.id, claim: g.claim, authority: g.authority, source: g.source, freshness: g.freshness })),
        // Record which is stronger WITHOUT deleting the weaker one.
        strongest_authority: sorted[0].authority,
        strongest_id: sorted[0].id,
        resolution: 'PRESERVED_UNRESOLVED',
        note: 'Both claims retained. Authority ranking indicates which to prefer, but the disagreement is itself evidence and must reach the operator.',
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
