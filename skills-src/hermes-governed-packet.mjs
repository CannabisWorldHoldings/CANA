#!/usr/bin/env node
/**
 * HERMES GOVERNED EXECUTION PACKET
 *
 * The missing link between the intelligence plane and the execution plane:
 *
 *   Context Compiler (what is TRUE) ──┐
 *                                     ├──> GOVERNED PACKET ──> Hermes acts
 *   CANA authority   (what is ALLOWED)┘         │
 *                                               └──> ExecutionReceipt
 *
 * Until now the Context Compiler sealed packets nobody consumed, and CANA's
 * authority model governed actions nobody compiled context for. This binds
 * them so an action cannot happen without BOTH a sealed context and an
 * authorization, and cannot complete without a receipt tying the two together.
 *
 * LAWS:
 *   1. NO ACTION WITHOUT CONTEXT. A packet requires a sealed context digest.
 *   2. NO ACTION WITHOUT AUTHORITY. Every packet carries an explicit grant
 *      naming the capability, budget and expiry.
 *   3. OWNER-ONLY ACTIONS ARE REFUSED, not silently downgraded. Deployment,
 *      payment, merchant outreach and public claims cannot be self-authorized.
 *   4. THE PACKET IS SEALED AND BOUND. Its digest covers the context digest, so
 *      a receipt proves WHICH context justified WHICH action.
 *   5. NO RECEIPT WITHOUT EXECUTION EVIDENCE. A receipt claiming success must
 *      carry an observable outcome — "the handler returned true" is not proof.
 *
 * Provider-neutral and deterministic: no model call, so it runs and is testable
 * while Hermes' live runtime remains blocked on vendoring and provider keys.
 *
 * Usage:
 *   node packet.mjs --selftest
 */
import { createHash } from 'node:crypto';

const has = (k) => process.argv.includes(`--${k}`);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Capabilities Hermes may be granted. Anything absent is refused. */
export const CAPABILITIES = Object.freeze([
  'READ_REPOSITORY', 'RUN_TESTS', 'WRITE_LOCAL_BRANCH', 'RUN_BROWSER_COURT',
  'QUERY_DATABASE', 'GENERATE_REPORT', 'COMPILE_CONTEXT',
]);

/**
 * Actions only the owner may authorize. These are refused outright rather than
 * downgraded, because a silent downgrade is how an agent ends up doing 90% of a
 * forbidden action and calling it compliant.
 */
export const OWNER_ONLY = Object.freeze([
  'DEPLOY_PRODUCTION', 'MERGE_PROTECTED_MAIN', 'ACTIVATE_PAYMENT',
  'SPEND_ADVERTISING', 'CONTACT_MERCHANT', 'PUBLIC_CLAIM',
  'DNS_CHANGE', 'CREDENTIAL_DISCLOSURE', 'DELETE_PRODUCTION_DATA',
]);

/** An authorization grant issued by CANA. */
export function makeGrant({ capability, budgetUnits, expiresAt, issuedBy, now = new Date() }) {
  const errors = [];
  if (OWNER_ONLY.includes(capability)) {
    errors.push(`${capability} is owner-only and cannot be granted to an agent`);
  } else if (!CAPABILITIES.includes(capability)) {
    errors.push(`unknown capability ${capability}`);
  }
  if (!Number.isInteger(budgetUnits) || budgetUnits <= 0) errors.push('budgetUnits must be a positive integer');
  if (!text(issuedBy)) errors.push('issuedBy required — an unattributed grant is not an authorization');
  const exp = expiresAt instanceof Date ? expiresAt : (text(expiresAt) ? new Date(expiresAt) : null);
  if (!exp || Number.isNaN(exp.getTime())) errors.push('a valid expiresAt is required');
  else if (exp.getTime() <= now.getTime()) errors.push('grant already expired');

  const grant = {
    capability, budget_units: budgetUnits, issued_by: issuedBy,
    expires_at: exp && !Number.isNaN(exp?.getTime?.()) ? exp.toISOString() : null,
    valid: errors.length === 0, errors,
  };
  grant.grant_id = 'gr_' + sha(`${capability}|${budgetUnits}|${grant.expires_at}|${issuedBy}`).slice(0, 16);
  return grant;
}

