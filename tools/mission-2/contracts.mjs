import {
  assertMission,
  canonicalize,
  deepFreeze,
  deterministicId,
  hashCanonical,
  normalizeExactPath,
  requireIso,
  requireSha,
  requireSha256,
  requireText,
  uniqueSorted,
} from './canonical.mjs';

export const MISSION_SCHEMA_VERSION = 'cana.mission/2.0.0';
export const CONTEXT_COMPILER_VERSION = 'sitemind-context-compiler/mission-2-adapter-1';
export const PROVIDER_NONE = 'NONE';
export const HERMES_DISABLED = 'DISABLED';
export const APPROVED_HERMES_PIN_NONE = 'NONE';
export const MISSION_2_CAPABILITIES = Object.freeze([
  'COMPILE_CONTEXT',
  'GENERATE_REPORT',
  'READ_REPOSITORY',
  'RUN_TESTS',
  'WRITE_LOCAL_BRANCH',
]);

export const LIFECYCLE = Object.freeze([
  'SIGNAL_OBSERVED',
  'CONTEXT_COMPILED',
  'MISSION_SEALED',
  'CANA_AUTHORIZED',
  'EXECUTOR_DISPATCHED',
  'ACTION_EXECUTED',
  'EVIDENCE_CAPTURED',
  'INDEPENDENTLY_VERIFIED',
  'PROMOTED',
  'REJECTED',
  'TRUTHGRAPH_UPDATED',
  'WINNER_MEMORY_UPDATED',
  'ROLLED_BACK',
  'PAUSED',
  'CANCELLED',
  'DEAD_LETTER',
  'OWNER_DECISION_REQUIRED',
]);

export const PRIMARY_TRANSITIONS = Object.freeze({
  SIGNAL_OBSERVED: ['CONTEXT_COMPILED', 'REJECTED', 'CANCELLED', 'PAUSED'],
  CONTEXT_COMPILED: ['MISSION_SEALED', 'REJECTED', 'CANCELLED', 'PAUSED'],
  MISSION_SEALED: ['CANA_AUTHORIZED', 'REJECTED', 'CANCELLED', 'PAUSED'],
  CANA_AUTHORIZED: ['EXECUTOR_DISPATCHED', 'REJECTED', 'CANCELLED', 'PAUSED'],
  EXECUTOR_DISPATCHED: ['ACTION_EXECUTED', 'REJECTED', 'PAUSED', 'DEAD_LETTER'],
  ACTION_EXECUTED: ['EVIDENCE_CAPTURED', 'ROLLED_BACK', 'REJECTED', 'PAUSED'],
  EVIDENCE_CAPTURED: ['INDEPENDENTLY_VERIFIED', 'ROLLED_BACK', 'REJECTED', 'PAUSED'],
  INDEPENDENTLY_VERIFIED: ['PROMOTED', 'REJECTED', 'ROLLED_BACK'],
  PROMOTED: ['TRUTHGRAPH_UPDATED', 'ROLLED_BACK'],
  TRUTHGRAPH_UPDATED: ['WINNER_MEMORY_UPDATED', 'ROLLED_BACK'],
  WINNER_MEMORY_UPDATED: ['ROLLED_BACK'],
  PAUSED: ['SIGNAL_OBSERVED', 'CONTEXT_COMPILED', 'MISSION_SEALED', 'CANA_AUTHORIZED', 'EXECUTOR_DISPATCHED', 'ACTION_EXECUTED', 'EVIDENCE_CAPTURED'],
  REJECTED: [],
  CANCELLED: [],
  DEAD_LETTER: ['OWNER_DECISION_REQUIRED'],
  OWNER_DECISION_REQUIRED: [],
  ROLLED_BACK: [],
});

function requireObject(value, field) {
  assertMission(value && typeof value === 'object' && !Array.isArray(value), 'OBJECT_REQUIRED', `${field} must be an object`, { field });
  return value;
}

function requireExactString(value, expected, field) {
  assertMission(value === expected, 'BOUNDARY_VIOLATION', `${field} must equal ${expected}`, { field, expected, actual: value });
}

