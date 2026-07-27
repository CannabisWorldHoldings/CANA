import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function analyze() {
  return spawnSync(process.execPath, [path.join(ROOT, 'cana'), 'evidence-chain', 'analyze'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
    },
  });
}

test('evidence-chain analysis measures current expected and adversarial bytes', () => {
  const result = analyze();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, 'CANA evidence-chain technical limit analysis');
  assert.equal(report.overall, 'PASS');
  assert.equal(report.measurements.currentHandoff.linkCount, 5);
  assert.equal(report.measurements.currentHandoff.jsonUtf8Bytes, 405);
  assert.equal(report.measurements.expectedTenLink.jsonUtf8Bytes, 5_971);
  assert.equal(report.measurements.technicalEnvelope64Link.jsonUtf8Bytes, 58_689);
  assert.equal(report.measurements.adversarialAscii64Link.jsonUtf8Bytes, 134_219_073);
  assert.equal(report.measurements.adversarialEscapedControl64Link.jsonUtf8Bytes, 805_307_713);
});

test('technical ceiling stays below MariaDB TEXT and is not a business policy', () => {
  const result = analyze();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.deepEqual(report.database, {
    providerCandidate: 'MariaDB 11.4',
    columnType: 'TEXT',
    hardBytes: 65_535,
    executedBoundaryProof: true,
    strictOverflow: 'REJECTS',
    nonStrictOverflow: 'TRUNCATES_AND_BREAKS_JSON_AND_DIGEST',
  });
  assert.equal(report.recommendation.technicalStorageCeilingBytes, 60_000);
  assert.equal(report.recommendation.headroomBytes, 5_535);
  assert.equal(report.recommendation.maxLinks, 64);
  assert.equal(report.recommendation.maxStepUtf8Bytes, 128);
  assert.equal(report.recommendation.maxRefUtf8Bytes, 768);
  assert.equal(report.recommendation.overflowBehavior, 'FAIL_CLOSED_BEFORE_DATABASE');
  assert.equal(report.policy.businessApproved, false);
  assert.equal(report.policy.appliedToBusinessLogic, false);
  assert.match(report.policy.boundary, /technical safety/i);
});

test('analysis binds its conclusions to prohibited source without modifying it', () => {
  const result = analyze();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.match(report.source.commit, /^[0-9a-f]{40}$/);
  assert.match(report.source.tree, /^[0-9a-f]{40}$/);
  assert.match(report.bindings.demandCreditsSha256, /^[0-9a-f]{64}$/);
  assert.match(report.bindings.handoffRouteSha256, /^[0-9a-f]{64}$/);
  assert.match(report.bindings.mariaRunnerSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.bindings.prohibitedSourceChanged, false);
  assert.equal(report.consequences.database, 'OVERFLOW_REJECTS_IN_STRICT_MODE_AND_CORRUPTS_IN_NON_STRICT_MODE');
  assert.equal(report.consequences.reporting, 'INLINE_EXPORT_GROWS_WITH_EVERY_STORED_CHAIN');
});
