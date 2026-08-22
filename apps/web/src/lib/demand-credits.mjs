/**
 * DEMAND CREDITS — persisted, append-only, hash-chained ledger.
 *
 * Mechanism Matrix M-005. The in-memory prototype proved the guards; this
 * binds them to the database so a real merchant pilot can actually run.
 *
 * INVARIANTS (each enforced here, not merely documented):
 *   1. APPEND-ONLY. No update or delete path exists in this module.
 *   2. DERIVED BALANCE. Balance is summed from entries every time. There is no
 *      balance column, so it cannot drift from the history that justifies it.
 *   3. GAPLESS CHAIN. seq is unique per merchant and each entry binds the
 *      previous entry's hash, so edits, reorders and truncation are detectable.
 *   4. CREDITS BUY PLACEMENT, NEVER RANK.
 *   5. NO VALUE WITHOUT AN EVIDENCE CHAIN.
 *
 * Every rejection returns a denial code — this module never throws to signal a
 * business rule, so callers cannot accidentally swallow a refusal.
 */
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
/** Whitespace-only strings are absent. Non-strings are not text. */
const text = (v) => typeof v === 'string' && v.trim().length > 0;
/**
 * Maximum credits in a single entry. Independent verification proved that two
 * individually-"valid" 1e308 issues sum the derived balance to Infinity, after
 * which spend never depletes — money created from nothing. A ledger needs a
 * domain-realistic ceiling, not just finiteness.
 *
 * 1,000,000 credits is far above any plausible merchant placement budget
 * (Weedmaps' blended average is ~$2,805/mo) while leaving ~9 orders of
 * magnitude of headroom below MAX_SAFE_INTEGER cents.
 */
export const MAX_ENTRY_AMOUNT = 1_000_000;
/** Ledger-wide ceiling so no accumulation of legal entries can reach overflow. */
export const MAX_MERCHANT_BALANCE = 100_000_000;

/**
 * Strict positive finite number within the domain ceiling. Rejects "100", true,
 * [], {} via coercion, AND rejects astronomically large values that would break
 * summation. Amount must also be representable in whole cents.
 */
const money = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_ENTRY_AMOUNT
  && Number.isSafeInteger(Math.round(v * 100));

/**
 * Two identical actions inside this window are ONE event. Wider than a plausible
 * double-click or retry storm, narrower than a genuine repeat visit.
 */
export const IDENTITY_WINDOW_MS = 5 * 60_000;

export const GENESIS_HASH = sha('orderweeddc:demand-credits:genesis');
export const PLACEMENT_KINDS = Object.freeze(['FEATURED_CARD', 'NEIGHBORHOOD_BANNER', 'DEAL_SPOTLIGHT', 'BRAND_COLLECTION']);
export const ACTION_KINDS = Object.freeze(['PROFILE_VIEW', 'MENU_VIEW', 'DIRECTIONS_CLICK', 'PHONE_CLICK', 'WEBSITE_CLICK', 'HANDOFF']);

/** Money is held in integer cents internally so float dust cannot accumulate. */
const toCents = (n) => Math.round(n * 100);
const fromCents = (c) => c / 100;

const deny = (code, detail) => ({ accepted: false, denial_code: code, denial_detail: detail });

/**
 * Canonical serialization — key order is fixed so the hash is reproducible.
 *
 * EXPORTED because the sponsorship resolver must RECOMPUTE this to verify a row
 * rather than merely checking that entryHash is a non-blank string. An
 * independent verifier proved that a presence check let a row with
 * entryHash='x' render a real visible badge on the production homepage.
 * Duplicating the algorithm there would let the two drift; one definition.
 */
/**
 * CANONICAL EVENT IDENTITY — the stable fingerprint of the real-world event a row
 * records, independent of transport, retry, JSON key order, or wall-clock jitter.
 *
 * WHY THIS EXISTS. The endpoint previously deduped by doing a lookup and then an
 * insert. That is a check-then-act race, and it lost: FIFTY simultaneous identical
 * POSTs produced TWO committed rows, because both requests read "no duplicate"
 * before either wrote. No amount of care in the application layer fixes this —
 * only the database can decide, and only with a uniqueness constraint. This
 * function produces the value that constraint is placed on.
 *
 * The identity deliberately EXCLUDES:
 *   - key order (fields are concatenated in a fixed sequence, never JSON.stringify
 *     of a caller-shaped object, whose key order is caller-controlled)
 *   - exact millisecond (bucketed, so a retry milliseconds later is the same event)
 *   - transport details, headers, request ids
 * and deliberately INCLUDES merchantId, so two merchants can never collide and one
 * tenant cannot suppress another's event by guessing its identity.
 */
