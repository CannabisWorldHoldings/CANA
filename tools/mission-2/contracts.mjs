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

function requireExactFields(value, fields, code, message) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  assertMission(
    JSON.stringify(actual) === JSON.stringify(expected),
    code,
    message,
    { expected, actual },
  );
}

export function validateMissionContract(input) {
  requireObject(input, 'mission');
  const missionFields = [
    'schema_version',
    'mission_id',
    'tenant_id',
    'workspace_id',
    'mission_type',
    'objective',
    'originating_signal',
    'source_repository',
    'source_commit',
    'source_tree',
    'source_evidence_references',
    'context_compiler_version',
    'context_packet_hash',
    'authority_identity',
    'authorization_identity',
    'permitted_files',
    'permitted_resources',
    'permitted_capabilities',
    'provider_state',
    'hermes_state',
    'approved_hermes_pin',
    'budget',
    'external_effect_policy',
    'production_access',
    'timeout_ms',
    'expires_at',
    'success_criteria',
    'verifier_identity',
    'verification_contract',
    'rollback_procedure',
    'current_lifecycle_state',
    'latest_checkpoint',
    'execution_attempts',
    'evidence_references',
    'failure_history',
    'promotion_status',
    'next_eligible_action',
  ];
  requireExactFields(
    input,
    Object.hasOwn(input, 'contract_hash') ? [...missionFields, 'contract_hash'] : missionFields,
    'MISSION_SCHEMA_FIELDS_DENIED',
    'Mission contract fields differ from the exact canonical schema',
  );
  assertMission(input.schema_version === MISSION_SCHEMA_VERSION, 'SCHEMA_VERSION_DENIED', `schema_version must be ${MISSION_SCHEMA_VERSION}`);
  requireText(input.mission_id, 'mission_id');
  requireText(input.tenant_id, 'tenant_id');
  requireText(input.workspace_id, 'workspace_id');
  requireText(input.mission_type, 'mission_type');
  requireText(input.objective, 'objective');
  requireObject(input.originating_signal, 'originating_signal');
  requireExactFields(
    input.originating_signal,
    ['signal_id', 'evidence_ref'],
    'ORIGINATING_SIGNAL_FIELDS_DENIED',
    'Originating signal fields differ from the exact canonical schema',
  );
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
  requireExactFields(
    input.budget,
    ['currency', 'maximum', 'spent'],
    'BUDGET_FIELDS_DENIED',
    'Budget fields differ from the exact canonical schema',
  );
  assertMission(input.budget.currency === 'USD' && input.budget.maximum === 0 && input.budget.spent === 0, 'NONZERO_BUDGET_DENIED', 'Mission 2 budget must remain USD 0');
  requireExactString(input.external_effect_policy, 'NONE', 'external_effect_policy');
  requireExactString(input.production_access, 'NONE', 'production_access');
  assertMission(Number.isInteger(input.timeout_ms) && input.timeout_ms > 0, 'INVALID_TIMEOUT', 'timeout_ms must be a positive integer');
  requireIso(input.expires_at, 'expires_at');
  assertMission(Array.isArray(input.success_criteria) && input.success_criteria.length > 0, 'SUCCESS_CRITERIA_REQUIRED', 'success_criteria must be non-empty');
  input.success_criteria.forEach((criterion) => requireText(criterion, 'success_criteria[]'));
  requireText(input.verifier_identity, 'verifier_identity');
  assertMission(input.verifier_identity !== input.authorization_identity, 'VERIFIER_NOT_INDEPENDENT', 'Verifier identity must be independent from authorization');
  requireObject(input.verification_contract, 'verification_contract');
  requireExactFields(
    input.verification_contract,
    ['operation', 'expected_text'],
    'VERIFICATION_CONTRACT_FIELDS_DENIED',
    'Verification contract fields differ from the exact canonical schema',
  );
  requireObject(input.verification_contract.operation, 'verification_contract.operation');
  requireExactFields(
    input.verification_contract.operation,
    ['kind', 'path', 'find', 'replace'],
    'VERIFICATION_OPERATION_FIELDS_DENIED',
    'Verification operation fields differ from the exact canonical schema',
  );
  requireExactString(
    input.verification_contract.operation.kind,
    'REPLACE_EXACT_TEXT',
    'verification_contract.operation.kind',
  );
  const verificationPath = normalizeExactPath(input.verification_contract.operation.path);
  assertMission(
    permittedFiles.includes(verificationPath),
    'VERIFICATION_PATH_OUTSIDE_SCOPE',
    'Verification operation path must be one of the exact permitted files',
  );
  requireText(input.verification_contract.operation.find, 'verification_contract.operation.find');
  requireText(input.verification_contract.operation.replace, 'verification_contract.operation.replace');
  requireText(input.verification_contract.expected_text, 'verification_contract.expected_text');
  requireObject(input.rollback_procedure, 'rollback_procedure');
  requireExactFields(
    input.rollback_procedure,
    ['kind', 'description'],
    'ROLLBACK_PROCEDURE_FIELDS_DENIED',
    'Rollback procedure fields differ from the exact canonical schema',
  );
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
    verification_contract: {
      ...structuredClone(input.verification_contract),
      operation: {
        ...structuredClone(input.verification_contract.operation),
        path: verificationPath,
      },
    },
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

const FOUNDRY_COMMON_FIELDS = Object.freeze([
  'tenant_id',
  'workspace_id',
  'provenance',
  'source_hash',
  'truth_state',
  'record_id',
]);

function requireBoolean(value, field) {
  assertMission(typeof value === 'boolean', 'BOOLEAN_REQUIRED', `${field} must be a boolean`, { field });
}

function requireFiniteNumber(value, field) {
  assertMission(Number.isFinite(value), 'FINITE_NUMBER_REQUIRED', `${field} must be a finite number`, { field });
}

function requireTextArray(value, field, minimum = 1) {
  assertMission(
    Array.isArray(value) && value.length >= minimum,
    'TEXT_ARRAY_REQUIRED',
    `${field} must contain at least ${minimum} values`,
    { field },
  );
  value.forEach((entry) => requireText(entry, `${field}[]`));
}

function requireOneOf(value, choices, field) {
  assertMission(choices.includes(value), 'ENUM_VALUE_DENIED', `${field} is not an allowed value`, {
    field,
    choices,
    actual: value,
  });
}

function requireExactFoundryFields(record, fields) {
  const allowed = [...FOUNDRY_COMMON_FIELDS, ...fields].sort();
  const actual = Object.keys(record).sort();
  assertMission(
    JSON.stringify(actual) === JSON.stringify(allowed.filter((field) => field !== 'record_id' || record.record_id !== undefined)),
    'FOUNDRY_SCHEMA_FIELDS_DENIED',
    'Foundry record fields differ from the exact type schema',
    { allowed, actual },
  );
}

export function validateFoundryRecord(type, record) {
  assertMission(FOUNDRY_TYPES.includes(type), 'UNKNOWN_FOUNDRY_TYPE', `Unknown foundry record ${type}`);
  requireObject(record, 'record');
  requireText(record.tenant_id, 'tenant_id');
  requireText(record.workspace_id, 'workspace_id');
  requireText(record.provenance, 'provenance');
  requireSha256(record.source_hash, 'source_hash');
  assertMission(record.raw_transcript !== true, 'RAW_TRANSCRIPT_HOT_MEMORY_DENIED', 'Raw transcripts may not enter hot memory');
  assertMission(record.truth_state !== 'VALUE_PROVEN', 'UNSUPPORTED_VALUE_PROVEN', 'Research and shadow fixtures cannot claim VALUE_PROVEN');
  if (record.record_id !== undefined) requireText(record.record_id, 'record_id');

  if (type === 'SOURCE_RECORD') {
    requireExactFoundryFields(record, ['title', 'source_kind', 'fixture_label']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY'], 'truth_state');
    requireText(record.title, 'title');
    requireText(record.source_kind, 'source_kind');
    requireText(record.fixture_label, 'fixture_label');
  } else if (type === 'INSIGHT_CAPSULE') {
    requireExactFoundryFields(record, ['source_record_id', 'statement', 'authority_classification']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY'], 'truth_state');
    requireText(record.source_record_id, 'source_record_id');
    requireText(record.statement, 'statement');
    requireOneOf(record.authority_classification, ['SOURCE_ONLY', 'MECHANISM_CANDIDATE'], 'authority_classification');
  } else if (type === 'DUPLICATE_RELATIONSHIP') {
    requireExactFoundryFields(record, ['canonical_record_id', 'duplicate_record_id', 'relationship_basis']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY'], 'truth_state');
    requireText(record.canonical_record_id, 'canonical_record_id');
    requireText(record.duplicate_record_id, 'duplicate_record_id');
    requireText(record.relationship_basis, 'relationship_basis');
    assertMission(record.canonical_record_id !== record.duplicate_record_id, 'SELF_DUPLICATE_DENIED', 'A record cannot duplicate itself');
  } else if (type === 'CONTRADICTION_RECORD') {
    assertMission(record.deleted !== true, 'CONTRADICTION_DELETION_DENIED', 'Contradictions may not be deleted');
    requireExactFoundryFields(record, ['claims', 'resolution_state', 'deleted']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY'], 'truth_state');
    requireTextArray(record.claims, 'claims', 2);
    requireOneOf(record.resolution_state, ['OPEN', 'RESOLVED', 'SUPERSEDED'], 'resolution_state');
    requireBoolean(record.deleted, 'deleted');
  } else if (type === 'RESEARCH_GAP') {
    requireExactFoundryFields(record, ['source_record_id', 'question', 'answer_state']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY'], 'truth_state');
    requireText(record.source_record_id, 'source_record_id');
    requireText(record.question, 'question');
    requireOneOf(record.answer_state, ['UNPROVEN', 'PARTIAL', 'ANSWERED'], 'answer_state');
  } else if (type === 'MECHANISM_CANDIDATE') {
    requireExactFoundryFields(record, [
      'source_record_id',
      'insight_capsule_id',
      'mechanism_key',
      'desired_state',
      'measured_state',
      'bounded_error',
      'intervention',
      'falsification_test',
      'rollback',
      'commercial_value_claimed',
    ]);
    requireOneOf(record.truth_state, ['MECHANISM_CANDIDATE'], 'truth_state');
    requireText(record.source_record_id, 'source_record_id');
    requireText(record.insight_capsule_id, 'insight_capsule_id');
    requireText(record.mechanism_key, 'mechanism_key');
    requireFiniteNumber(record.desired_state, 'desired_state');
    requireFiniteNumber(record.measured_state, 'measured_state');
    requireFiniteNumber(record.bounded_error, 'bounded_error');
    requireFiniteNumber(record.intervention, 'intervention');
    requireText(record.falsification_test, 'falsification_test');
    requireText(record.rollback, 'rollback');
    requireBoolean(record.commercial_value_claimed, 'commercial_value_claimed');
    assertMission(record.commercial_value_claimed === false, 'UNSUPPORTED_COMMERCIAL_VALUE', 'Shadow mechanisms cannot claim commercial value');
  } else if (type === 'CODEX_HANDOFF_PACKET') {
    requireExactFoundryFields(record, ['mechanism_candidate_id', 'authorized_adapter', 'provider', 'hermes', 'budget_usd']);
    requireOneOf(record.truth_state, ['AUTHORIZED_FOR_SHADOW_TEST'], 'truth_state');
    requireText(record.mechanism_candidate_id, 'mechanism_candidate_id');
    requireOneOf(record.authorized_adapter, ['DETERMINISTIC_MOCK'], 'authorized_adapter');
    requireOneOf(record.provider, ['NONE'], 'provider');
    requireOneOf(record.hermes, ['DISABLED'], 'hermes');
    assertMission(record.budget_usd === 0, 'NONZERO_BUDGET_DENIED', 'Foundry handoff budget must remain zero');
  } else if (type === 'IMPLEMENTATION_RESULT') {
    requireExactFoundryFields(record, [
      'mechanism_candidate_id',
      'handoff_packet_id',
      'test_result',
      'measured_before',
      'measured_after',
      'bounded_intervention',
      'external_effects',
      'commercial_value_claimed',
    ]);
    requireOneOf(record.truth_state, ['TECHNICALLY_VERIFIED', 'REJECTED'], 'truth_state');
    requireText(record.mechanism_candidate_id, 'mechanism_candidate_id');
    requireText(record.handoff_packet_id, 'handoff_packet_id');
    requireOneOf(record.test_result, ['PASS', 'FAIL'], 'test_result');
    requireFiniteNumber(record.measured_before, 'measured_before');
    requireFiniteNumber(record.measured_after, 'measured_after');
    requireFiniteNumber(record.bounded_intervention, 'bounded_intervention');
    assertMission(record.external_effects === 0, 'EXTERNAL_EFFECT_DENIED', 'Foundry result cannot record external effects');
    requireBoolean(record.commercial_value_claimed, 'commercial_value_claimed');
    assertMission(record.commercial_value_claimed === false, 'UNSUPPORTED_COMMERCIAL_VALUE', 'Technical result cannot claim commercial value');
  } else if (type === 'MECHANISM_STATE_TRANSITION') {
    requireExactFoundryFields(record, ['mechanism_candidate_id', 'from_state', 'to_state', 'implementation_result_id', 'value_state']);
    requireText(record.mechanism_candidate_id, 'mechanism_candidate_id');
    requireOneOf(record.from_state, TRUTH_STATES, 'from_state');
    requireOneOf(record.to_state, TRUTH_STATES, 'to_state');
    requireText(record.implementation_result_id, 'implementation_result_id');
    requireOneOf(record.value_state, ['VALUE_NOT_ESTABLISHED', 'OUTCOME_PENDING'], 'value_state');
    assertMission(record.truth_state === record.to_state, 'TRANSITION_TRUTH_STATE_MISMATCH', 'Transition truth_state must equal to_state');
  } else if (type === 'OWNER_DECISION_REQUEST') {
    requireExactFoundryFields(record, ['authority_requirement', 'question', 'options']);
    requireOneOf(record.truth_state, ['SOURCE_ONLY', 'MECHANISM_CANDIDATE'], 'truth_state');
    requireText(record.authority_requirement, 'authority_requirement');
    requireText(record.question, 'question');
    requireTextArray(record.options, 'options', 2);
  }

  const { record_id: providedRecordId, ...identity } = structuredClone(record);
  const base = { schema_version: `cana.foundry/${type.toLowerCase()}/1.0.0`, type, ...identity };
  const stableId = deterministicId(type.toLowerCase(), identity);
  if (providedRecordId !== undefined) assertMission(providedRecordId === stableId, 'UNSTABLE_RECORD_ID', 'Foundry record ID does not recompute');
  return deepFreeze({ ...base, record_id: stableId, packet_hash: hashCanonical(base) });
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value));
}