export function validateMissionContract(input) {
  requireObject(input, 'mission');
  assertMission(input.schema_version === MISSION_SCHEMA_VERSION, 'SCHEMA_VERSION_DENIED', `schema_version must be ${MISSION_SCHEMA_VERSION}`);
  requireText(input.mission_id, 'mission_id');
  requireText(input.tenant_id, 'tenant_id');
  requireText(input.workspace_id, 'workspace_id');
  requireText(input.mission_type, 'mission_type');
  requireText(input.objective, 'objective');
  requireObject(input.originating_signal, 'originating_signal');
  requireText(input.originating_signal.signal_id, 'originating_signal.signal_id');
  requireText(input.originating_signal.evidence_ref, 'originating_signal.evidence_ref');
  requireText(input.source_repository, 'source_repository');
  requireSha(input.source_commit, 'source_commit');
  requireSha(input.source_tree, 'source_tree');
  const sourceEvidenceReferences = uniqueSorted(input.source_evidence_references, 'source_evidence_references');
  requireText(input.context_compiler_version, 'context_compiler_version');
  requireSha256(input.context_packet_hash, 'context_packet_hash');
  requireText(input.authority_identity, 'authority_identity');
  requireText(input.authorization_identity, 'authorization_identity');
  const permittedFiles = uniqueSorted(input.permitted_files, 'permitted_files').map(normalizeExactPath);
  const permittedResources = uniqueSorted(input.permitted_resources, 'permitted_resources');
  const permittedCapabilities = uniqueSorted(input.permitted_capabilities, 'permitted_capabilities');
  assertMission(
    permittedCapabilities.every((capability) => MISSION_2_CAPABILITIES.includes(capability)),
    'CAPABILITY_BROADENING_DENIED',
    'Mission requests a capability outside the Mission 2 deterministic mock boundary',
  );
  requireExactString(input.provider_state, PROVIDER_NONE, 'provider_state');
  requireExactString(input.hermes_state, HERMES_DISABLED, 'hermes_state');
  requireExactString(input.approved_hermes_pin, APPROVED_HERMES_PIN_NONE, 'approved_hermes_pin');
  requireObject(input.budget, 'budget');
  assertMission(input.budget.currency === 'USD' && input.budget.maximum === 0 && input.budget.spent === 0, 'NONZERO_BUDGET_DENIED', 'Mission 2 budget must remain USD 0');
  requireExactString(input.external_effect_policy, 'NONE', 'external_effect_policy');
  requireExactString(input.production_access, 'NONE', 'production_access');
  assertMission(Number.isInteger(input.timeout_ms) && input.timeout_ms > 0, 'INVALID_TIMEOUT', 'timeout_ms must be a positive integer');
  requireIso(input.expires_at, 'expires_at');
  assertMission(Array.isArray(input.success_criteria) && input.success_criteria.length > 0, 'SUCCESS_CRITERIA_REQUIRED', 'success_criteria must be non-empty');
  input.success_criteria.forEach((criterion) => requireText(criterion, 'success_criteria[]'));
  requireText(input.verifier_identity, 'verifier_identity');
  assertMission(input.verifier_identity !== input.authorization_identity, 'VERIFIER_NOT_INDEPENDENT', 'Verifier identity must be independent from authorization');
  requireObject(input.rollback_procedure, 'rollback_procedure');
  requireText(input.rollback_procedure.kind, 'rollback_procedure.kind');
  requireText(input.rollback_procedure.description, 'rollback_procedure.description');
  assertMission(LIFECYCLE.includes(input.current_lifecycle_state), 'INVALID_LIFECYCLE_STATE', 'Unknown lifecycle state');
  assertMission(input.latest_checkpoint === null || typeof input.latest_checkpoint === 'object', 'INVALID_CHECKPOINT', 'latest_checkpoint must be null or an object');
  assertMission(Array.isArray(input.execution_attempts), 'INVALID_ATTEMPTS', 'execution_attempts must be an array');
  assertMission(Array.isArray(input.evidence_references), 'INVALID_EVIDENCE_REFERENCES', 'evidence_references must be an array');
  assertMission(Array.isArray(input.failure_history), 'INVALID_FAILURE_HISTORY', 'failure_history must be an array');
  requireText(input.promotion_status, 'promotion_status');
  requireText(input.next_eligible_action, 'next_eligible_action');

  const normalized = {
    ...structuredClone(input),
    source_evidence_references: sourceEvidenceReferences,
    permitted_files: permittedFiles,
    permitted_resources: permittedResources,
    permitted_capabilities: permittedCapabilities,
  };
  const { contract_hash: ignored, ...hashable } = normalized;
  const contractHash = hashCanonical(hashable);
  if (input.contract_hash !== undefined) {
    requireSha256(input.contract_hash, 'contract_hash');
    assertMission(input.contract_hash === contractHash, 'MISSION_TAMPERED', 'Mission contract hash does not recompute');
  }
  return deepFreeze({ ...hashable, contract_hash: contractHash });
}

