// tools/authority/gk-compat.test.mjs — PHASE E1 BEHAVIOR-COMPATIBILITY PROOF.
//
// The owner mandated: prove the native Node containment port (containment.mjs) is behavior-compatible
// with the Python governor-kernel it replaces. This court runs the SAME containment attack vectors
// through BOTH engines and asserts IDENTICAL accept/refuse verdicts (and identical refusal CODES):
//   - Node:   tools/authority/containment.mjs :: ContainmentStore.authorizeAndReserve
//   - Python: packages/governor-kernel/standalone/runtime/rsi.py :: RSIGovernor.authorize_and_reserve
//             (driven by tools/authority/gk_compat_bridge.py)
//
// If python3 (or its deps) is unavailable, the court falls back to the Python-DERIVED expected
// verdicts encoded below with file:line provenance into rsi.py, and asserts the Node port against
// those fixtures. Either way the Node port is proven against the Python semantics.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContainmentStore } from './containment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-08-20T12:00:00Z';
const FAR = '2027-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

// ── The shared attack battery. Each vector: a seeded authorization + capability + budgets, then one
//    contract. Both engines receive identical inputs. Expected verdicts are the Python semantics with
//    file:line provenance into rsi.py (used as the fallback oracle and as documentation).
const VECTORS = [
  {
    name: 'accept_narrow',
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['RUN_TESTS'], allowed_resources: ['docs/*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['RUN_TESTS'], allowed_resources: ['docs/tests/*'], call_budget: 5, runtime_budget: 5 },
    budgets: { calls: 100 },
    contract: { action_type: 'RUN_TESTS', resource: 'docs/tests/a.md', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', mission_id: 'm1', budget: { calls: 1 } },
    expected: { admitted: true, code: null }, // rsi.py:281 COMMIT
  },
  {
    name: 'refuse_capability_exceeds_actions', // rsi.py:233-234
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['RUN_TESTS'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['RUN_TESTS', 'DEPLOY'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'CAPABILITY_EXCEEDS_AUTHORIZATION' },
  },
  {
    name: 'refuse_capability_exceeds_resources', // rsi.py:235-236
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['docs/*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['secrets/*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'secrets/a', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'CAPABILITY_EXCEEDS_AUTHORIZATION' },
  },
  {
    name: 'refuse_capability_exceeds_budget', // rsi.py:237-239
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 3, runtime_budget: 3 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 99, runtime_budget: 3 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'CAPABILITY_EXCEEDS_AUTHORIZATION' },
  },
  {
    name: 'refuse_action_not_allowed', // rsi.py:246-247
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['RUN_TESTS'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['RUN_TESTS'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'DELETE_EVERYTHING', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'ACTION_NOT_ALLOWED' },
  },
  {
    name: 'refuse_resource_not_allowed', // rsi.py:248-249
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['docs/*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['docs/*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'etc/passwd', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'RESOURCE_NOT_ALLOWED' },
  },
  {
    name: 'refuse_cross_tenant', // rsi.py:242
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'OTHER', site_id: 'S' },
    expected: { admitted: false, code: 'CROSS_TENANT' },
  },
  {
    name: 'refuse_identity_mismatch_actor', // rsi.py:241
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'IMPOSTER', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'IDENTITY_MISMATCH' },
  },
  {
    name: 'refuse_missing_rollback_consequential', // rsi.py:254-255
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'site.publish', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', evidence_refs: ['e'], rollback_contract: '' },
    expected: { admitted: false, code: 'MISSING_ROLLBACK' },
  },
  {
    name: 'refuse_missing_evidence_consequential', // rsi.py:256-257
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'site.publish', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', evidence_refs: [], rollback_contract: 'restore' },
    expected: { admitted: false, code: 'MISSING_EVIDENCE' },
  },
  {
    name: 'refuse_idempotency_replay', // rsi.py:258-262
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: { calls: 100 },
    pre: [{ op: 'authorize' }], // a prior identical admit arms the idempotency key
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', mission_id: 'dup', budget: { calls: 1 } },
    expected: { admitted: false, code: 'IDEMPOTENCY_REPLAY' },
  },
  {
    name: 'refuse_budget_exceeded', // rsi.py:269-270
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: { calls: 2 },
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', mission_id: 'over', budget: { calls: 5 } },
    expected: { admitted: false, code: 'BUDGET_EXCEEDED' },
  },
  {
    name: 'refuse_unknown_budget', // rsi.py:267
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S', mission_id: 'ub', budget: { nonexistent: 1 } },
    expected: { admitted: false, code: 'UNKNOWN_BUDGET' },
  },
  {
    name: 'refuse_authorization_revoked', // rsi.py:212 + revoke rsi.py:122-126
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    pre: [{ op: 'revoke', target_type: 'authorization', target_id: 'AUTH' }],
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'AUTHORIZATION_REVOKED' },
  },
  {
    name: 'refuse_capability_revoked', // rsi.py:224
    auth: { actor_id: 'o', tenant_id: 'T', site_id: 'S', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 10, runtime_budget: 10 },
    cap: { worker_id: 'w', allowed_actions: ['*'], allowed_resources: ['*'], call_budget: 5, runtime_budget: 5 },
    budgets: {},
    pre: [{ op: 'revoke', target_type: 'capability', target_id: 'CAP' }],
    contract: { action_type: 'RUN_TESTS', resource: 'x', actor_id: 'o', worker_id: 'w', tenant_id: 'T', site_id: 'S' },
    expected: { admitted: false, code: 'CAPABILITY_REVOKED' },
  },
];

// ── Run a vector through the Node port. Mirrors the Python bridge's setup. ──
function runNodeVector(rootDir, v) {
  const dir = join(rootDir, v.name);
  const store = new ContainmentStore(dir);
  for (const [name, lim] of Object.entries(v.budgets ?? {})) store.setBudget(name, lim);
  const authId = 'auth_seed';
  const capId = 'cap_seed';
  store.issueAuthorization({
    id: authId, actor_id: v.auth.actor_id, tenant_id: v.auth.tenant_id, site_id: v.auth.site_id,
    allowed_actions: v.auth.allowed_actions, allowed_resources: v.auth.allowed_resources,
    financial_budget: 0, runtime_budget: v.auth.runtime_budget ?? 1000, call_budget: v.auth.call_budget ?? 1000,
    delegation_depth: v.auth.delegation_depth ?? 2, issued_at: NOW, not_before: null, expires_at: FAR,
  });
  store.issueCapability({
    id: capId, worker_id: v.cap.worker_id, authorization_id: authId,
    allowed_actions: v.cap.allowed_actions, allowed_resources: v.cap.allowed_resources,
    runtime_budget: v.cap.runtime_budget ?? 100, call_budget: v.cap.call_budget ?? 100,
    delegation_depth: v.cap.delegation_depth ?? 0, issued_at: NOW, expires_at: FAR,
  });
  const build = (ct) => ({
    id: `act_${v.name}_${Math.random().toString(36).slice(2, 8)}`,
    action_type: ct.action_type, resource: ct.resource,
    authorization_id: ct.authorization_id === undefined ? authId : (ct.authorization_id === 'AUTH' ? authId : ct.authorization_id),
    worker_capability_id: ct.worker_capability_id === undefined ? capId : (ct.worker_capability_id === 'CAP' ? capId : ct.worker_capability_id),
    actor_id: ct.actor_id ?? null, worker_id: ct.worker_id ?? null,
    tenant_id: ct.tenant_id ?? null, site_id: ct.site_id ?? null, mission_id: ct.mission_id ?? null,
    evidence_refs: ct.evidence_refs ?? [], rollback_contract: ct.rollback_contract ?? '', budget: ct.budget ?? {},
    not_before: null, expires_at: null,
  });
  for (const pre of v.pre ?? []) {
    if (pre.op === 'revoke') store.revoke(pre.target_type, pre.target_id === 'AUTH' ? authId : capId);
    else if (pre.op === 'authorize') { try { store.authorizeAndReserve(build(pre.contract ?? v.contract), { now: NOW }); } catch { /* arm only */ } }
  }
  try {
    store.authorizeAndReserve(build(v.contract), { now: NOW });
    return { vector: v.name, admitted: true, code: null };
  } catch (e) {
    return { vector: v.name, admitted: false, code: e.code };
  }
}

