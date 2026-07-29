import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  CLAIM_CLASS_RULES,
  ENTITY_TYPES,
  M001_HANDOFF_HASH,
  M001_TENANT,
  M001_WORKSPACE,
  PACKAGE_003_SHA256,
  applyCorrection,
  claimRecordId,
  createClaimGraph,
  evaluateClaim,
  evaluateClaimGraph,
  validateClaimGraph,
} from './claim-graph.mjs';
import { canonicalize, sha256 } from '../../mission-2/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const AS_OF = '2026-07-29T12:00:00.000Z';
const OBSERVED_AT = '2026-07-29T11:00:00.000Z';
const EXPIRES_AT = '2026-07-30T11:00:00.000Z';

function errorCode(code) {
  return (error) => error?.code === code;
}

function scoped(fields = {}) {
  return {
    tenant_id: M001_TENANT,
    workspace_id: M001_WORKSPACE,
    ...fields,
  };
}

function entity(entityId, entityType, name, parentEntityId = null) {
  return scoped({
    entity_id: entityId,
    entity_type: entityType,
    name,
    parent_entity_id: parentEntityId,
  });
}

function entities() {
  return [
    entity('entity_platform', 'PLATFORM', 'Synthetic CANA Shadow Platform'),
    entity('entity_org', 'OWNING_ORGANIZATION', 'Synthetic Owning Organization', 'entity_platform'),
    entity('entity_operator', 'OPERATOR', 'Synthetic Operator', 'entity_org'),
    entity('entity_location', 'BUSINESS_LOCATION', 'Synthetic Business Location', 'entity_operator'),
    entity('entity_listing', 'LISTING', 'Synthetic Listing', 'entity_location'),
    entity('entity_service', 'SERVICE', 'Synthetic Service', 'entity_listing'),
    entity('entity_area', 'SERVICE_AREA', 'Synthetic Service Area', 'entity_service'),
    entity('entity_offer', 'OFFER', 'Synthetic Offer', 'entity_listing'),
    entity('entity_product', 'PRODUCT', 'Synthetic Product', 'entity_offer'),
  ];
}

function source(sourceId, authorityClasses, provenance = `SYNTHETIC_FIXTURE:${sourceId}`) {
  return scoped({
    source_id: sourceId,
    authority_classes: authorityClasses,
    source_hash: sha256(provenance),
    provenance,
  });
}

function observation({
  observationId = 'observation_official',
  entityId = 'entity_location',
  claimClass = 'LICENSE_OR_REGULATORY_STATUS',
  value = 'ELIGIBLE',
  sourceRecord = source('source_official', ['OFFICIAL']),
  observedAt = OBSERVED_AT,
  expiresAt = EXPIRES_AT,
  confidence = 1,
  uncertainty = 'SUPPORTED_CURRENT',
} = {}) {
  return scoped({
    observation_id: observationId,
    entity_id: entityId,
    claim_class: claimClass,
    value,
    source_id: sourceRecord.source_id,
    source_hash: sourceRecord.source_hash,
    observed_at: observedAt,
    expires_at: expiresAt,
    confidence,
    uncertainty,
  });
}

function claim({
  claimId = 'claim_license',
  version = 1,
  observationIds = ['observation_official'],
  status = 'ACTIVE',
  supersedesClaimRecordId = null,
  entityId = 'entity_location',
  claimClass = 'LICENSE_OR_REGULATORY_STATUS',
} = {}) {
  return scoped({
    claim_id: claimId,
    claim_record_id: claimRecordId({ claimId, version }),
    entity_id: entityId,
    claim_class: claimClass,
    version,
    observation_ids: observationIds,
    status,
    supersedes_claim_record_id: supersedesClaimRecordId,
  });
}

function verification({
  verificationEventId = 'verification_license_v1',
  claimRecord = claim(),
  observationIds = claimRecord.observation_ids,
  decision = 'APPROVE',
  verifiedAt = AS_OF,
} = {}) {
  return scoped({
    verification_event_id: verificationEventId,
    claim_record_id: claimRecord.claim_record_id,
    observation_ids: observationIds,
    verified_at: verifiedAt,
    verifier_identity: 'verifier_m001_independent_replay',
    decision,
  });
}

