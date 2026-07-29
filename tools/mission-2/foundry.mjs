import {
  assertMission,
  deepFreeze,
  hashCanonical,
} from './canonical.mjs';
import { validateFoundryRecord } from './contracts.mjs';

export const TRANSCRIPT_FIXTURE_LABEL = 'DETERMINISTIC_TEST_FIXTURE_NOT_REAL_RESEARCH_EVIDENCE';

export class KnowledgeToMechanismFoundry {
  constructor() {
    this.records = new Map();
    this.mechanismIds = new Set();
  }

  admit(type, input) {
    const record = validateFoundryRecord(type, input);
    assertMission(!this.records.has(record.record_id), 'DUPLICATE_RECORD_ID', `Duplicate foundry record ${record.record_id}`);
    const requireReference = (field, expectedType = null) => {
      const referenced = this.records.get(record[field]);
      assertMission(referenced, 'FOUNDRY_REFERENCE_MISSING', `Foundry reference is missing: ${field}`);
      assertMission(
        referenced.tenant_id === record.tenant_id
          && referenced.workspace_id === record.workspace_id,
        'CROSS_TENANT_DENIED',
        `Foundry reference crosses a tenant or workspace boundary: ${field}`,
      );
      if (expectedType) {
        assertMission(
          referenced.type === expectedType,
          'FOUNDRY_REFERENCE_TYPE_MISMATCH',
          `Foundry reference has the wrong type: ${field}`,
        );
      }
    };
    if (type === 'INSIGHT_CAPSULE' || type === 'RESEARCH_GAP') {
      requireReference('source_record_id', 'SOURCE_RECORD');
    } else if (type === 'MECHANISM_CANDIDATE') {
      requireReference('source_record_id', 'SOURCE_RECORD');
      requireReference('insight_capsule_id', 'INSIGHT_CAPSULE');
    } else if (type === 'CODEX_HANDOFF_PACKET') {
      requireReference('mechanism_candidate_id', 'MECHANISM_CANDIDATE');
    } else if (type === 'IMPLEMENTATION_RESULT') {
      requireReference('mechanism_candidate_id', 'MECHANISM_CANDIDATE');
      requireReference('handoff_packet_id', 'CODEX_HANDOFF_PACKET');
    } else if (type === 'MECHANISM_STATE_TRANSITION') {
      requireReference('mechanism_candidate_id', 'MECHANISM_CANDIDATE');
      requireReference('implementation_result_id', 'IMPLEMENTATION_RESULT');
    } else if (type === 'DUPLICATE_RELATIONSHIP') {
      requireReference('canonical_record_id');
      requireReference('duplicate_record_id');
    }
    if (type === 'MECHANISM_CANDIDATE') {
      assertMission(!this.mechanismIds.has(record.mechanism_key), 'DUPLICATE_MECHANISM_ID', `Duplicate mechanism ${record.mechanism_key}`);
      this.mechanismIds.add(record.mechanism_key);
    }
    this.records.set(record.record_id, record);
    return record;
  }

  get(recordId, tenantId) {
    const record = this.records.get(recordId);
    assertMission(record, 'FOUNDRY_RECORD_NOT_FOUND', `Foundry record not found: ${recordId}`);
    assertMission(record.tenant_id === tenantId, 'CROSS_TENANT_DENIED', 'Foundry record tenant mismatch');
    return record;
  }

  list(tenantId) {
    return deepFreeze([...this.records.values()]
      .filter((record) => record.tenant_id === tenantId)
      .sort((a, b) => a.record_id.localeCompare(b.record_id)));
  }
}

export function buildMeasuredErrorControllerFixture({ tenantId, workspaceId, sourceHash }) {
  const foundry = new KnowledgeToMechanismFoundry();
  const common = {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    source_hash: sourceHash,
    provenance: TRANSCRIPT_FIXTURE_LABEL,
    truth_state: 'SOURCE_ONLY',
  };
  const source = foundry.admit('SOURCE_RECORD', {
    ...common,
    title: 'Measured error controller transcript fixture',
    source_kind: 'DETERMINISTIC_FIXTURE',
    fixture_label: TRANSCRIPT_FIXTURE_LABEL,
  });
  const insight = foundry.admit('INSIGHT_CAPSULE', {
    ...common,
    source_record_id: source.record_id,
    statement: 'Desired state minus measured state yields a bounded error used to select the smallest authorized intervention.',
    authority_classification: 'SOURCE_ONLY',
  });
  const gap = foundry.admit('RESEARCH_GAP', {
    ...common,
    source_record_id: source.record_id,
    question: 'Does the bounded controller improve any real merchant or user outcome?',
    answer_state: 'UNPROVEN',
  });
  const mechanism = foundry.admit('MECHANISM_CANDIDATE', {
    ...common,
    truth_state: 'MECHANISM_CANDIDATE',
    source_record_id: source.record_id,
    insight_capsule_id: insight.record_id,
    mechanism_key: 'MEASURED_ERROR_CONTROLLER_V1',
    desired_state: 10,
    measured_state: 7,
    bounded_error: 3,
    intervention: 1,
    falsification_test: 'Reject if intervention exceeds the bounded error or authorized maximum of one.',
    rollback: 'Restore the exact pre-intervention fixture state.',
    commercial_value_claimed: false,
  });
  const handoff = foundry.admit('CODEX_HANDOFF_PACKET', {
    ...common,
    truth_state: 'AUTHORIZED_FOR_SHADOW_TEST',
    mechanism_candidate_id: mechanism.record_id,
    authorized_adapter: 'DETERMINISTIC_MOCK',
    provider: 'NONE',
    hermes: 'DISABLED',
    budget_usd: 0,
  });
  const implementation = foundry.admit('IMPLEMENTATION_RESULT', {
    ...common,
    truth_state: 'TECHNICALLY_VERIFIED',
    mechanism_candidate_id: mechanism.record_id,
    handoff_packet_id: handoff.record_id,
    test_result: 'PASS',
    measured_before: 7,
    measured_after: 8,
    bounded_intervention: 1,
    external_effects: 0,
    commercial_value_claimed: false,
  });
  const transition = foundry.admit('MECHANISM_STATE_TRANSITION', {
    ...common,
    truth_state: 'TECHNICALLY_VERIFIED',
    mechanism_candidate_id: mechanism.record_id,
    from_state: 'AUTHORIZED_FOR_SHADOW_TEST',
    to_state: 'TECHNICALLY_VERIFIED',
    implementation_result_id: implementation.record_id,
    value_state: 'VALUE_NOT_ESTABLISHED',
  });
  return deepFreeze({
    fixture_label: TRANSCRIPT_FIXTURE_LABEL,
    records: foundry.list(tenantId),
    ids: {
      source: source.record_id,
      insight: insight.record_id,
      gap: gap.record_id,
      mechanism: mechanism.record_id,
      handoff: handoff.record_id,
      implementation: implementation.record_id,
      transition: transition.record_id,
    },
    receipt_hash: hashCanonical({
      fixture_label: TRANSCRIPT_FIXTURE_LABEL,
      record_ids: foundry.list(tenantId).map((record) => record.record_id),
      value_state: 'VALUE_NOT_ESTABLISHED',
    }),
  });
}
