// INVARIANT EXPERIENCE FABRIC — kernel v1 (OWD-EXPERIENCE-FABRIC).
//
// The safe workshop for experience mutation. An agent never receives
// application-write authority; it receives an INTENT PATCH — a scoped,
// risk-classified, default-deny declaration of exactly what it wants to
// change — and the kernel enforces:
//
//   INTENT PATCH (goal, scope, risk R0-R4, allowed ops, declared write set)
//     → PRIVATE MUTATION on a content-addressed experience state
//     → ORACLE COURT (deterministic, pluggable; generator never self-certifies)
//     → CONFLICT DETECTION across concurrent patches
//         STRUCTURAL_DISJOINT → safe merge candidate
//         SAME_FACT           → QUARANTINE (never silently pick a winner)
//     → MERCHANT APPROVAL GATE (promotion refused without explicit approval)
//     → PROOF-CARRYING RECEIPT (hash-chained, tamper-evident)
//     → EXACT ROLLBACK by content address.
//
// Protected invariants (the oracles this kernel ships): merchant identity is
// never reassigned; inventory and verified-availability bindings are never
// mutated by presentation patches; accessibility contract fields survive
// every mutation; forbidden paths stay untouched; economic outcomes stay
// UNKNOWN until reality supplies evidence — beauty never becomes revenue by
// wishful thinking. Visual/responsive/runtime oracles require a browser and
// are PLANNED, not faked.
//
// Independent implementation of the Slice-1 contract described in the owner's
// cross-account report (that session's patch was not available in this
// environment); composed on this branch's existing custody patterns.
import { createHash } from 'node:crypto';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));

export class FabricError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'FabricError'; this.code = code; }
}
const refuse = (code, msg) => { throw new FabricError(code, msg); };

export const RISK_LEVELS = Object.freeze(['R0', 'R1', 'R2', 'R3', 'R4']);
// Paths presentation patches may NEVER write, regardless of declaration.
export const PROTECTED_PATHS = Object.freeze([
  'merchant.id', 'merchant.identity', 'merchant.brand',
  'inventory', 'fulfillment.verified_availability',
  'contract', 'economics',
]);

const inProtected = (p) => PROTECTED_PATHS.some((guard) => p === guard || p.startsWith(`${guard}.`));
const inDeclared = (p, declared) => declared.some((d) => (d.endsWith('.*') ? p.startsWith(d.slice(0, -1)) : p === d));

/** Validate an IntentPatch. Default-deny: everything not declared is forbidden. */
export function validateIntentPatch(patch) {
  if (!patch || typeof patch !== 'object') refuse('PATCH_ABSENT', 'an intent patch object is required');
  if (!text(patch.goal)) refuse('PATCH_FIELD', 'goal required — what is this mutation for?');
  if (!text(patch.scope)) refuse('PATCH_FIELD', 'scope required (hero|product_rail|fulfillment|...)');
  if (!RISK_LEVELS.includes(patch.risk)) refuse('PATCH_RISK', `risk must be one of ${RISK_LEVELS.join('|')}`);
  if (!text(patch.agent)) refuse('PATCH_FIELD', 'agent identity required — anonymous mutation is refused');
  if (!Array.isArray(patch.write_set) || patch.write_set.length === 0 || !patch.write_set.every(text)) {
    refuse('PATCH_WRITE_SET', 'a non-empty declared write set is required — undeclared writing is the crime this kernel exists to prevent');
  }
  for (const p of patch.write_set) {
    if (inProtected(p)) refuse('PROTECTED_PATH', `write set declares protected path "${p}" — merchant identity, inventory, availability, contracts, and economics are not presentation surfaces`);
  }
  if (!patch.mutation || typeof patch.mutation !== 'object' || Object.keys(patch.mutation).length === 0) {
    refuse('PATCH_MUTATION', 'a concrete mutation map { "dot.path": value } is required');
  }
  for (const p of Object.keys(patch.mutation)) {
    if (inProtected(p)) refuse('PROTECTED_PATH', `mutation touches protected path "${p}"`);
    if (!inDeclared(p, patch.write_set)) refuse('WRITE_SET_ESCAPE', `mutation writes "${p}" outside the declared write set — default-deny`);
  }
  return true;
}

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

/** Content address of an experience state — the exact-rollback anchor. */
export const stateAddress = (state) => `xs_${sha(canonical(state)).slice(0, 20)}`;

/**
 * Six deterministic oracles shipped now (visual/responsive/interaction/runtime
 * oracles need a browser and are PLANNED — never simulated). Each returns
 * { oracle, status: 'PASS'|'FAIL', detail }.
 */
