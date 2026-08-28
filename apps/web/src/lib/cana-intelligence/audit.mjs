import { deepFreeze } from './core.mjs';

export function auditKernelState({ observations = [], experiments = [], receipts = [], lessons = [], allocations = [] }) {
  const violations = [];
  const pass = [];
  const check = (name, rows) => rows.length ? violations.push(...rows) : pass.push(name);

  check('OBSERVATION_PROVENANCE', observations.filter((o) => !o.provenance || !o.evidenceDigest).map((o) => ({ invariant: 'OBSERVATION_PROVENANCE', severity: 'CRITICAL', subject: o.id ?? o.entityKey })));
  check('SYNTHETIC_CONTAINMENT', observations.filter((o) => ['SIMULATOR', 'TEST_FIXTURE'].includes(o.sourceKind) && o.epistemicState !== 'SYNTHETIC').map((o) => ({ invariant: 'SYNTHETIC_CONTAINMENT', severity: 'CRITICAL', subject: o.id ?? o.entityKey })));
  check('NO_UNAUTHORIZED_EXECUTION', experiments.filter((e) => ['AUTHORIZED', 'RUNNING', 'SETTLED'].includes(e.status) && !e.authorizedBy).map((e) => ({ invariant: 'NO_UNAUTHORIZED_EXECUTION', severity: 'CRITICAL', subject: e.experimentId })));
  check('NO_FABRICATED_ECONOMICS', receipts.filter((r) => r.revenueImpactUsd !== null && r.causalStatus !== 'CAUSALLY_SUPPORTED').map((r) => ({ invariant: 'NO_FABRICATED_ECONOMICS', severity: 'CRITICAL', subject: r.receiptId })));
  check('TRUSTED_LESSON_REQUIRES_CAUSALITY', lessons.filter((l) => l.trusted && l.causalStatus !== 'CAUSALLY_SUPPORTED').map((l) => ({ invariant: 'TRUSTED_LESSON_REQUIRES_CAUSALITY', severity: 'CRITICAL', subject: l.lessonId })));
  check('ARMADA_RECEIPT_REQUIRED', allocations.filter((a) => !a.allocationDigest || !a.winnerAgentId).map((a) => ({ invariant: 'ARMADA_RECEIPT_REQUIRED', severity: 'MAJOR', subject: a.receiptId })));

  return deepFreeze({ checks: pass.length + new Set(violations.map((v) => v.invariant)).size, passed: pass, violations, verdict: violations.some((v) => v.severity === 'CRITICAL') ? 'FAIL' : violations.length ? 'WARN' : 'PASS' });
}