function fixture({
  sourceRecords = [source('source_official', ['OFFICIAL'])],
  observationRecords,
  claimRecord,
  verificationRecords,
  sponsorships = [],
} = {}) {
  const selectedClaim = claimRecord ?? claim();
  const selectedObservations = observationRecords ?? [
    observation({ sourceRecord: sourceRecords[0] }),
  ];
  return createClaimGraph({
    entities: entities(),
    sources: sourceRecords,
    observations: selectedObservations,
    claims: [selectedClaim],
    verification_events: verificationRecords ?? [
      verification({ claimRecord: selectedClaim }),
    ],
    corrections: [],
    sponsorships,
  });
}

function mutable(graph) {
  const copy = structuredClone(graph);
  delete copy.graph_hash;
  return copy;
}

test('Package 003 claim classes and canonical bindings remain exact', () => {
  assert.deepEqual(Object.keys(CLAIM_CLASS_RULES).sort(), [
    'DELIVERY_OR_PICKUP_ELIGIBILITY',
    'GENERAL_ELIGIBILITY_RULE',
    'HOURS_FEES_MINIMUMS',
    'LICENSE_OR_REGULATORY_STATUS',
    'LOCATION_AND_SERVICE_AREA',
    'OPERATING_STATUS',
    'PRICE_INVENTORY_OFFER',
  ]);
  assert.equal(ENTITY_TYPES.length, 9);
  assert.equal(PACKAGE_003_SHA256, '173e97573e43f97a1efcfd59b8c33edfb44de4d7afc11735c688c240cbd392fc');
  assert.equal(M001_HANDOFF_HASH, 'baf1492a1aaa3290886b8f3cd77e68515fe15775618dc5fc173ed235a02b9cd3');

  const handoff = JSON.parse(readFileSync(
    resolve(REPOSITORY_ROOT, 'docs/convergence/mission-3/M001_CANONICAL_HANDOFF_PACKET.json'),
    'utf8',
  ));
  assert.equal(handoff.package_003.sha256, PACKAGE_003_SHA256);
  assert.equal(handoff.handoff_hash, M001_HANDOFF_HASH);
  assert.equal(handoff.reused_package_003_negative_fixture.case_count, 51);
  assert.equal(
    handoff.reused_package_003_negative_fixture.sha256,
    '4817c83d7fcf2dc4bc2cd546ff117baa7c1b46d810c614642f57ac6521aaedfe',
  );
});

test('a supported synthetic claim retains exact provenance', () => {
  const graph = fixture();
  const result = evaluateClaim(graph, 'claim_license', AS_OF);
  assert.equal(result.state, 'SUPPORTED_CURRENT');
  assert.equal(result.display_value, 'ELIGIBLE');
  assert.deepEqual(result.provenance, [{
    observation_id: 'observation_official',
    source_id: 'source_official',
    source_hash: sha256('SYNTHETIC_FIXTURE:source_official'),
    observed_at: OBSERVED_AT,
    expires_at: EXPIRES_AT,
  }]);
});

test('stale and expired consequential claims fall back safely', () => {
  const graph = fixture();
  const result = evaluateClaim(graph, 'claim_license', '2026-07-30T11:00:00.000Z');
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'EXPIRED');
  assert.equal(result.display_value, null);
  assert.equal(result.fallback, 'VERIFY DIRECTLY');
});