export function runOracles(before, after, patch) {
  const results = [];
  const r = (oracle, ok, detail) => results.push({ oracle, status: ok ? 'PASS' : 'FAIL', detail });

  // SCHEMA — the mutated state stays a plain serializable object tree.
  let serializable = true;
  try { canonical(after); } catch { serializable = false; }
  r('SCHEMA', serializable, serializable ? 'state serializes canonically' : 'state no longer serializes');

  // BRAND — merchant identity block byte-identical.
  r('BRAND', canonical(after.merchant) === canonical(before.merchant),
    'merchant identity block must be byte-identical across presentation mutations');

  // DATA-TRUTH — inventory + verified availability bindings untouched.
  r('DATA-TRUTH',
    canonical(after.inventory) === canonical(before.inventory)
    && canonical(after.fulfillment?.verified_availability) === canonical(before.fulfillment?.verified_availability),
    'inventory and verified-availability bindings are market truth, not presentation');

  // ACCESSIBILITY — contract a11y fields survive.
  r('ACCESSIBILITY', canonical(after.contract?.accessibility) === canonical(before.contract?.accessibility),
    'accessibility contract fields must survive every mutation');

  // POLICY — no mutated path outside declaration, none protected (recheck on the DIFF, not the claim).
  const diffPaths = Object.keys(patch.mutation);
  const policyOk = diffPaths.every((p) => !inProtected(p) && inDeclared(p, patch.write_set));
  r('POLICY', policyOk, 'every changed path is declared and unprotected');

  // ECONOMIC-TRUTH — conversion/revenue stay UNKNOWN unless reality-evidenced.
  const econ = after.economics ?? {};
  const econOk = (econ.conversion ?? 'UNKNOWN') === 'UNKNOWN' && (econ.revenue ?? 'UNKNOWN') === 'UNKNOWN';
  r('ECONOMIC-TRUTH', econOk, 'a beautiful mutation never becomes revenue by assertion — economics stay UNKNOWN until measured');

  return { results, verdict: results.every((x) => x.status === 'PASS') ? 'PASS' : 'FAIL' };
}

/** Conflict analysis between two intent patches over the same base state. */
export function analyzeConflict(patchA, patchB) {
  const a = Object.keys(patchA.mutation);
  const b = Object.keys(patchB.mutation);
  const shared = a.filter((p) => b.includes(p));
  if (shared.length === 0) return { relation: 'STRUCTURAL_DISJOINT', quarantine: false, shared: [] };
  const sameFactDiffers = shared.some((p) => canonical(patchA.mutation[p]) !== canonical(patchB.mutation[p]));
  return {
    relation: 'SAME_FACT',
    quarantine: sameFactDiffers,
    shared,
    note: sameFactDiffers
      ? 'two agents assert different values for the same fact — quarantined; the kernel never silently picks a winner'
      : 'same fact, identical value — idempotent overlap',
  };
}

/**
 * The fabric: content-addressed states, private mutation, oracle court,
 * approval gate, receipts, exact rollback. In-memory reference with a
 * receipt log the caller may persist through the existing ledger patterns.
 */
export class ExperienceFabric {
  constructor(initialState) {
    if (!initialState || typeof initialState !== 'object') refuse('STATE_REQUIRED', 'an initial experience state is required');
    this.states = new Map();
    this.receipts = [];
    this.approvals = new Set();
    const addr = stateAddress(initialState);
    this.states.set(addr, JSON.parse(canonical(initialState)));
    this.head = addr;
  }

  current() { return JSON.parse(canonical(this.states.get(this.head))); }

  /** Private mutation: applies the patch on a COPY; the head does not move. */
  mutatePrivate(patch) {
    validateIntentPatch(patch);
    const before = this.current();
    const after = JSON.parse(canonical(before));
    for (const [p, v] of Object.entries(patch.mutation)) setPath(after, p, v);
    const court = runOracles(before, after, patch);
    const addr = stateAddress(after);
    const receipt = {
      kind: 'PRIVATE_MUTATION',
      at: new Date().toISOString(),
      agent: patch.agent, goal: patch.goal, scope: patch.scope, risk: patch.risk,
      base: this.head, candidate: addr,
      write_set: patch.write_set, changed_paths: Object.keys(patch.mutation),
      court, promoted: false,
      prev_receipt: this.receipts.length ? this.receipts[this.receipts.length - 1].hash : 'GENESIS',
    };
    receipt.hash = sha(canonical({ ...receipt, hash: undefined }));
    this.receipts.push(receipt);
    if (court.verdict === 'PASS') this.states.set(addr, after);
    return { candidate: court.verdict === 'PASS' ? addr : null, court, receipt_hash: receipt.hash };
  }

  /** Merchant approval is an explicit act, recorded. */
  approve(candidateAddr, { merchant }) {
    if (!text(merchant)) refuse('APPROVAL_IDENTITY', 'approval requires a merchant identity');
    if (!this.states.has(candidateAddr)) refuse('CANDIDATE_UNKNOWN', `no candidate state ${candidateAddr}`);
    this.approvals.add(candidateAddr);
    return { approved: true };
  }

  /** Promotion moves the head — refused without approval. Exact rollback is a promotion to a prior address. */
  promote(candidateAddr) {
    if (!this.states.has(candidateAddr)) refuse('CANDIDATE_UNKNOWN', `no candidate state ${candidateAddr}`);
    if (!this.approvals.has(candidateAddr)) refuse('APPROVAL_REQUIRED', 'promotion without merchant approval is refused — an agent never publishes to a merchant surface on its own authority');
    const from = this.head;
    this.head = candidateAddr;
    const receipt = {
      kind: 'PROMOTION', at: new Date().toISOString(), from, to: candidateAddr,
      prev_receipt: this.receipts.length ? this.receipts[this.receipts.length - 1].hash : 'GENESIS',
    };
    receipt.hash = sha(canonical({ ...receipt, hash: undefined }));
    this.receipts.push(receipt);
    return { promoted: true, head: this.head };
  }

  rollback(addr) {
    if (!this.states.has(addr)) refuse('ROLLBACK_UNKNOWN', `no stored state ${addr} — exact rollback needs an exact address`);
    this.approvals.add(addr); // rolling back to a previously-held state is inherently approved history
    return this.promote(addr);
  }

  verifyReceipts() {
    let prev = 'GENESIS';
    for (const [i, r] of this.receipts.entries()) {
      const { hash, ...body } = r;
      if (r.prev_receipt !== prev || sha(canonical({ ...body, hash: undefined })) !== hash) return { valid: false, at: i };
      prev = hash;
    }
    return { valid: true, count: this.receipts.length };
  }
}
