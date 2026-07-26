#!/usr/bin/env node
/**
 * ORDERWEEDDC MERCHANT PILOT — the sellable package, end to end.
 *
 * Assembles the wedge into ONE artifact a merchant can be handed:
 *
 *   verified profile → visibility audit → correction plan → labeled placement
 *   → attributed action → proof-of-value → paid continuation decision
 *
 * This is the step that turns mechanisms into money. Everything upstream
 * (audit, ledger, entitlement gate) already exists and is independently
 * verified; this binds them into a document with an auditable evidence chain.
 *
 * TRUTH LAW — the reason a merchant could trust this:
 *   - every number traces to a database field or a ledger entry
 *   - no ranking, traffic, impression, lead or conversion-lift figure appears
 *   - demonstration data is labeled and can never read as a commercial result
 *   - the pilot REFUSES to produce a proof-of-value section when the evidence
 *     does not support one, rather than filling it with optimistic prose
 *
 * OWNER-ONLY BOUNDARY: this generates a package. It does NOT contact a
 * merchant, activate payment, or spend on advertising. Those remain owner
 * actions and the package says so explicitly.
 *
 * Usage:
 *   node pilot.mjs --selftest
 *   node pilot.mjs --db <dev.db> --retailer "<name|id>" [--json out.json]
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Pilot stages. A package may only advance one stage at a time. */
export const PILOT_STAGES = Object.freeze([
  'PROFILE_AUDITED', 'CORRECTIONS_AGREED', 'PLACEMENT_FUNDED',
  'PLACEMENT_LIVE', 'ACTIONS_ATTRIBUTED', 'VALUE_PROVEN', 'CONTINUATION_DECIDED',
]);

/**
 * Build the pilot package.
 *
 * @param {object} a
 * @param {object} a.retailer          row from Retailer
 * @param {object} a.audit             MERCHANT_VISIBILITY_AUDIT_V1 report
 * @param {Array}  a.ledger            DemandCreditEntry rows for this merchant
 * @param {Date}   [a.now]
 */