test('merchant-controlled evidence cannot establish official regulatory truth', () => {
  const official = source('source_official_expired', ['OFFICIAL']);
  const merchant = source('source_merchant', ['AUTHORIZED_MERCHANT', 'FIRST_PARTY']);
  const expiredOfficialObservation = observation({
    observationId: 'observation_official_expired',
    sourceRecord: official,
    observedAt: '2026-07-27T11:00:00.000Z',
    expiresAt: '2026-07-28T11:00:00.000Z',
  });
  const merchantObservation = observation({
    observationId: 'observation_merchant',
    sourceRecord: merchant,
  });
  const merchantClaim = claim({
    observationIds: [
      expiredOfficialObservation.observation_id,
      merchantObservation.observation_id,
    ],
  });
  const graph = fixture({
    sourceRecords: [official, merchant],
    observationRecords: [expiredOfficialObservation, merchantObservation],
    claimRecord: merchantClaim,
    verificationRecords: [verification({
      claimRecord: merchantClaim,
      observationIds: merchantClaim.observation_ids,
    })],
  });
  const result = evaluateClaim(graph, merchantClaim.claim_id, AS_OF);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'UNSUPPORTED_SOURCE_AUTHORITY');
});

test('every admitted claim class enforces its exact source-authority rule', () => {
  const cases = [
    ['LICENSE_OR_REGULATORY_STATUS', [['OFFICIAL']], EXPIRES_AT, AS_OF],
    [
      'OPERATING_STATUS',
      [['AUTHORIZED_MERCHANT'], ['CORROBORATION']],
      EXPIRES_AT,
      AS_OF,
    ],
    [
      'DELIVERY_OR_PICKUP_ELIGIBILITY',
      [['OFFICIAL'], ['OPERATOR_SPECIFIC']],
      EXPIRES_AT,
      AS_OF,
    ],
    ['LOCATION_AND_SERVICE_AREA', [['AUTHORIZED_MERCHANT']], EXPIRES_AT, AS_OF],
    ['HOURS_FEES_MINIMUMS', [['FIRST_PARTY']], EXPIRES_AT, AS_OF],
    [
      'PRICE_INVENTORY_OFFER',
      [['TIMESTAMPED_FIRST_PARTY_FEED']],
      '2026-07-29T12:00:00.000Z',
      '2026-07-29T11:30:00.000Z',
    ],
    ['GENERAL_ELIGIBILITY_RULE', [['OFFICIAL']], EXPIRES_AT, AS_OF],
  ];

  for (const [claimClass, authoritySets, expiresAt, asOf] of cases) {
    const sourceRecords = authoritySets.map((authorities, index) => (
      source(`source_${claimClass.toLowerCase()}_${index}`, authorities)
    ));
    const observationRecords = sourceRecords.map((sourceRecord, index) => observation({
      observationId: `observation_${claimClass.toLowerCase()}_${index}`,
      claimClass,
      sourceRecord,
      expiresAt,
    }));
    const claimRecord = claim({
      claimId: `claim_${claimClass.toLowerCase()}`,
      claimClass,
      observationIds: observationRecords.map(({ observation_id }) => observation_id),
    });
    const graph = fixture({
      sourceRecords,
      observationRecords,
      claimRecord,
      verificationRecords: [verification({
        verificationEventId: `verification_${claimClass.toLowerCase()}`,
        claimRecord,
        observationIds: claimRecord.observation_ids,
        verifiedAt: asOf,
      })],
    });
    assert.equal(
      evaluateClaim(graph, claimRecord.claim_id, asOf).state,
      'SUPPORTED_CURRENT',
      claimClass,
    );
  }
});

test('contradictory observations remain visible and preserved', () => {
  const official = source('source_official', ['OFFICIAL']);
  const corroboration = source('source_corroboration', ['CORROBORATION']);
  const first = observation({ sourceRecord: official });
  const second = observation({
    observationId: 'observation_conflict',
    value: 'NOT_ELIGIBLE',
    sourceRecord: corroboration,
  });
  const conflictingClaim = claim({ observationIds: [first.observation_id, second.observation_id] });
  const graph = fixture({
    sourceRecords: [official, corroboration],
    observationRecords: [first, second],
    claimRecord: conflictingClaim,
    verificationRecords: [verification({
      claimRecord: conflictingClaim,
      observationIds: conflictingClaim.observation_ids,
      decision: 'PRESERVE_CONFLICT',
    })],
  });
  const result = evaluateClaim(graph, conflictingClaim.claim_id, AS_OF);
  assert.equal(result.state, 'CONFLICTED');
  assert.deepEqual(result.contradiction_observation_ids, [
    'observation_conflict',
    'observation_official',
  ]);
  assert.equal(graph.observations.length, 2);
});