export function eventIdentityOf({ merchantId, actionKind, evidenceChainSha256, windowBucket, idempotencyKey }) {
  // An explicit idempotency key, when supplied, IS the identity — the caller is
  // asserting "this is the same event". It is still scoped by merchant.
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
    return sha(`k1|${merchantId}|${idempotencyKey.trim()}`);
  }
  return sha([
    'e1',
    String(merchantId ?? ''),
    String(actionKind ?? ''),
    String(evidenceChainSha256 ?? ''),
    String(windowBucket ?? ''),
  ].join('|'));
}

export function hashBody(e, prevHash) {
  return sha(JSON.stringify({
    merchantId: e.merchantId, kind: e.kind, amount: e.amount, seq: e.seq,
    authorizationRef: e.authorizationRef ?? null, expiresAt: e.expiresAt ?? null,
    placement: e.placement ?? null, disclosureLabel: e.disclosureLabel ?? null,
    affectsOrganicOrder: e.affectsOrganicOrder ?? false,
    originalSeq: e.originalSeq ?? null, reason: e.reason ?? null,
    actionKind: e.actionKind ?? null, evidenceChainSha256: e.evidenceChainSha256 ?? null,
    observedAt: e.observedAt ?? null, placementSeq: e.placementSeq ?? null,
    prevHash,
  }));
}