export function buildPilot({ retailer, audit, ledger = [], now = new Date() }) {
  const errors = [];
  if (!retailer || !text(retailer.id)) errors.push('retailer required');
  if (!audit || typeof audit.score !== 'number') errors.push('a completed visibility audit is required — a pilot cannot be sold without a baseline');
  if (!Array.isArray(ledger)) errors.push('ledger must be an array');
  if (errors.length) return { valid: false, errors, package: null };

  const isDemo = !!retailer.isDemonstration
    || /demonstration|demo|synthetic|sample/i.test(String(retailer.dataStatus || ''));

  // ---- Stage 1: baseline, straight from the audit
  const baseline = {
    score: audit.score,
    passed: audit.counts?.pass ?? null,
    failed: audit.counts?.fail ?? null,
    measured_at: audit.generated_at ?? now.toISOString(),
    truth_label: audit.truth_label ?? (isDemo ? 'DEMONSTRATION_ONLY' : 'LIVE_RECORD'),
  };

  // ---- Stage 2: the correction plan IS the audit's ranked remediation
  const corrections = (audit.top_actions || []).map((a) => ({
    rank: a.rank, weight: a.weight, finding: a.finding,
    evidence_field: a.evidence_field, observed: a.observed, action: a.action,
    status: 'PROPOSED',
  }));

  // ---- Stage 3+4: funding and placement, read from the ledger
  const issues = ledger.filter((e) => e.kind === 'ISSUE');
  const spends = ledger.filter((e) => e.kind === 'SPEND');
  const refunds = ledger.filter((e) => e.kind === 'REFUND');
  const attributions = ledger.filter((e) => e.kind === 'ATTRIBUTION');

  const cents = (n) => Math.round(Math.abs(Number(n) || 0) * 100);
  const funded = issues.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const spent = spends.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const refunded = refunds.reduce((s, e) => s + cents(e.amount), 0) / 100;

  // ---- Stage 5: attributed actions, counted ONLY with a verified evidence chain
  //
  // P1 (independent verifier, CRITICAL): this was a hash check with ZERO content
  // validation. The digest is computed over attacker-controlled bytes, so
  // evidenceChain='[]' — a chain with no steps at all — hashed correctly and
  // became a "verified attributed action", producing a full proof_of_value with
  // cost_per_attributed_action on a LIVE_RECORD. A hash proves the content was
  // not altered; it says nothing about whether the content is evidence.
  //
  // An evidence chain must therefore be PARSED and its steps validated before
  // the hash is even consulted.
  const evidenceSteps = (a) => {
    if (!text(a.evidenceChain) || !text(a.evidenceChainSha256)) return null;
    let parsed;
    try { parsed = JSON.parse(a.evidenceChain); } catch { return null; }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Every link must be an own-property object carrying a non-blank step and a
    // retrievable ref. hasOwnProperty so a prototype-polluted object cannot fake it.
    const ok = parsed.every((l) => l && typeof l === 'object' && !Array.isArray(l)
      && Object.prototype.hasOwnProperty.call(l, 'step')
      && Object.prototype.hasOwnProperty.call(l, 'ref')
      && text(l.step) && text(l.ref));
    if (!ok) return null;
    // Only now does the digest matter: it proves these exact steps are unaltered.
    if (sha(a.evidenceChain) !== a.evidenceChainSha256) return null;
    return parsed;
  };
  const evidenced = attributions.filter((a) => evidenceSteps(a) !== null);
  const unevidenced = attributions.length - evidenced.length;
  const byKind = {};
  for (const a of evidenced) byKind[a.actionKind] = (byKind[a.actionKind] || 0) + 1;

  // ---- Stage determination: the furthest stage the EVIDENCE supports
  let stage = 'PROFILE_AUDITED';
  if (corrections.length) stage = 'CORRECTIONS_AGREED';
  if (funded > 0) stage = 'PLACEMENT_FUNDED';
  if (spent > 0) stage = 'PLACEMENT_LIVE';
  if (evidenced.length > 0) stage = 'ACTIONS_ATTRIBUTED';

  /**
   * Proof of value. REFUSES to exist without evidence — the single most
   * important honesty boundary in the whole package. A merchant paying for a
   * pilot must never receive a value claim the data cannot support.
   */
  let proofOfValue = null;
  const povBlockers = [];
  if (isDemo) povBlockers.push('record is demonstration data — cannot represent a commercial result');
  if (spent <= 0) povBlockers.push('no credits spent — nothing to attribute value against');
  if (evidenced.length === 0) povBlockers.push('no attributed action carries a verified evidence chain');
  if (povBlockers.length === 0) {
    stage = 'VALUE_PROVEN';
    proofOfValue = {
      credits_spent: spent,
      attributed_actions: evidenced.length,
      actions_by_kind: byKind,
      cost_per_attributed_action: Math.round((spent / evidenced.length) * 100) / 100,
      every_action_evidence_verified: true,
      relationship_owner: 'MERCHANT',
      portability: 'These attributed relationships belong to the merchant and are exportable. No lock-in clause applies.',
      not_claimed: ['ranking position', 'traffic', 'impressions', 'leads', 'conversion lift', 'revenue attribution'],
    };
  }

  const pkg = {
    schema: 'orderweeddc-merchant-pilot/1',
    generated_at: now.toISOString(),
    merchant: { id: retailer.id, name: retailer.name, is_demonstration: isDemo, data_status: retailer.dataStatus ?? null },
    truth_label: isDemo
      ? 'DEMONSTRATION_ONLY — this package illustrates the pilot mechanics and is NOT a commercial result'
      : 'LIVE_RECORD',
    stage,
    stage_index: PILOT_STAGES.indexOf(stage),
    baseline,
    correction_plan: corrections,
    placement: {
      credits_funded: funded, credits_spent: spent, credits_refunded: refunded,
      credits_remaining: Math.round((funded - spent + refunded) * 100) / 100,
      placements: spends.map((s) => ({ seq: s.seq, placement: s.placement, disclosure: s.disclosureLabel, affects_organic_order: false })),
      ordering_guarantee: 'Credits buy a labeled placement. Organic ordering is truth-first and is not for sale.',
    },
    attribution: {
      recorded: attributions.length,
      evidence_verified: evidenced.length,
      rejected_unverified: unevidenced,
      by_kind: byKind,
      rule: 'An action counts only when its stored evidence chain re-hashes to its recorded digest.',
    },
    proof_of_value: proofOfValue,
    proof_of_value_blockers: povBlockers,
    continuation_decision: proofOfValue
      ? { available: true, basis: 'measured attributed actions with verified evidence', decision: 'PENDING_MERCHANT' }
      : { available: false, reason: 'proof of value is not established; a continuation cannot be honestly proposed' },
    owner_only_actions: [
      'contacting this merchant', 'activating real payment', 'spending on advertising',
      'making any public claim about this merchant',
    ],
    disclaimer: 'Every figure above derives from a database field or an append-only ledger entry. No ranking, traffic, impression, lead, or conversion-lift number is claimed or implied.',
  };
  pkg.package_digest = sha(JSON.stringify(pkg));
  return { valid: true, errors: [], package: pkg };
}

