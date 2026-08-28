// Type surface for the Experience Fabric kernel (kernel.mjs).
// The kernel is the canonical owner of experience mutation; this file only describes
// its shape to TypeScript callers. It adds no behavior and must not drift from the
// implementation — kernel.mjs is authoritative.

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export interface IntentPatch {
  goal: string;
  scope: string;
  risk: RiskLevel;
  agent: string;
  /** Declared, default-deny write surface. Dotted paths; a trailing `.*` allows a subtree. */
  write_set: string[];
  /** Concrete `{ "dot.path": value }` map. Every key must fall inside write_set. */
  mutation: Record<string, unknown>;
}

export type OracleName =
  | 'SCHEMA' | 'BRAND' | 'DATA-TRUTH' | 'ACCESSIBILITY' | 'POLICY' | 'ECONOMIC-TRUTH';

export interface OracleResult {
  oracle: OracleName;
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface Court {
  results: OracleResult[];
  verdict: 'PASS' | 'FAIL';
}

/** `candidate` is null when the court refused — there is no half-admitted state. */
export interface MutationOutcome {
  candidate: string | null;
  court: Court;
  receipt_hash: string;
}

export declare class FabricError extends Error {
  code: string;
}

export declare const RISK_LEVELS: readonly RiskLevel[];
export declare const PROTECTED_PATHS: readonly string[];

export declare function validateIntentPatch(patch: IntentPatch): true;
export declare function stateAddress(state: unknown): string;
export declare function runOracles(before: unknown, after: unknown, patch: IntentPatch): Court;
export declare function analyzeConflict(
  a: IntentPatch,
  b: IntentPatch,
): { relation: 'STRUCTURAL_DISJOINT' | 'SAME_FACT'; quarantine: boolean; shared: string[]; note?: string };

export declare class ExperienceFabric {
  constructor(initialState: unknown);
  head: string;
  receipts: ReadonlyArray<Record<string, unknown>>;
  /** The state at HEAD. `mutatePrivate` does NOT move HEAD. */
  current<T = unknown>(): T;
  /** Applies the patch to a copy, courts it, stores it only on PASS. HEAD is unchanged. */
  mutatePrivate(patch: IntentPatch): MutationOutcome;
  /** Explicit, recorded merchant approval. Required before promotion. */
  approve(candidateAddress: string, opts: { merchant: string }): { approved: true };
  /** Moves HEAD. Refused without approval. */
  promote(candidateAddress: string): { promoted: true; head: string };
  /** Exact rollback: promotion to a previously-held address; inherently approved. */
  rollback(address: string): { promoted: true; head: string };
  verifyReceipts(): { valid: boolean; at?: number };
}
