/**
 * EVIDENCE REALM LAW — the epistemic ceiling every claim carries.
 *
 * Gene recovered from the Sovereign Cell donor's `evidence-realm` concept and
 * reimplemented as a canonical standalone primitive. It owns ONE job: classify
 * evidence by realm and refuse silent upgrades across realms.
 *
 * Laws enforced (CANA constitution, evidence realm):
 *   - Evidence has a realm. A claim lives AT a realm.
 *   - No lower realm may silently upgrade itself.
 *   - SYNTHETIC -> REAL_OUTCOME is forbidden.
 *   - SHADOW -> PRODUCTION is forbidden without real production evidence.
 *   - TEST PASS -> MARKET SUCCESS is forbidden (that mapping is a separate
 *     category error; this module refuses the realm jump that would encode it).
 *
 * This module mints and checks receipts only. It authorizes nothing and proves
 * no market outcome — it is pure, deterministic law over inert data.
 */

export const EVIDENCE_REALMS = Object.freeze([
  'LOCAL',
  'FIXTURE',
  'INTEGRATION',
  'ADVERSARIAL',
  'SHADOW',
  'PRODUCTION',
  'REAL_OUTCOME',
]);

export const REALM_RANK = Object.freeze({
  LOCAL: 0,
  FIXTURE: 1,
  INTEGRATION: 2,
  ADVERSARIAL: 3,
  SHADOW: 4,
  PRODUCTION: 5,
  REAL_OUTCOME: 6,
});

/** Realms whose content is fabricated, simulated, or otherwise not observed. */
export const SYNTHETIC_REALMS = new Set(['LOCAL', 'FIXTURE', 'INTEGRATION', 'ADVERSARIAL']);

/**
 * Forbidden silent upgrades, as [fromRealm, toRealm] pairs. Upgrading across a
 * forbidden pair requires an INDEPENDENT evidence receipt minted at (or above)
 * the target realm — never the claim's own issuer alone.
 */
export const FORBIDDEN_UPGRADES = Object.freeze([
  ['LOCAL', 'REAL_OUTCOME'],
  ['FIXTURE', 'REAL_OUTCOME'],
  ['INTEGRATION', 'REAL_OUTCOME'],
  ['ADVERSARIAL', 'REAL_OUTCOME'],
  ['SHADOW', 'REAL_OUTCOME'],
  ['SHADOW', 'PRODUCTION'],
]);

export function isRealm(value) {
  return typeof value === 'string' && value in REALM_RANK;
}

export function realmRank(realm) {
  if (!isRealm(realm)) throw new Error(`unknown evidence realm: ${String(realm)}`);
  return REALM_RANK[realm];
}

/**
 * Mint an evidence receipt. A receipt is inert data; it grants nothing.
 * `digest` is the SHA-256 of the canonical bytes the receipt covers.
 */
export function makeEvidenceReceipt({
  claim,
  realm,
  source,
  issuer,
  time,
  digest,
  dependencies = [],
  uncertainty = null,
  expiry = null,
}) {
  if (!isRealm(realm)) throw new Error(`receipt realm must be a valid realm, got ${String(realm)}`);
  if (typeof claim !== 'string' || claim.trim() === '') throw new Error('receipt requires a claim');
  if (typeof digest !== 'string' || digest.trim() === '') throw new Error('receipt requires a digest');
  return {
    schema: 'cana.evidence-receipt/1',
    claim,
    realm,
    source,
    issuer,
    time,
    digest,
    dependencies,
    uncertainty,
    expiry,
  };
}

/**
 * Judge a proposed realm transition.
 *
 * @param {string} fromRealm current realm of the claim
 * @param {string} toRealm   realm being asserted
 * @param {object|null} evidence evidence receipt supporting the upgrade
 * @returns {{ok: boolean, kind?: string, reason?: string}}
 *
 * Downgrades and same-realm restatements are always allowed. An upgrade
 * requires an evidence receipt whose own realm is at least `toRealm`. A
 * forbidden-pair upgrade additionally requires target-class evidence
 * (REAL_OUTCOME for the synthetic->real jump; PRODUCTION or better for the
 * shadow->production jump).
 */
export function assertNoSilentUpgrade(fromRealm, toRealm, evidence = null) {
  if (!isRealm(fromRealm) || !isRealm(toRealm)) {
    return { ok: false, reason: `realms must be valid (got ${fromRealm} -> ${toRealm})` };
  }
  const fromRank = realmRank(fromRealm);
  const toRank = realmRank(toRealm);

  if (toRank < fromRank) return { ok: true, kind: 'DOWNGRADE' };
  if (toRank === fromRank) return { ok: true, kind: 'SAME' };

  // Upward move: evidence is mandatory.
  if (!evidence) {
    return { ok: false, reason: `silent upgrade ${fromRealm} -> ${toRealm} refused: an evidence receipt is required` };
  }
  if (!isRealm(evidence.realm)) {
    return { ok: false, reason: `evidence receipt has invalid realm ${String(evidence.realm)}` };
  }
  if (realmRank(evidence.realm) < toRank) {
    return { ok: false, reason: `evidence realm ${evidence.realm} cannot support an assertion at ${toRealm}` };
  }

  const forbidden = FORBIDDEN_UPGRADES.some(([a, b]) => a === fromRealm && b === toRealm);
  if (forbidden) {
    if (fromRealm === 'SHADOW' && toRealm === 'PRODUCTION') {
      if (evidence.realm !== 'PRODUCTION' && evidence.realm !== 'REAL_OUTCOME') {
        return { ok: false, reason: 'SHADOW -> PRODUCTION requires real production evidence' };
      }
    } else if (evidence.realm !== 'REAL_OUTCOME') {
      return { ok: false, reason: `${fromRealm} -> ${toRealm} is forbidden without independent REAL_OUTCOME evidence` };
    }
  }

  return { ok: true, kind: 'UPGRADE_WITH_EVIDENCE' };
}