// ---------------- self-test ----------------
if (has('selftest')) {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
  const now = new Date('2026-07-26T12:00:00Z');
  const R = (o = {}) => ({ id: 'r1', name: 'Test Retailer', isDemonstration: false, dataStatus: 'VERIFIED_CURRENT', ...o });
  const A = (o = {}) => ({ score: 62, counts: { pass: 18, warn: 2, fail: 10 }, generated_at: now.toISOString(),
    truth_label: 'LIVE_RECORD', top_actions: [{ rank: 1, weight: 5, finding: 'License status verified', evidence_field: 'Retailer.licenseStatus', observed: 'UNVERIFIED', action: 'submit evidence' }], ...o });
  const chain = JSON.stringify([{ step: 'render', ref: 'r1' }, { step: 'click', ref: 'r2' }]);
  const attr = (o = {}) => ({ kind: 'ATTRIBUTION', actionKind: 'PHONE_CLICK', evidenceChain: chain, evidenceChainSha256: sha(chain), ...o });

  t('refuses without an audit', !buildPilot({ retailer: R(), audit: null }).valid);
  t('refuses without a retailer', !buildPilot({ retailer: null, audit: A() }).valid);

  const p1 = buildPilot({ retailer: R(), audit: A(), ledger: [], now }).package;
  t('audit-only pilot reaches CORRECTIONS_AGREED', p1.stage === 'CORRECTIONS_AGREED');
  t('no proof of value without spend', p1.proof_of_value === null);
  t('blocker names the missing spend', p1.proof_of_value_blockers.some((b) => /no credits spent/.test(b)));
  t('continuation unavailable without proof', p1.continuation_decision.available === false);

  const funded = [{ kind: 'ISSUE', amount: 500, seq: 0 }];
  const spent = [...funded, { kind: 'SPEND', amount: -75, seq: 1, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored placement' }];
  const p2 = buildPilot({ retailer: R(), audit: A(), ledger: spent, now }).package;
  t('spend advances to PLACEMENT_LIVE', p2.stage === 'PLACEMENT_LIVE');
  t('still no proof of value without an attributed action', p2.proof_of_value === null);
  t('credits math is exact', p2.placement.credits_funded === 500 && p2.placement.credits_spent === 75 && p2.placement.credits_remaining === 425);

  const full = [...spent, attr({ seq: 2 })];
  const p3 = buildPilot({ retailer: R(), audit: A(), ledger: full, now }).package;
  t('evidenced attribution reaches VALUE_PROVEN', p3.stage === 'VALUE_PROVEN');
  t('proof of value exists', p3.proof_of_value !== null);
  t('cost per attributed action computed', p3.proof_of_value.cost_per_attributed_action === 75);
  t('merchant owns the relationship', p3.proof_of_value.relationship_owner === 'MERCHANT');
  t('never claims ranking or lift', p3.proof_of_value.not_claimed.includes('conversion lift'));
  t('continuation becomes available', p3.continuation_decision.available === true);

  // Tampered evidence must not count.
  const tampered = [...spent, attr({ seq: 2, evidenceChain: '[{"step":"forged","ref":"x"}]' })];
  const p4 = buildPilot({ retailer: R(), audit: A(), ledger: tampered, now }).package;
  t('TAMPERED evidence is rejected', p4.attribution.evidence_verified === 0 && p4.attribution.rejected_unverified === 1);
  t('tampered evidence blocks proof of value', p4.proof_of_value === null);

  // Demonstration data can never read as a commercial result.
  const p5 = buildPilot({ retailer: R({ isDemonstration: true }), audit: A(), ledger: full, now }).package;
  t('DEMONSTRATION record blocks proof of value', p5.proof_of_value === null);
  t('demonstration blocker is explicit', p5.proof_of_value_blockers.some((b) => /demonstration/.test(b)));
  t('demonstration truth label is unmistakable', /NOT a commercial result/.test(p5.truth_label));
  // dataStatus alone must also block, even if the boolean says otherwise.
  const p6 = buildPilot({ retailer: R({ isDemonstration: false, dataStatus: 'DEMONSTRATION_ONLY' }), audit: A(), ledger: full, now }).package;
  t('dataStatus alone blocks proof of value', p6.proof_of_value === null);

  t('package is sealed', /^[0-9a-f]{64}$/.test(p3.package_digest));
  t('owner-only actions are stated', p3.owner_only_actions.includes('activating real payment'));

  // ---- P1 CRITICAL regression: empty / malformed evidence chains
  const emptyChain = (c) => ({ kind: 'ATTRIBUTION', actionKind: 'PHONE_CLICK', evidenceChain: c, evidenceChainSha256: sha(c) });
  for (const bad of ['[]', '[{}]', '""', 'null', '{}', '[null]', '[[]]', '[{"step":"x"}]', '[{"ref":"y"}]', '[{"step":"  ","ref":"y"}]', 'not json']) {
    const pk = buildPilot({ retailer: R(), audit: A(), ledger: [...spent, emptyChain(bad)], now }).package;
    t(`P1: evidenceChain ${JSON.stringify(bad).slice(0, 22)} is NOT evidence`,
      pk.attribution.evidence_verified === 0 && pk.proof_of_value === null);
  }
  t('P1: a genuine multi-step chain still counts',
    buildPilot({ retailer: R(), audit: A(), ledger: full, now }).package.attribution.evidence_verified === 1);
  // A prototype-polluted link must not fake a step.
  const polluted = JSON.stringify([JSON.parse('{"__proto__":{"step":"x","ref":"y"}}')]);
  t('P1: prototype-polluted link rejected',
    buildPilot({ retailer: R(), audit: A(), ledger: [...spent, emptyChain(polluted)], now }).package.attribution.evidence_verified === 0);

  console.log(`\n  Merchant Pilot self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------- build from the real database ----------------
const DB = arg('db', null);
if (DB) {
  let db;
  try { const { DatabaseSync } = require('node:sqlite'); db = new DatabaseSync(DB, { readOnly: true }); }
  catch (e) { console.error('  no SQLite driver:', e.message); process.exit(2); }

  const want = arg('retailer', null);
  const retailers = db.prepare('SELECT * FROM Retailer').all();
  const retailer = want ? retailers.find((r) => r.id === want || r.name === want) : retailers[0];
  if (!retailer) { console.error('  no matching retailer'); process.exit(1); }

  const ledger = db.prepare('SELECT * FROM DemandCreditEntry WHERE merchantId = ? ORDER BY seq ASC').all(retailer.id);
  const auditPath = arg('audit', null);
  const audit = auditPath ? JSON.parse(fs.readFileSync(auditPath, 'utf8'))
    : { score: 0, counts: { pass: 0, fail: 0 }, top_actions: [], truth_label: 'UNKNOWN' };

  const res = buildPilot({ retailer, audit, ledger });
  if (!res.valid) { console.error('  REFUSED:', res.errors.join('; ')); process.exit(1); }
  const p = res.package;
  console.log(`\n=== MERCHANT PILOT PACKAGE ===`);
  console.log(`  merchant   : ${p.merchant.name}`);
  console.log(`  truth      : ${p.truth_label}`);
  console.log(`  stage      : ${p.stage} (${p.stage_index + 1}/${PILOT_STAGES.length})`);
  console.log(`  baseline   : ${p.baseline.score}/100 (${p.baseline.failed} failing checks)`);
  console.log(`  corrections: ${p.correction_plan.length} ranked actions`);
  console.log(`  credits    : funded ${p.placement.credits_funded} · spent ${p.placement.credits_spent} · remaining ${p.placement.credits_remaining}`);
  console.log(`  attribution: ${p.attribution.evidence_verified} verified of ${p.attribution.recorded} recorded`);
  console.log(`  proof      : ${p.proof_of_value ? `${p.proof_of_value.attributed_actions} actions, ${p.proof_of_value.cost_per_attributed_action}/action` : 'NOT ESTABLISHED'}`);
  for (const b of p.proof_of_value_blockers) console.log(`               ✗ ${b}`);
  console.log(`  digest     : ${p.package_digest.slice(0, 24)}…`);
  const J = arg('json', null);
  if (J) { fs.writeFileSync(J, JSON.stringify(p, null, 2)); console.log(`\n  -> ${J}`); }
  db.close?.();
}