export function createDemandCredits(prisma) {
  const table = prisma.demandCreditEntry;

  /** Chain head for a merchant. Genesis when the merchant has no history. */
  async function head(merchantId) {
    const last = await table.findFirst({ where: { merchantId }, orderBy: { seq: 'desc' } });
    return { prevHash: last?.entryHash ?? GENESIS_HASH, nextSeq: (last?.seq ?? -1) + 1 };
  }

  async function append(merchantId, fields) {
    // VERIFIER FINDING I7 (MEDIUM, latent). SQLite unique indexes IGNORE NULLs, so
    // two ATTRIBUTION rows with eventIdentity=NULL both insert and dedupe silently
    // fails for them. Not reachable today — eventIdentityOf() always returns a
    // 64-hex digest and attribute() always sets it — but the ENTIRE guarantee then
    // rests on that one call site staying correct forever. A guarantee with a
    // single point of discipline is not a guarantee.
    //
    // Fail closed here instead: an ATTRIBUTION without a well-formed identity is
    // refused before it can reach a constraint that would not catch it.
    if (fields?.kind === 'ATTRIBUTION' && !/^[0-9a-f]{64}$/.test(String(fields.eventIdentity ?? ''))) {
      return {
        accepted: false,
        denial_code: 'EVENT_IDENTITY_REQUIRED',
        denial_detail: 'an attribution without a canonical event identity cannot be deduplicated — '
          + 'a NULL identity is invisible to the uniqueness constraint and would silently permit replays',
        decided_by: 'append() fail-closed guard',
      };
    }
    const { prevHash, nextSeq } = await head(merchantId);
    const draft = { merchantId, seq: nextSeq, ...fields };
    const entryHash = hashBody(draft, prevHash);
    try {
      const entry = await table.create({ data: { ...draft, prevHash, entryHash } });
      return { accepted: true, entry };
    } catch (e) {
      // A unique-constraint violation here is not a fault — it is the database
      // correctly refusing a duplicate that the application-level check could not
      // see because a concurrent request had not committed yet. Translate it into
      // the SAME truthful refusal a sequential retry would receive, and return the
      // ROW THAT WON so a retrying caller can be told what actually happened rather
      // than being left guessing.
      const code = e?.code ?? '';
      const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(',') : String(e?.meta?.target ?? '');
      const isUnique = code === 'P2002' || /UNIQUE constraint failed/i.test(String(e?.message ?? ''));
      if (isUnique && (target.includes('eventIdentity') || /eventIdentity/i.test(String(e?.message ?? '')))) {
        const winner = fields.eventIdentity
          ? await table.findFirst({ where: { merchantId, eventIdentity: fields.eventIdentity } })
          : null;
        return {
          accepted: false,
          denial_code: 'DUPLICATE_ATTRIBUTION',
          denial_detail: winner
            ? `this event is already recorded at seq=${winner.seq} — counting it again would inflate proof of value`
            : 'this event is already recorded — counting it again would inflate proof of value',
          existing: winner ?? null,
          decided_by: 'database uniqueness constraint',
        };
      }
      // A seq or entry-hash collision means two writers raced for the same chain
      // position/content. PostgreSQL may report either constraint before the
      // event-identity constraint for an otherwise identical attribution. If the
      // canonical event already won, report that truthful duplicate and return
      // its row. Only an unrelated writer remains genuine chain contention;
      // silently renumbering that case would corrupt the hash chain.
      if (isUnique && /(seq|entryHash)/i.test(target)) {
        const winner = fields.eventIdentity
          ? await table.findFirst({ where: { merchantId, eventIdentity: fields.eventIdentity } })
          : null;
        if (winner) {
          return {
            accepted: false,
            denial_code: 'DUPLICATE_ATTRIBUTION',
            denial_detail: `this event is already recorded at seq=${winner.seq} — counting it again would inflate proof of value`,
            existing: winner,
            decided_by: 'database uniqueness constraint',
          };
        }
        return {
          accepted: false, denial_code: 'CHAIN_POSITION_CONTENDED',
          denial_detail: 'another write took this chain position; retry',
          decided_by: 'database uniqueness constraint',
        };
      }
      throw e;
    }
  }

  /** Balance in whole credits, derived by summing the chain in integer cents. */
  async function balance(merchantId) {
    const rows = await table.findMany({
      where: { merchantId, kind: { in: ['ISSUE', 'SPEND', 'REFUND', 'EXPIRE'] } },
      select: { amount: true },
    });
    return fromCents(rows.reduce((s, r) => s + toCents(r.amount), 0));
  }

  return {
    balance,

    /** Credits enter only with an authorization reference and an expiry. */
    async issue({ merchantId, amount, authorizationRef, expiresAt }) {
      if (!text(merchantId)) return deny('MERCHANT_REQUIRED', 'merchantId must be a non-blank string');
      if (!money(amount)) return deny('INVALID_AMOUNT', `amount=${JSON.stringify(amount)} must be a positive finite number`);
      if (!text(authorizationRef)) return deny('AUTHORIZATION_REQUIRED', 'credits cannot be issued without an authorization reference');
      const exp = expiresAt instanceof Date ? expiresAt : (text(expiresAt) ? new Date(expiresAt) : null);
      if (!exp || Number.isNaN(exp.getTime())) return deny('EXPIRY_REQUIRED', 'credits must carry a valid expiry date');
      if (exp.getTime() <= Date.now()) return deny('EXPIRY_IN_PAST', `expiresAt ${exp.toISOString()} is not in the future — issuing pre-expired credits is meaningless`);
      // Accumulation guard: many individually-legal issues must not be able to
      // walk the balance toward overflow.
      const projected = (await balance(merchantId)) + amount;
      if (projected > MAX_MERCHANT_BALANCE) {
        return deny('BALANCE_CEILING_EXCEEDED', `issuing ${amount} would take the balance to ${projected}, above the ${MAX_MERCHANT_BALANCE} ceiling`);
      }
      return append(merchantId, { kind: 'ISSUE', amount, authorizationRef, expiresAt: exp });
    },

    /**
     * Spend on a labeled PLACEMENT. Refuses any spend that asserts influence
     * over ordering, and any placement lacking a visible disclosure.
     */
    async spend({ merchantId, amount, placement, disclosureLabel, affectsOrganicOrder = false }) {
      if (!text(merchantId)) return deny('MERCHANT_REQUIRED', 'merchantId must be a non-blank string');
      if (!money(amount)) return deny('INVALID_AMOUNT', `amount=${JSON.stringify(amount)} must be a positive finite number`);
      if (!PLACEMENT_KINDS.includes(placement)) return deny('UNKNOWN_PLACEMENT', `${placement} not in ${PLACEMENT_KINDS.join('|')}`);
      // Strict: any truthy non-false value is treated as an attempted rank
      // purchase. A loose `=== true` check would let affectsOrganicOrder:"true"
      // or 1 record as false while the caller believed otherwise.
      if (affectsOrganicOrder !== false && affectsOrganicOrder != null) {
        return deny('RANK_PURCHASE_REFUSED', 'credits buy labeled placement, never organic ordering — sponsorship must not masquerade as rank');
      }
      if (!text(disclosureLabel)) return deny('DISCLOSURE_REQUIRED', 'every paid placement must carry a visible per-card disclosure label');
      const bal = await balance(merchantId);
      if (amount > bal) return deny('INSUFFICIENT_CREDITS', `spend ${amount} exceeds balance ${bal}`);
      return append(merchantId, { kind: 'SPEND', amount: -amount, placement, disclosureLabel, affectsOrganicOrder: false });
    },

    /** Reverse a SPEND, capped cumulatively at the original amount. */
    async refund({ merchantId, amount, reason, originalSeq }) {
      if (!text(merchantId)) return deny('MERCHANT_REQUIRED', 'merchantId must be a non-blank string');
      if (!money(amount)) return deny('INVALID_AMOUNT', `amount=${JSON.stringify(amount)}`);
      if (!text(reason)) return deny('REASON_REQUIRED', 'refunds must state a reason');
      if (!Number.isInteger(originalSeq)) return deny('ORIGINAL_SEQ_REQUIRED', 'originalSeq must be an integer');
      // Ownership is part of the lookup: a merchant can never refund against
      // another merchant's spend.
      const orig = await table.findFirst({ where: { merchantId, seq: originalSeq, kind: 'SPEND' } });
      if (!orig) return deny('ORIGINAL_SPEND_NOT_FOUND', `no SPEND at seq=${originalSeq} for this merchant`);
      const origCents = Math.abs(toCents(orig.amount));
      if (toCents(amount) > origCents) return deny('REFUND_EXCEEDS_SPEND', `refund ${amount} > original ${fromCents(origCents)}`);
      const prior = await table.findMany({ where: { merchantId, kind: 'REFUND', originalSeq }, select: { amount: true } });
      const already = prior.reduce((s, r) => s + toCents(r.amount), 0);
      if (already + toCents(amount) > origCents) {
        return deny('DOUBLE_REFUND_REFUSED', `already refunded ${fromCents(already)} of ${fromCents(origCents)}`);
      }
      return append(merchantId, { kind: 'REFUND', amount, reason, originalSeq });
    },

    /**
     * Record an attributed customer action. Never moves money (amount 0) and
     * requires a complete, dated evidence chain.
     */
    async attribute({ merchantId, actionKind, evidenceChain, observedAt, placementSeq = null,
                      idempotencyKey = null, proofState = 'REQUEST_RECEIVED', valueEligible = false,
                      interactionNonce = null, destination = null }) {
      if (!text(merchantId)) return deny('MERCHANT_REQUIRED', 'merchantId must be a non-blank string');
      if (!ACTION_KINDS.includes(actionKind)) return deny('UNKNOWN_ACTION', `${actionKind} not in ${ACTION_KINDS.join('|')}`);
      if (!Array.isArray(evidenceChain) || evidenceChain.length === 0) {
        return deny('EVIDENCE_CHAIN_REQUIRED', 'an attributed action without an evidence chain is an invented metric');
      }
      if (evidenceChain.length > 64) return deny('EVIDENCE_CHAIN_TOO_LONG', `${evidenceChain.length} links exceeds the 64-link cap`);
      // Use own-property access so a prototype-polluted object cannot fake a link.
      const linkOk = (l) => l && typeof l === 'object'
        && Object.prototype.hasOwnProperty.call(l, 'step') && Object.prototype.hasOwnProperty.call(l, 'ref')
        && text(l.step) && text(l.ref);
      if (!evidenceChain.every(linkOk)) return deny('EVIDENCE_LINK_INCOMPLETE', 'every evidence link needs its own non-blank step and ref');
      const obs = observedAt instanceof Date ? observedAt : (text(observedAt) ? new Date(observedAt) : null);
      if (!obs || Number.isNaN(obs.getTime())) return deny('OBSERVED_AT_REQUIRED', 'an undated action is not evidence');
      if (placementSeq !== null) {
        if (!Number.isInteger(placementSeq)) return deny('PLACEMENT_SEQ_INVALID', 'placementSeq must be an integer');
        const p = await table.findFirst({ where: { merchantId, seq: placementSeq, kind: 'SPEND' } });
        if (!p) return deny('PLACEMENT_NOT_FOUND', `no SPEND at seq=${placementSeq} for this merchant`);
      }
      const chainJson = JSON.stringify(evidenceChain);
      const chainSha = sha(chainJson);
      // Idempotency: the same evidence chain must not inflate proof-of-value twice.
      const dupWhere = text(idempotencyKey)
        ? { merchantId, kind: 'ATTRIBUTION', reason: idempotencyKey }
        : { merchantId, kind: 'ATTRIBUTION', evidenceChainSha256: chainSha };
      const dup = await table.findFirst({ where: dupWhere });
      if (dup) return deny('DUPLICATE_ATTRIBUTION', `this action is already recorded at seq=${dup.seq} — duplicate counting would inflate proof of value`);
      // The lookup above is kept as a FAST PATH — it answers the common sequential
      // retry cheaply and with a clear message. It is explicitly NOT the guarantee.
      // The guarantee is the unique constraint on (merchantId, eventIdentity),
      // which is the only thing that holds under concurrency.
      const identity = eventIdentityOf({
        merchantId, actionKind, evidenceChainSha256: chainSha,
        windowBucket: Math.floor(obs.getTime() / IDENTITY_WINDOW_MS),
        idempotencyKey: text(idempotencyKey) ? idempotencyKey : null,
      });
      return append(merchantId, {
        kind: 'ATTRIBUTION', amount: 0, actionKind,
        evidenceChain: chainJson, evidenceChainSha256: chainSha,
        observedAt: obs, placementSeq, reason: text(idempotencyKey) ? idempotencyKey : null,
        relationshipOwner: 'MERCHANT', exportableByMerchant: true,
        eventIdentity: identity,
        // The grade travels WITH the row. Recomputing it at report time would let a
        // later change silently re-grade history that was already reported.
        proofState, valueEligible: valueEligible === true,
        interactionNonce, destination,
      });
    },

    /**
     * Replay the chain. Detects edits, reorders, truncation and seq gaps.
     * NOTE: a fully self-consistent forgery by an actor with write access to the
     * table cannot be detected by replay alone — that requires an external
     * anchor. Reported honestly rather than overclaimed.
     */
    async verifyChain(merchantId) {
      const rows = await table.findMany({ where: { merchantId }, orderBy: { seq: 'asc' } });
      let prev = GENESIS_HASH;
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i];
        if (e.seq !== i) return { valid: false, brokenAt: e.seq, reason: `seq gap or reorder: expected ${i}, found ${e.seq}` };
        if (e.prevHash !== prev) return { valid: false, brokenAt: e.seq, reason: 'prevHash does not match the preceding entry' };
        if (hashBody(e, prev) !== e.entryHash) return { valid: false, brokenAt: e.seq, reason: 'entryHash does not match the recorded content' };
        prev = e.entryHash;
      }
      return { valid: true, entries: rows.length, head: prev, anchor_caveat: 'Replay detects tampering by anyone without full table write access. It cannot detect a wholesale re-signed chain; that requires an external anchor.' };
    },

    /** Merchant export — the direct answer to "the platform owns your customers". */
    async exportForMerchant(merchantId) {
      const rows = await table.findMany({ where: { merchantId }, orderBy: { seq: 'asc' } });
      return {
        merchant_id: merchantId,
        exported_at: new Date().toISOString(),
        relationship_owner: 'MERCHANT',
        portability_statement: 'These attributed customer relationships belong to the merchant. No lock-in clause restricts their use elsewhere.',
        balance: await balance(merchantId),
        attributed_actions: rows.filter((r) => r.kind === 'ATTRIBUTION'),
        credit_entries: rows.filter((r) => r.kind !== 'ATTRIBUTION'),
        chain_verification: await this.verifyChain(merchantId),
      };
    },

    /** Proof of value — counts only actions carrying a verified evidence chain. */
    async proofOfValue(merchantId) {
      const rows = await table.findMany({ where: { merchantId }, orderBy: { seq: 'asc' } });
      const acts = rows.filter((r) => r.kind === 'ATTRIBUTION');
      const spentCents = rows.filter((r) => r.kind === 'SPEND').reduce((s, r) => s + Math.abs(toCents(r.amount)), 0);
      const byKind = {};
      for (const a of acts) byKind[a.actionKind] = (byKind[a.actionKind] || 0) + 1;
      // Re-verify each stored chain against its recorded hash rather than
      // trusting a flag: an action whose evidence no longer hashes correctly
      // must not be counted as evidenced.
      const evidenced = acts.filter((a) => a.evidenceChain && sha(a.evidenceChain) === a.evidenceChainSha256);
      return {
        merchant_id: merchantId,
        credits_spent: fromCents(spentCents),
        attributed_actions: acts.length,
        actions_with_verified_evidence: evidenced.length,
        actions_by_kind: byKind,
        every_action_has_evidence: acts.length > 0 && evidenced.length === acts.length,
        not_claimed: ['ranking position', 'traffic', 'impressions', 'leads', 'conversion lift'],
        disclaimer: 'Counts only actions whose evidence chain re-hashes to its recorded digest. No ranking, traffic, or conversion-lift figure is claimed or implied.',
        chain_verification: await this.verifyChain(merchantId),
      };
    },
  };
}
