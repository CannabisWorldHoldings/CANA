import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditArtifactExclusions } from './artifact-exclusions.mjs';

const BUILDER = fs.readFileSync(new URL('./build-artifact.mjs', import.meta.url), 'utf8');

test('artifact exclusion audit accepts ordinary release files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'server.js'), 'process.stdout.write("ready")');
  fs.writeFileSync(path.join(root, 'receipt.json'), '{"status":"verified"}');

  assert.deepEqual(auditArtifactExclusions(root), {
    passed: true,
    filesScanned: 2,
    forbiddenFiles: [],
    credentialFindings: [],
  });
});

test('artifact exclusion audit rejects secret files without exposing their values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.production'), 'API_KEY=super-secret-value');

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(result.forbiddenFiles, ['.env.production']);
  assert.deepEqual(result.credentialFindings, []);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});

test('artifact exclusion audit rejects embedded credential patterns', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-artifact-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'config.txt'),
    'DATABASE_URL=postgresql://release-user:not-a-real-password@db.example/app',
  );

  const result = auditArtifactExclusions(root);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.credentialFindings.map(({ pattern }) => pattern).sort(),
    ['credential-bearing database URL'],
  );
});

test('release artifact excludes every legacy ABCA truth bypass', () => {
  const copiedAppScripts = BUILDER.match(/fs\.mkdirSync\(path\.join\(artifactRoot, 'scripts'\)[\s\S]*?for \(const script of \[([\s\S]*?)\]\) \{/);
  assert.ok(copiedAppScripts);
  assert.doesNotMatch(copiedAppScripts[1], /scripts\/(?:etl-abca-retailers|ingest-abca-feed|seed-abca-retailers)\.mjs/);
  assert.match(BUILDER, /no legacy ABCA import bypass shipped/);
});