test('a correction creates a new version without deleting prior evidence', () => {
  const initial = fixture();
  const prior = initial.claims[0];
  const replacement = observation({
    observationId: 'observation_official_correction',
    value: 'NOT_ELIGIBLE',
    sourceRecord: initial.sources[0],
    observedAt: '2026-07-29T12:15:00.000Z',
    expiresAt: '2026-07-30T12:15:00.000Z',
  });
  const next = claim({
    version: 2,
    observationIds: [replacement.observation_id],
    supersedesClaimRecordId: prior.claim_record_id,
  });
  const corrected = applyCorrection(initial, {
    observations: [replacement],
    claim: next,
    verificationEvent: verification({
      verificationEventId: 'verification_license_v2',
      claimRecord: next,
      observationIds: next.observation_ids,
      verifiedAt: '2026-07-29T12:30:00.000Z',
    }),
    correction: scoped({
      correction_id: 'correction_license_v2',
      prior_claim_record_id: prior.claim_record_id,
      new_claim_record_id: next.claim_record_id,
      prior_observation_ids: prior.observation_ids,
      replacement_observation_ids: next.observation_ids,
      created_at: '2026-07-29T12:20:00.000Z',
      reason: 'Synthetic official correction fixture',
    }),
  });
  assert.equal(corrected.claims.length, 2);
  assert.equal(corrected.claims[0].status, 'SUPERSEDED');
  assert.equal(corrected.claims[1].status, 'ACTIVE');
  assert.ok(corrected.observations.some(({ observation_id }) => observation_id === 'observation_official'));
  assert.ok(corrected.observations.some(({ observation_id }) => observation_id === replacement.observation_id));
  const result = evaluateClaim(corrected, 'claim_license', '2026-07-29T12:30:00.000Z');
  assert.equal(result.display_value, 'NOT_ELIGIBLE');
});

test('sponsorship cannot influence truth, confidence, contradiction visibility, or relevance', () => {
  const baseline = fixture();
  const sponsored = fixture({
    sponsorships: [scoped({
      sponsorship_id: 'sponsorship_synthetic_listing',
      listing_entity_id: 'entity_listing',
      label: 'SPONSORED',
      active: true,
      affects_verification: false,
      affects_confidence: false,
      affects_contradiction_visibility: false,
      affects_truth: false,
      affects_organic_relevance: false,
    })],
  });
  const withoutSponsorship = evaluateClaimGraph(baseline, AS_OF);
  const withSponsorship = evaluateClaimGraph(sponsored, AS_OF);
  assert.deepEqual(withSponsorship.evaluations, withoutSponsorship.evaluations);

  const tampered = mutable(sponsored);
  tampered.sponsorships[0].affects_truth = true;
  assert.throws(() => validateClaimGraph(tampered), errorCode('M001_SPONSORSHIP_INTERFERENCE_DENIED'));
});

test('cross-tenant and cross-workspace records are rejected', () => {
  const tenantGraph = mutable(fixture());
  tenantGraph.observations[0].tenant_id = 'tenant_other';
  assert.throws(() => validateClaimGraph(tenantGraph), errorCode('M001_CROSS_TENANT_DENIED'));

  const workspaceGraph = mutable(fixture());
  workspaceGraph.sources[0].workspace_id = 'workspace_other';
  assert.throws(() => validateClaimGraph(workspaceGraph), errorCode('M001_CROSS_WORKSPACE_DENIED'));
});

test('duplicate identities fail closed', () => {
  const graph = mutable(fixture());
  graph.observations.push(structuredClone(graph.observations[0]));
  assert.throws(() => validateClaimGraph(graph), errorCode('M001_DUPLICATE_IDENTITY'));
});

