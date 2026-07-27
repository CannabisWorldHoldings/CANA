import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the canonical import preparer is an offline callable surface', async () => {
  const module = await import('./prepare.mjs');
  assert.equal(typeof module.prepareGithubImport, 'function');
  assert.equal(module.CANONICAL_REPOSITORY, 'CannabisWorldHoldings/CANA');
  assert.equal(
    module.classifyBranch(module.INTEGRATION_BRANCH, 'a'.repeat(40)),
    'integration-traceability',
  );
});

test('protected main requires every candidate verification lane', () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'github-import', 'protected-main-policy.json')),
  );
  assert.equal(policy.enforce_admins, true);
  for (const context of [
    'candidate-unit',
    'clean-build',
    'focused-verifier',
    'full-verifier',
    'clean-clone-verifier',
    'release-verifier',
    'migration-validation',
    'maria-verifier',
    'cpanel-verifier',
    'durability-proof',
    'secret-scan',
    'github-import-offline',
  ]) {
    assert.ok(policy.required_status_checks.contexts.includes(context), context);
  }
});

test('offline preparation executes no owner-gated command', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-github-prepare-test-'));
  try {
    const reportFile = path.join(scratch, 'report.json');
    const childEnvironment = { ...process.env };
    delete childEnvironment.CANA_RECEIPT_SESSION;
    delete childEnvironment.CANA_RECEIPT_DIR;
    const result = spawnSync(
      path.join(ROOT, 'cana'),
      ['github', 'prepare', '--output', reportFile],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...childEnvironment,
          CANA_GITHUB_IMPORT_STATE_DIR: scratch,
          CANA_RECEIPT_DIR: path.join(scratch, 'receipts'),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.deepEqual(
      {
        accessed: report.canonical.accessed,
        probed: report.canonical.probed,
        mutated: report.canonical.mutated,
      },
      { accessed: false, probed: false, mutated: false },
    );
    assert.ok(
      Object.values(report.commands).every(
        (entry) => entry.executed === false && entry.ownerGated === true,
      ),
    );
    assert.match(
      report.commands.integrationPullRequest.command,
      /CannabisWorldHoldings\/CANA/,
    );
    assert.match(report.rollback.git, /git revert/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('workflow leaves runtime equality unproven until an executed receipt is supplied', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify.yml'),
    'utf8',
  );
  assert.match(workflow, /run: \.\/cana github prepare\s*$/m);
  assert.doesNotMatch(workflow, /github prepare --runtime-sha/);
});