export function createMissionContract(fields) {
  return validateMissionContract({ schema_version: MISSION_SCHEMA_VERSION, ...fields });
}

export function assertTransition(current, next) {
  assertMission(LIFECYCLE.includes(current) && LIFECYCLE.includes(next), 'INVALID_LIFECYCLE_STATE', `${current} -> ${next}`);
  assertMission(PRIMARY_TRANSITIONS[current]?.includes(next), 'ILLEGAL_TRANSITION', `Illegal lifecycle transition ${current} -> ${next}`, { current, next });
}

export const TRUTH_STATES = Object.freeze([
  'SOURCE_ONLY',
  'MECHANISM_CANDIDATE',
  'AUTHORIZED_FOR_SHADOW_TEST',
  'TECHNICALLY_VERIFIED',
  'OUTCOME_PENDING',
  'VALUE_NOT_ESTABLISHED',
  'VALUE_PROVEN',
  'REJECTED',
  'ROLLED_BACK',
  'SUPERSEDED',
]);

export const FOUNDRY_TYPES = Object.freeze([
  'SOURCE_RECORD',
  'INSIGHT_CAPSULE',
  'DUPLICATE_RELATIONSHIP',
  'CONTRADICTION_RECORD',
  'RESEARCH_GAP',
  'MECHANISM_CANDIDATE',
  'CODEX_HANDOFF_PACKET',
  'IMPLEMENTATION_RESULT',
  'MECHANISM_STATE_TRANSITION',
  'OWNER_DECISION_REQUEST',
]);

export function validateFoundryRecord(type, record) {
  assertMission(FOUNDRY_TYPES.includes(type), 'UNKNOWN_FOUNDRY_TYPE', `Unknown foundry record ${type}`);
  requireObject(record, 'record');
  requireText(record.tenant_id, 'tenant_id');
  requireText(record.workspace_id, 'workspace_id');
  requireText(record.provenance, 'provenance');
  requireSha256(record.source_hash, 'source_hash');
  assertMission(record.raw_transcript !== true, 'RAW_TRANSCRIPT_HOT_MEMORY_DENIED', 'Raw transcripts may not enter hot memory');
  assertMission(record.truth_state !== 'VALUE_PROVEN', 'UNSUPPORTED_VALUE_PROVEN', 'Research and shadow fixtures cannot claim VALUE_PROVEN');
  if (type === 'CONTRADICTION_RECORD') {
    assertMission(Array.isArray(record.claims) && record.claims.length >= 2, 'CONTRADICTION_REQUIRED', 'Contradiction records preserve at least two claims');
    assertMission(record.deleted !== true, 'CONTRADICTION_DELETION_DENIED', 'Contradictions may not be deleted');
  }
  if (type === 'DUPLICATE_RELATIONSHIP') {
    requireText(record.canonical_record_id, 'canonical_record_id');
    requireText(record.duplicate_record_id, 'duplicate_record_id');
    assertMission(record.canonical_record_id !== record.duplicate_record_id, 'SELF_DUPLICATE_DENIED', 'A record cannot duplicate itself');
  }
  if (type === 'MECHANISM_CANDIDATE') {
    requireText(record.mechanism_key, 'mechanism_key');
    requireText(record.falsification_test, 'falsification_test');
    requireText(record.rollback, 'rollback');
  }
  if (type === 'OWNER_DECISION_REQUEST') requireText(record.authority_requirement, 'authority_requirement');
  const base = { schema_version: `cana.foundry/${type.toLowerCase()}/1.0.0`, type, ...structuredClone(record) };
  const stableId = deterministicId(type.toLowerCase(), {
    tenant_id: record.tenant_id,
    workspace_id: record.workspace_id,
    source_hash: record.source_hash,
    mechanism_key: record.mechanism_key ?? null,
    canonical_record_id: record.canonical_record_id ?? null,
    duplicate_record_id: record.duplicate_record_id ?? null,
  });
  if (record.record_id !== undefined) assertMission(record.record_id === stableId, 'UNSTABLE_RECORD_ID', 'Foundry record ID does not recompute');
  return deepFreeze({ ...base, record_id: stableId, packet_hash: hashCanonical(base) });
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value));
}