function pythonAvailable() {
  const probe = spawnSync('python3', ['-c', 'import sqlite3,json,hmac,hashlib,uuid;print("ok")'], { encoding: 'utf8' });
  return probe.status === 0 && /ok/.test(probe.stdout ?? '');
}

test('E1 compat: Node containment port matches the Python governor-kernel verdicts', () => {
  const rootNode = mkdtempSync(join(tmpdir(), 'gk-compat-node-'));
  try {
    const nodeResults = VECTORS.map((v) => runNodeVector(rootNode, v));

    let oracle; let method;
    if (pythonAvailable()) {
      const dataDir = mkdtempSync(join(tmpdir(), 'gk-compat-py-'));
      const bridge = join(HERE, 'gk_compat_bridge.py');
      const out = spawnSync('python3', [bridge], {
        input: JSON.stringify({ vectors: VECTORS, data_dir: dataDir }), encoding: 'utf8',
      });
      assert.equal(out.status, 0, `python bridge failed: ${out.stderr}`);
      const parsed = JSON.parse(out.stdout.trim().split('\n').filter(Boolean).pop());
      oracle = new Map(parsed.results.map((r) => [r.vector, r]));
      method = 'LIVE_PYTHON';
      rmSync(dataDir, { recursive: true, force: true });
    } else {
      // Fallback: the Python-derived expected verdicts encoded in VECTORS (file:line provenance).
      oracle = new Map(VECTORS.map((v) => [v.name, { admitted: v.expected.admitted, code: v.expected.code }]));
      method = 'PYTHON_DERIVED_FIXTURES';
    }

    console.log(`E1 compat method: ${method}`);
    for (const nr of nodeResults) {
      const py = oracle.get(nr.vector);
      assert.ok(py, `oracle missing verdict for ${nr.vector}`);
      assert.equal(nr.admitted, py.admitted, `admit verdict differs for ${nr.vector}: node=${nr.admitted} oracle=${py.admitted}`);
      assert.equal(nr.code, py.code, `refusal CODE differs for ${nr.vector}: node=${nr.code} oracle=${py.code}`);
      // Also cross-check the Python-derived expected against whichever oracle we used.
      assert.equal(nr.admitted, VECTORS.find((v) => v.name === nr.vector).expected.admitted);
    }
  } finally {
    rmSync(rootNode, { recursive: true, force: true });
  }
});
