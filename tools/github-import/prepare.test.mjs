import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HISTORICAL_BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const HISTORY_REQUIRED_JOBS = [
  'candidate-unit',
  'maria-verifier',
  'cpanel-verifier',
  'durability-proof',
  'github-import-offline',
];

function transformJob(workflow, job, transform) {
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow job ${job}`);
  const bodyStart = start + marker.length;
  const nextJob = workflow.slice(bodyStart).match(/\n  [a-z0-9-]+:\n/);
  const end = nextJob ? bodyStart + nextJob.index : workflow.length;
  return `${workflow.slice(0, start)}${transform(workflow.slice(start, end))}${workflow.slice(end)}`;
}

test('the canonical import preparer is an offline callable surface', async () => {
  const module = await import('./prepare.mjs');
  assert.equal(typeof module.prepareGithubImport, 'function');
  assert.equal(typeof module.validateWorkflowDefinition, 'function');
  assert.equal(module.CANONICAL_REPOSITORY, 'CannabisWorldHoldings/CANA');
});

test('workflow policy rejects runner context before step execution', async () => {
  const { validateWorkflowDefinition } = await import('./prepare.mjs');
  const invalidWorkflow = `name: Invalid
on:
  pull_request:
permissions:
  contents: read
jobs:
  durability-proof:
    runs-on: ubuntu-latest
    env:
      CANA_RECEIPT_DIR: \${{ runner.temp }}/receipts
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
`;
  const validation = validateWorkflowDefinition(invalidWorkflow, {
    requiredJobs: ['durability-proof'],
  });
  assert.equal(validation.overall, 'FAIL');
  assert.deepEqual(
    validation.preRunnerContextReferences.map(({ job, line }) => ({ job, line })),
    [{ job: 'durability-proof', line: 10 }],
  );
});

test('canonical workflow is structurally valid, complete, read-only, and SHA-pinned', async () => {
  const { validateWorkflowDefinition } = await import('./prepare.mjs');
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify.yml'),
    'utf8',
  );
  const requiredJobs = [
    'candidate-unit',
    'focused-verifier',
    'maria-verifier',
    'cpanel-verifier',
    'durability-proof',
    'github-import-offline',
  ];
  const validation = validateWorkflowDefinition(workflow, {
    requiredJobs,
    historyRequiredJobs: HISTORY_REQUIRED_JOBS,
  });
  assert.equal(validation.overall, 'PASS');
  assert.equal(validation.structurallyValid, true);
  assert.deepEqual(validation.jobs, requiredJobs);
  assert.deepEqual(validation.missingRequiredJobs, []);
  assert.deepEqual(validation.fullHistoryJobs, HISTORY_REQUIRED_JOBS);
  assert.deepEqual(validation.missingFullHistoryJobs, []);
  assert.deepEqual(validation.checkoutRefOverrides, []);
  assert.deepEqual(
    validation.checkoutSteps
      .filter(({ job }) => job === 'focused-verifier')
      .map(({ inputs }) => inputs),
    [{}],
  );
  assert.ok(
    validation.checkoutSteps.every(
      ({ actionRef }) => actionRef === 'd23441a48e516b6c34aea4fa41551a30e30af803',
    ),
  );
  assert.deepEqual(validation.preRunnerContextReferences, []);
  assert.equal(validation.permissionsReadOnly, true);
  assert.deepEqual(validation.topLevelPermissions, { contents: 'read' });
  assert.deepEqual(validation.jobPermissionBlocks, []);
  assert.deepEqual(validation.unpinnedActions, []);
  assert.match(
    workflow,
    /node --test [^\n]*tools\/mission-2\/mission-2\.test\.mjs/,
    'candidate-unit must execute the Mission 2 contract and adversarial courts',
  );
});

test('workflow policy requires complete history for every historical verification job', async () => {
  const { validateWorkflowDefinition } = await import('./prepare.mjs');
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify.yml'),
    'utf8',
  );
  for (const job of HISTORY_REQUIRED_JOBS) {
    const withoutFullHistory = transformJob(workflow, job, (block) => {
      const changed = block.replace(/\n        with:\n          fetch-depth: 0/, '');
      assert.notEqual(changed, block, `missing fetch-depth fixture for ${job}`);
      return changed;
    });
    const validation = validateWorkflowDefinition(withoutFullHistory, {
      historyRequiredJobs: HISTORY_REQUIRED_JOBS,
    });
    assert.equal(validation.overall, 'FAIL', job);
    assert.deepEqual(validation.missingFullHistoryJobs, [job]);
  }
});

test('workflow policy preserves the synthetic pull-request merge checkout', async () => {
  const { validateWorkflowDefinition } = await import('./prepare.mjs');
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify.yml'),
    'utf8',
  );
  const withHeadOverride = transformJob(workflow, 'candidate-unit', (block) =>
    block.replace(
      '          fetch-depth: 0\n',
      '          fetch-depth: 0\n          ref: ${{ github.event.pull_request.head.sha }}\n',
    ),
  );
  const validation = validateWorkflowDefinition(withHeadOverride, {
    historyRequiredJobs: HISTORY_REQUIRED_JOBS,
  });
  assert.equal(validation.overall, 'FAIL');
  assert.deepEqual(validation.checkoutRefOverrides, [
    {
      job: 'candidate-unit',
      line: 22,
      ref: '${{ github.event.pull_request.head.sha }}',
    },
  ]);
});

test('the historical verification base resolves in the complete checkout', () => {
  const result = spawnSync('git', ['cat-file', '-e', `${HISTORICAL_BASE}^{commit}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('protected main requires every candidate verification lane', () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'github-import', 'protected-main-policy.json')),
  );
  assert.equal(policy.enforce_admins, true);
  for (const context of [
    'candidate-unit',
    'focused-verifier',
    'maria-verifier',
    'cpanel-verifier',
    'durability-proof',
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
