import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  LEDGER,
  MANIFEST,
  ROOT,
  SUPERSESSION,
  assertCredentialFree,
  assertExactAssessmentDrift,
  changedPathsSinceAssessment,
  parseMarkdownDispositions,
  readLedger,
  readManifest,
  validateCourtCustody,
  validateExternalReceipts,
  validateGithubCustody,
  validateLedger,
  validateManifest,
  validateProofAllowlist,
} from './post-class-d-ledger.court.mjs';

const exactSet = (actual, expected, message) => {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort(), message);
};

test('reviewed court custody, ancestry, inventory, typed proofs, and source drift are bound', () => {
  const manifest = readManifest();
  validateManifest(manifest);
  assertExactAssessmentDrift(manifest);
});

test('normal evidence receipts do not invalidate tracked-source custody', () => {
  const manifest = readManifest();
  const artifact = path.join(ROOT, '.omo/evidence/post-class-d-ledger-order-independence.tmp');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, 'non-source verification artifact\n');
  try {
    assert.equal(changedPathsSinceAssessment(manifest).has('.omo/evidence/post-class-d-ledger-order-independence.tmp'), false);
    assertExactAssessmentDrift(manifest);
  } finally {
    fs.rmSync(artifact, { force: true });
  }
});

test('GitHub custody and exact-head external verification receipts are validated when present', () => {
  const manifest = readManifest();
  const custody = validateGithubCustody(manifest);
  assert.equal(['PENDING_GITHUB_VERIFIED_COMMIT', 'GITHUB_CUSTODY_RECEIPT_PRESENT'].includes(custody.state), true);
  if (custody.state === 'GITHUB_CUSTODY_RECEIPT_PRESENT') {
    assert.equal(['SIGNATURE_VERIFIED', 'EXTERNAL_SIGNATURE_REQUIRED'].includes(custody.signature), true);
  }
  const receipts = validateExternalReceipts(manifest);
  assert.equal(Number.isInteger(receipts.exactReceipts) && receipts.exactReceipts >= 0, true);
  assert.equal(['NOT_PRESENT', 'PASS'].includes(receipts.durabilitySecretScan), true);
  if (receipts.exactReceipts > 0) assert.equal(receipts.artifactVerification, 'PASS');
});

test('every required mechanism has one manifest-bound disposition, proof set, and inclusion state', () => {
  const manifest = readManifest();
  validateManifest(manifest);
  validateLedger(readLedger(), manifest);
});

test('human ledger is a structural mirror and claim-bearing artifacts are credential-free', () => {
  const manifest = readManifest();
  const entries = readLedger();
  validateLedger(entries, manifest);
  const markdown = fs.readFileSync(SUPERSESSION, 'utf8');
  const rows = parseMarkdownDispositions(markdown);
  exactSet(rows.keys(), entries.map((entry) => entry.capability_id), 'Markdown capability set drift');
  for (const entry of entries) assert.equal(rows.get(entry.capability_id), entry.disposition, entry.capability_id);
  assertCredentialFree(fs.readFileSync(LEDGER, 'utf8'), 'JSONL ledger');
  assertCredentialFree(fs.readFileSync(MANIFEST, 'utf8'), 'required manifest');
  assertCredentialFree(markdown, 'supersession ledger');
});

test('laundering, omissions, evidence drift, credentials, inclusion drift, and custody drift fail closed', () => {
  const manifest = readManifest();
  const entries = readLedger();

  assert.throws(() => validateLedger(entries.slice(0, -1), manifest), /row count/);

  const laundering = structuredClone(entries);
  laundering.find((entry) => entry.capability_id === 'rsi_cross_repository_evaluation').disposition = 'CANONICAL';
  assert.throws(() => validateLedger(laundering, manifest), /rsi_cross_repository_evaluation/);

  const evidenceDrift = structuredClone(entries);
  evidenceDrift[0].evidence = ['bogus.missing-proof'];
  assert.throws(() => validateLedger(evidenceDrift, manifest), /owner_cana_console_surface/);

  const proofPathDrift = structuredClone(manifest);
  proofPathDrift.proofs['git.owner_console'].path = 'README.md';
  assert.throws(() => validateProofAllowlist(proofPathDrift), /git\.owner_console\.path semantic drift/);

  const inclusionDrift = structuredClone(entries);
  inclusionDrift.find((entry) => entry.capability_id === 'orderweeddcrsi_evidence_envelope').inclusion.product_import = 'VERIFIED_INCLUDED';
  assert.throws(() => validateLedger(inclusionDrift, manifest), /orderweeddcrsi_evidence_envelope/);

  const credential = `${fs.readFileSync(LEDGER, 'utf8')}\napi_token=FAKE_SECRET`;
  assert.throws(() => assertCredentialFree(credential, 'mutation'), /credential-shaped/);

  const missingInventory = structuredClone(manifest);
  missingInventory.inventory_sources[0].capability_ids.pop();
  assert.throws(() => validateManifest(missingInventory), /inventory reconciliation drift|Ledger-Manifest-SHA256/);

  const authorityWidening = structuredClone(manifest);
  const external = authorityWidening.proofs['external.search_console_access'];
  external.authority = 'PROVIDER_EXECUTOR';
  external.may_execute = true;
  assert.throws(() => validateManifest(authorityWidening), /Ledger-Manifest-SHA256|external.search_console_access/);

  const courtDrift = structuredClone(manifest);
  courtDrift.court_admission.paths['tools/promotion-gate/post-class-d-ledger.court.test.mjs'] = '0'.repeat(64);
  assert.throws(() => validateCourtCustody(courtDrift));

  const inclusionEvidence = structuredClone(manifest);
  inclusionEvidence.independent_inclusion_evidence.pop();
  assert.throws(() => validateManifest(inclusionEvidence), /inclusion evidence drift|Ledger-Manifest-SHA256/);
});

test('forged exact-head receipt metadata cannot substitute for a reproduced durability artifact', () => {
  const manifest = readManifest();
  const evidenceRoot = path.join(ROOT, manifest.verification_receipt_policy.evidence_root);
  const fake = path.join(evidenceRoot, 'post-class-d-forged-exact-head-durability.json');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['show', '-s', '--format=%T', head], { cwd: ROOT, encoding: 'utf8' }).trim();
  fs.writeFileSync(fake, `${JSON.stringify({
    overall: 'PASS',
    source: {
      commit: head,
      tree,
      status: '',
    },
    secretScan: 'PASS',
    kind: 'durability-build',
  })}\n`);
  try {
    assert.throws(() => validateExternalReceipts(manifest), /verification receipt set drift|duplicate exact-head verification receipt kind/);
  } finally {
    fs.rmSync(fake, { force: true });
  }
});