test('package replay, handoff replay, and graph tampering fail closed', () => {
  const packageReplay = mutable(fixture());
  packageReplay.package_003_sha256 = '0'.repeat(64);
  assert.throws(() => validateClaimGraph(packageReplay), errorCode('M001_PACKAGE_REPLAY_DENIED'));

  const handoffReplay = mutable(fixture());
  handoffReplay.handoff_hash = '1'.repeat(64);
  assert.throws(() => validateClaimGraph(handoffReplay), errorCode('M001_HANDOFF_REPLAY_DENIED'));

  const graph = structuredClone(fixture());
  graph.graph_hash = '2'.repeat(64);
  assert.throws(() => validateClaimGraph(graph), errorCode('M001_GRAPH_TAMPERED'));
});

test('malformed timestamps, impossible expiry order, and TTL broadening fail closed', () => {
  const malformed = mutable(fixture());
  malformed.observations[0].observed_at = '2026-07-29';
  assert.throws(() => validateClaimGraph(malformed), errorCode('M001_TIMESTAMP_INVALID'));

  const impossible = mutable(fixture());
  impossible.observations[0].expires_at = impossible.observations[0].observed_at;
  assert.throws(() => validateClaimGraph(impossible), errorCode('M001_EXPIRY_ORDER_INVALID'));

  const broadened = mutable(fixture());
  broadened.observations[0].expires_at = '2026-07-31T11:00:00.000Z';
  assert.throws(() => validateClaimGraph(broadened), errorCode('M001_TTL_BROADENING_DENIED'));
});

test('source hash, independent verification, and retirement boundaries fail safely', () => {
  const sourceMismatch = mutable(fixture());
  sourceMismatch.observations[0].source_hash = '3'.repeat(64);
  assert.throws(() => validateClaimGraph(sourceMismatch), errorCode('M001_SOURCE_HASH_MISMATCH'));

  const unverified = fixture({ verificationRecords: [] });
  assert.equal(
    evaluateClaim(unverified, 'claim_license', AS_OF).reason,
    'INDEPENDENT_VERIFICATION_REQUIRED',
  );

  const retiredBody = mutable(fixture());
  retiredBody.claims[0].status = 'RETIRED';
  const retired = validateClaimGraph(retiredBody);
  assert.equal(evaluateClaim(retired, 'claim_license', AS_OF).state, 'RETIRED');
});

test('results are deterministic across repeated runs', () => {
  const graphA = fixture();
  const graphB = fixture();
  assert.equal(canonicalize(graphA), canonicalize(graphB));
  assert.equal(
    canonicalize(evaluateClaimGraph(graphA, AS_OF)),
    canonicalize(evaluateClaimGraph(graphB, AS_OF)),
  );
});

test('module execution is independent of shell working directory', () => {
  const moduleUrl = pathToFileURL(resolve(HERE, 'claim-graph.mjs')).href;
  const probe = [
    `import { M001_HANDOFF_HASH, PACKAGE_003_SHA256 } from ${JSON.stringify(moduleUrl)};`,
    `if (M001_HANDOFF_HASH !== ${JSON.stringify(M001_HANDOFF_HASH)}) process.exit(2);`,
    `if (PACKAGE_003_SHA256 !== ${JSON.stringify(PACKAGE_003_SHA256)}) process.exit(3);`,
  ].join('\n');
  for (const cwd of [REPOSITORY_ROOT, HERE]) {
    execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd,
      stdio: 'pipe',
    });
  }
});

test('fixtures are synthetic and contain no live D.C. business record', () => {
  const graph = fixture();
  const encoded = canonicalize(graph);
  assert.match(encoded, /SYNTHETIC_FIXTURE/);
  assert.doesNotMatch(encoded, /dc\.gov|Washington,\s*D\.?C\.?|dispensary|merchant contact/i);
  assert.ok(graph.entities.every(({ name }) => name.startsWith('Synthetic')));
});