/**
 * Seal a governed packet binding CONTEXT to AUTHORITY.
 * Refuses if either side is missing or invalid.
 */
/**
 * Subject tags an intent touches, normalized the same way the Context Compiler
 * normalizes them. If the two normalizations drift, a contradiction stops
 * matching an intent and the block below goes silently blind — the same class of
 * failure the second verifier found in the compiler itself (V2-B).
 */
const normSubject = (t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase();

export function sealPacket({ contextPacket, grant, intent, now = new Date() }) {
  const errors = [];
  // LAW 1
  if (!contextPacket || !text(contextPacket.packet_digest)) {
    errors.push('a sealed context packet is required — no action without compiled context');
  } else if (!Array.isArray(contextPacket.actionable_facts) || contextPacket.actionable_facts.length === 0) {
    errors.push('context contains no actionable facts — refusing to act on reference-only evidence');
  }
  // LAW 2b — CONTRADICTION BLOCKING (was: surfaced only).
  //
  // The packet previously listed unresolved contradictions in the sealed body
  // and let the action proceed. Surfacing is necessary but not sufficient: if
  // the context disagrees with itself about the VERY SUBJECT the action touches,
  // there is no coherent basis for the action, and "an operator will read the
  // list" is not a control. A contradiction on an UNRELATED subject is still
  // only surfaced — blocking every action on any disagreement anywhere would
  // make the system inert and invite the guard being switched off.
  const intentSubjects = new Set((intent?.subjects ?? []).map(normSubject));
  const blocking = (contextPacket?.contradictions ?? []).filter((c) => {
    const key = normSubject(c.subject_key ?? c.subject ?? '');
    return intentSubjects.has(key);
  });
  for (const c of blocking) {
    errors.push(`REFUSED: context contradicts itself on ${c.subject} — the subject this action acts on. `
      + `Claims: ${(c.claims ?? []).map((x) => `${x.id}:${JSON.stringify(x.claim)}`).join(' vs ')}. `
      + 'Resolve the contradiction or obtain an owner decision; a governed action cannot proceed on a subject whose truth is unsettled.');
  }
  // A contradiction whose strongest authority is STALE must never be resolved by
  // authority alone, so it cannot be waved through even if it is non-blocking.
  for (const c of contextPacket?.contradictions ?? []) {
    if (c.strongest_is_actionable === false && intentSubjects.has(normSubject(c.subject_key ?? c.subject ?? ''))) {
      errors.push(`REFUSED: the strongest authority on ${c.subject} is ${c.strongest_freshness} and not actionable`);
    }
  }

  // LAW 2
  if (!grant?.valid) errors.push(`authorization invalid: ${grant?.errors?.join('; ') ?? 'no grant'}`);
  // Intent must be concrete enough to audit.
  if (!text(intent?.description)) errors.push('intent.description required');
  if (!text(intent?.successTest)) errors.push('intent.successTest required — an action with no success test cannot be verified');
  if (!text(intent?.rollback)) errors.push('intent.rollback required');
  // LAW 3
  if (OWNER_ONLY.includes(intent?.capability)) {
    errors.push(`REFUSED: ${intent.capability} is owner-only`);
  } else if (grant?.valid && intent?.capability !== grant.capability) {
    errors.push(`intent capability ${intent?.capability} does not match grant ${grant.capability}`);
  }

  if (errors.length) return { valid: false, errors, packet: null };

  const body = {
    schema: 'hermes-governed-packet/1',
    sealed_at: now.toISOString(),
    // LAW 4: the context digest is INSIDE the sealed body.
    context_digest: contextPacket.packet_digest,
    context_objective: contextPacket.objective,
    actionable_fact_count: contextPacket.actionable_facts.length,
    contradiction_count: contextPacket.contradictions?.length ?? 0,
    grant: { id: grant.grant_id, capability: grant.capability, budget_units: grant.budget_units, expires_at: grant.expires_at, issued_by: grant.issued_by },
    intent: {
      description: intent.description, capability: intent.capability,
      success_test: intent.successTest, rollback: intent.rollback,
    },
    // Surfaced deliberately: an operator must see that the context disagreed
    // with itself before an action runs on it.
    unresolved_contradictions: (contextPacket.contradictions ?? []).map((c) => c.subject),
    // Recorded so a reader can tell that the contradictions listed above were
    // checked against this action's subjects, not merely printed beside them.
    intent_subjects: [...intentSubjects],
    contradictions_checked_against_intent: true,
  };
  return { valid: true, errors: [], packet: { ...body, packet_digest: sha(JSON.stringify(body)) } };
}

/**
 * Close a packet with an ExecutionReceipt.
 * LAW 5: a success claim requires observable outcome evidence.
 */
export function makeReceipt({ packet, outcome, now = new Date() }) {
  const errors = [];
  if (!packet || !text(packet.packet_digest)) errors.push('a sealed packet is required');
  if (!outcome || typeof outcome !== 'object') errors.push('outcome required');
  if (outcome && typeof outcome.succeeded !== 'boolean') errors.push('outcome.succeeded must be an explicit boolean');
  if (outcome?.succeeded === true) {
    // The entire point: "it returned true" is not evidence.
    if (!Array.isArray(outcome.evidence) || outcome.evidence.length === 0) {
      errors.push('a SUCCESS claim requires observable evidence — a handler returning true is not proof');
    } else if (!outcome.evidence.every((e) => text(e?.observation) && text(e?.ref))) {
      errors.push('every evidence item needs an observation and a retrievable ref');
    }
  }
  if (outcome?.succeeded === false && !text(outcome.failureReason)) {
    errors.push('a FAILURE must state its reason so the next attempt can change hypothesis');
  }
  if (Number.isFinite(outcome?.budgetUsed) && Number.isFinite(packet?.grant?.budget_units)
      && outcome.budgetUsed > packet.grant.budget_units) {
    errors.push(`budget overrun: used ${outcome.budgetUsed} of ${packet.grant.budget_units}`);
  }
  if (errors.length) return { valid: false, errors, receipt: null };

  const body = {
    schema: 'hermes-execution-receipt/1',
    recorded_at: now.toISOString(),
    packet_digest: packet.packet_digest,
    context_digest: packet.context_digest,
    grant_id: packet.grant.id,
    capability: packet.grant.capability,
    succeeded: outcome.succeeded,
    failure_reason: outcome.succeeded ? null : outcome.failureReason,
    evidence: outcome.succeeded ? outcome.evidence : [],
    budget_used: Number.isFinite(outcome.budgetUsed) ? outcome.budgetUsed : null,
    success_test: packet.intent.success_test,
    rollback_available: packet.intent.rollback,
  };
  return { valid: true, errors: [], receipt: { ...body, receipt_digest: sha(JSON.stringify(body)) } };
}

// ---------------- self-test ----------------
if (has('selftest')) {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
  const now = new Date('2026-07-26T12:00:00Z');
  const future = new Date(now.getTime() + 86400_000);
  const ctx = { packet_digest: sha('ctx'), objective: 'run the browser court on the homepage',
    actionable_facts: [{ id: 'f1', claim: 'server is running' }], contradictions: [] };
  const g = () => makeGrant({ capability: 'RUN_BROWSER_COURT', budgetUnits: 10, expiresAt: future, issuedBy: 'CANA', now });
  const intent = { description: 'run the a11y court on /', capability: 'RUN_BROWSER_COURT',
    successTest: 'court exits zero', rollback: 'none required; read-only' };

  t('valid grant issued', g().valid);
  t('owner-only capability REFUSED as a grant', !makeGrant({ capability: 'DEPLOY_PRODUCTION', budgetUnits: 1, expiresAt: future, issuedBy: 'CANA', now }).valid);
  t('unknown capability refused', !makeGrant({ capability: 'DO_ANYTHING', budgetUnits: 1, expiresAt: future, issuedBy: 'CANA', now }).valid);
  t('zero budget refused', !makeGrant({ capability: 'RUN_TESTS', budgetUnits: 0, expiresAt: future, issuedBy: 'CANA', now }).valid);
  t('unattributed grant refused', !makeGrant({ capability: 'RUN_TESTS', budgetUnits: 5, expiresAt: future, issuedBy: '  ', now }).valid);
  t('expired grant refused', !makeGrant({ capability: 'RUN_TESTS', budgetUnits: 5, expiresAt: new Date(now.getTime() - 1000), issuedBy: 'CANA', now }).valid);

  const p = sealPacket({ contextPacket: ctx, grant: g(), intent, now });
  t('packet seals with context + authority', p.valid);
  t('context digest is bound INTO the packet', p.packet.context_digest === ctx.packet_digest);
  t('packet is sealed', /^[0-9a-f]{64}$/.test(p.packet.packet_digest));

  t('NO ACTION WITHOUT CONTEXT', !sealPacket({ contextPacket: null, grant: g(), intent, now }).valid);
  t('refuses a context with no actionable facts',
    !sealPacket({ contextPacket: { ...ctx, actionable_facts: [] }, grant: g(), intent, now }).valid);
  t('NO ACTION WITHOUT AUTHORITY', !sealPacket({ contextPacket: ctx, grant: { valid: false, errors: ['x'] }, intent, now }).valid);
  t('capability mismatch refused',
    !sealPacket({ contextPacket: ctx, grant: g(), intent: { ...intent, capability: 'RUN_TESTS' }, now }).valid);
  t('OWNER-ONLY intent REFUSED, not downgraded',
    !sealPacket({ contextPacket: ctx, grant: g(), intent: { ...intent, capability: 'ACTIVATE_PAYMENT' }, now }).valid);
  t('missing success test refused', !sealPacket({ contextPacket: ctx, grant: g(), intent: { ...intent, successTest: '' }, now }).valid);
  t('missing rollback refused', !sealPacket({ contextPacket: ctx, grant: g(), intent: { ...intent, rollback: '  ' }, now }).valid);

  const withContra = sealPacket({ contextPacket: { ...ctx, contradictions: [{ subject: 'subject:repo' }] }, grant: g(), intent, now });
  t('unresolved contradictions are SURFACED, not hidden', withContra.packet.unresolved_contradictions.includes('subject:repo'));

  // ---- LAW 2b: a contradiction ON THE ACTION'S OWN SUBJECT must BLOCK.
  // Surfacing alone let an action proceed on a subject whose truth was unsettled.
  const contra = [{ subject: 'subject:repo', subject_key: 'subject:repo',
    claims: [{ id: 'a', claim: 'reachable' }, { id: 'b', claim: '404' }] }];
  const blocked = sealPacket({ contextPacket: { ...ctx, contradictions: contra },
    grant: g(), intent: { ...intent, subjects: ['subject:repo'] }, now });
  t('L2b: a contradiction on the action\'s subject REFUSES the packet', blocked.valid === false);
  t('L2b: the refusal names the subject and both claims',
    blocked.errors.some((e) => /contradicts itself on subject:repo/.test(e) && /a:"reachable"/.test(e) && /b:"404"/.test(e)));
  t('L2b: a refused packet is not sealed', blocked.packet === null);

  // Case and whitespace must not let an action slip past the block, exactly as
  // in the compiler (V2-B). Normalization must match on both sides.
  for (const [cs, is] of [['subject:Repo', 'subject:repo'], ['subject:repo', 'subject:repo '],
                          ['subject:REPO', ' subject:repo']]) {
    const r = sealPacket({ contextPacket: { ...ctx, contradictions: [{ subject: cs, claims: [{ id: 'a', claim: 'x' }, { id: 'b', claim: 'y' }] }] },
      grant: g(), intent: { ...intent, subjects: [is] }, now });
    t(`L2b: ${JSON.stringify(cs)} vs intent ${JSON.stringify(is)} still blocks`, r.valid === false);
  }

  // A contradiction on an UNRELATED subject is surfaced but must NOT block, or
  // the system becomes inert and the guard gets switched off.
  const unrelated = sealPacket({ contextPacket: { ...ctx, contradictions: [{ subject: 'subject:unrelated', claims: [{ id: 'a', claim: 'x' }, { id: 'b', claim: 'y' }] }] },
    grant: g(), intent: { ...intent, subjects: ['subject:repo'] }, now });
  t('L2b: an UNRELATED contradiction does not block', unrelated.valid === true);
  t('L2b: but it is still surfaced in the sealed body',
    unrelated.packet.unresolved_contradictions.includes('subject:unrelated'));

  // A stale strongest authority (compiler V2-C) cannot be waved through.
  const staleAuth = sealPacket({ contextPacket: { ...ctx, contradictions: [{ subject: 'subject:release', subject_key: 'subject:release',
      strongest_is_actionable: false, strongest_freshness: 'STALE',
      claims: [{ id: 's', claim: 'ship' }, { id: 'f', claim: 'hold' }] }] },
    grant: g(), intent: { ...intent, subjects: ['subject:release'] }, now });
  t('L2b: a STALE strongest authority is refused, not preferred',
    staleAuth.valid === false && staleAuth.errors.some((e) => /not actionable/.test(e)));

  // The check must be recorded, so a reader can tell it happened.
  t('L2b: the packet records that contradictions were checked against intent',
    unrelated.packet.contradictions_checked_against_intent === true
    && unrelated.packet.intent_subjects.includes('subject:repo'));

  const ok = makeReceipt({ packet: p.packet, outcome: { succeeded: true, budgetUsed: 3,
    evidence: [{ observation: 'court exited 0', ref: '/tmp/court.json' }] }, now });
  t('receipt accepts evidenced success', ok.valid);
  t('receipt binds packet AND context digests',
    ok.receipt.packet_digest === p.packet.packet_digest && ok.receipt.context_digest === ctx.packet_digest);
  t('SUCCESS WITHOUT EVIDENCE REFUSED',
    !makeReceipt({ packet: p.packet, outcome: { succeeded: true }, now }).valid);
  t('empty evidence array refused',
    !makeReceipt({ packet: p.packet, outcome: { succeeded: true, evidence: [] }, now }).valid);
  t('evidence without a ref refused',
    !makeReceipt({ packet: p.packet, outcome: { succeeded: true, evidence: [{ observation: 'looks fine' }] }, now }).valid);
  t('non-boolean succeeded refused',
    !makeReceipt({ packet: p.packet, outcome: { succeeded: 'yes', evidence: [{ observation: 'o', ref: 'r' }] }, now }).valid);
  t('failure must state a reason', !makeReceipt({ packet: p.packet, outcome: { succeeded: false }, now }).valid);
  t('failure with a reason is accepted',
    makeReceipt({ packet: p.packet, outcome: { succeeded: false, failureReason: 'court reported 3 violations' }, now }).valid);
  t('BUDGET OVERRUN refused',
    !makeReceipt({ packet: p.packet, outcome: { succeeded: true, budgetUsed: 99, evidence: [{ observation: 'o', ref: 'r' }] }, now }).valid);

  console.log(`\n  Governed Packet self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
