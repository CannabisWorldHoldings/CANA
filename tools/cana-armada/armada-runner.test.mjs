import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveArmadaAdapter } from './command-executor.mjs';
import { createDisposableWorktree, removeDisposableWorktree } from './worktree-sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const canonicalRepo = path.resolve(here, '../..');
const fixtureRoots = new Set();

after(async () => {
  await Promise.all([...fixtureRoots].map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixtureRepo(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  fixtureRoots.add(dir);
  const repo = path.join(dir, 'repo');
  await fs.mkdir(repo);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(repo, 'README'), 'x');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  return { dir, repo, baseSha: git(repo, ['rev-parse', 'HEAD']) };
}

async function fixtureDirectory(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  fixtureRoots.add(dir);
  return dir;
}

function canonicalFixture() {
  return {
    repo: canonicalRepo,
    baseSha: git(canonicalRepo, ['rev-parse', 'HEAD']),
  };
}

function processSpec(id, adapter) {
  return { id, adapter };
}

test('process Armada uses source-registered adapters and isolated candidate/verifier worktrees', async () => {
  const dir = await fixtureDirectory('cana-armada-runner-');
  const { repo, baseSha } = canonicalFixture();
  const statusBefore = git(repo, ['status', '--porcelain=v1']);
  const worktreeCountBefore = git(repo, ['worktree', 'list', '--porcelain']).match(/worktree /g)?.length;
  const receipt = path.join(dir, 'receipt.json');
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    mission: 'fixture mission',
    lane: 'architecture',
    baseSha,
    receiptPath: receipt,
    agents: [
      processSpec('a', 'fixture-agent-a', 'A'),
      processSpec('b', 'fixture-agent-b', 'B'),
    ],
    verifier: processSpec('v', 'fixture-verifier', 'V'),
    trials: [{ id: 't1', task: 'x' }],
  }, null, 2));

  const run = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), configPath, receipt], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(await fs.readFile(receipt, 'utf8'));
  assert.equal(parsed.winnerAgentId, 'b');
  assert.equal(parsed.baseSha, baseSha);
  assert.equal(parsed.candidateRuns.length, 2);
  const expectedAgents = [
    resolveArmadaAdapter('fixture-agent-a', 'candidate'),
    resolveArmadaAdapter('fixture-agent-b', 'candidate'),
  ];
  const actualIdentities = parsed.consideredAgents.map((agent) => ({
    provider: agent.provider,
    model: agent.model,
    identityDigest: agent.identityDigest,
  })).sort((left, right) => left.model.localeCompare(right.model));
  const expectedIdentities = expectedAgents.map((adapter) => ({
    provider: adapter.provider,
    model: adapter.model,
    identityDigest: adapter.identityDigest,
  })).sort((left, right) => left.model.localeCompare(right.model));
  assert.deepEqual(actualIdentities, expectedIdentities);
  assert.deepEqual(git(repo, ['status', '--porcelain=v1']), statusBefore);
  assert.deepEqual(git(repo, ['worktree', 'list', '--porcelain']).match(/worktree /g)?.length, worktreeCountBefore);
});

test('runner refuses caller-selected command, args, cwd, environment and inherited secrets', async () => {
  const forbidden = [
    'command',
    'args',
    'cwd',
    'env',
    'inheritEnvKeys',
    'provider',
    'model',
    'processIdentityDigest',
  ];
  for (const key of forbidden) {
    const dir = await fixtureDirectory(`cana-armada-refuse-${key}-`);
    const { baseSha } = canonicalFixture();
    const marker = path.join(dir, `marker-${key}`);
    const configPath = path.join(dir, 'config.json');
    const agents = [
      processSpec('a', 'fixture-agent-a', 'A'),
      processSpec('b', 'fixture-agent-b', 'B'),
    ];
    agents[0][key] = key === 'command'
      ? process.execPath
      : key === 'args'
        ? ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'owned')`]
        : key === 'cwd'
          ? dir
          : key === 'env'
            ? { CANA_FAKE_SECRET: 'secret' }
            : key === 'inheritEnvKeys'
              ? ['PATH', 'HOME']
              : 'caller-selected-identity';
    await fs.writeFile(configPath, JSON.stringify({
      mission: 'fixture mission',
      lane: 'architecture',
      baseSha,
      receiptPath: path.join(dir, 'receipt.json'),
      agents,
      verifier: processSpec('v', 'fixture-verifier', 'V'),
      trials: [{ id: 't1', task: 'x' }],
    }));
    const run = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), configPath], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, key);
    assert.match(run.stderr, /source-registered adapter/, key);
    await assert.rejects(fs.access(marker));
  }
});

test('runner refuses unknown adapters, duplicate ids, and source-adapter identity reuse', async () => {
  const dir = await fixtureDirectory('cana-armada-identity-');
  const { baseSha } = canonicalFixture();
  const base = {
    mission: 'x',
    lane: 'x',
    baseSha,
    receiptPath: path.join(dir, 'receipt.json'),
    agents: [
      processSpec('a', 'fixture-agent-a', 'A'),
      processSpec('b', 'fixture-agent-b', 'B'),
    ],
    verifier: processSpec('v', 'fixture-verifier', 'V'),
    trials: [{ id: 't' }],
  };
  const unknownPath = path.join(dir, 'unknown.json');
  await fs.writeFile(unknownPath, JSON.stringify({
    ...base,
    agents: [{ ...base.agents[0], adapter: 'caller-selected-executable' }, base.agents[1]],
  }));
  const unknown = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), unknownPath], { encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /not source-registered/);

  const duplicateIdPath = path.join(dir, 'duplicate-id.json');
  await fs.writeFile(duplicateIdPath, JSON.stringify({
    ...base,
    agents: [base.agents[0], { ...base.agents[1], id: base.agents[0].id }],
  }));
  const duplicateId = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), duplicateIdPath], { encoding: 'utf8' });
  assert.notEqual(duplicateId.status, 0);
  assert.match(duplicateId.stderr, /agent ids must be distinct/);

  const reusedPath = path.join(dir, 'reused.json');
  await fs.writeFile(reusedPath, JSON.stringify({
    ...base,
    agents: [base.agents[0], { ...base.agents[0], id: 'b' }],
  }));
  const reused = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), reusedPath], { encoding: 'utf8' });
  assert.notEqual(reused.status, 0);
  assert.match(reused.stderr, /candidate process\/model identities/);
});

test('runner refuses source-repository and existing receipt targets', async () => {
  const dir = await fixtureDirectory('cana-armada-receipt-');
  const { repo, baseSha } = canonicalFixture();
  const base = {
    mission: 'x',
    lane: 'x',
    baseSha,
    agents: [
      processSpec('a', 'fixture-agent-a', 'A'),
      processSpec('b', 'fixture-agent-b', 'B'),
    ],
    verifier: processSpec('v', 'fixture-verifier', 'V'),
    trials: [{ id: 't' }],
  };
  const insideConfig = path.join(dir, 'inside.json');
  await fs.writeFile(insideConfig, JSON.stringify({ ...base, receiptPath: path.join(repo, 'receipt.json') }));
  const inside = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), insideConfig], { encoding: 'utf8' });
  assert.notEqual(inside.status, 0);
  assert.match(inside.stderr, /outside the source repository/);

  const existingReceipt = path.join(dir, 'existing.json');
  await fs.writeFile(existingReceipt, 'preserve-me');
  const existingConfig = path.join(dir, 'existing-config.json');
  await fs.writeFile(existingConfig, JSON.stringify({ ...base, receiptPath: existingReceipt }));
  const existing = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), existingConfig], { encoding: 'utf8' });
  assert.notEqual(existing.status, 0);
  assert.equal(await fs.readFile(existingReceipt, 'utf8'), 'preserve-me');
});

test('runner rejects an alternate repository before its checkout hook can observe inherited secrets', async () => {
  const { dir, repo, baseSha: alternateBaseSha } = await fixtureRepo('cana-armada-malicious-repo-');
  const marker = path.join(dir, 'hook-marker');
  const hook = path.join(repo, '.git', 'hooks', 'post-checkout');
  await fs.writeFile(hook, `#!/bin/sh\nprintf '%s' "\${CANA_ARMADA_HOOK_SECRET-unset}" > ${JSON.stringify(marker)}\n`);
  await fs.chmod(hook, 0o755);
  const configPath = path.join(dir, 'malicious-config.json');
  await fs.writeFile(configPath, JSON.stringify({
    mission: 'fixture mission',
    lane: 'security',
    repoRoot: repo,
    baseSha: alternateBaseSha,
    receiptPath: path.join(dir, 'receipt.json'),
    agents: [
      processSpec('a', 'fixture-agent-a'),
      processSpec('b', 'fixture-agent-b'),
    ],
    verifier: processSpec('v', 'fixture-verifier'),
    trials: [{ id: 't1', task: 'x' }],
  }));
  const run = spawnSync(process.execPath, [path.join(here, 'armada-runner.mjs'), configPath], {
    encoding: 'utf8',
    env: { ...process.env, CANA_ARMADA_HOOK_SECRET: 'must-not-be-observed' },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /cannot select the source repository/);
  await assert.rejects(fs.access(marker));
});

test('worktree Git custody disables checkout hooks and does not inherit secret environment', async () => {
  const { dir, repo, baseSha } = await fixtureRepo('cana-armada-hook-custody-');
  const marker = path.join(dir, 'hook-marker');
  const hook = path.join(repo, '.git', 'hooks', 'post-checkout');
  await fs.writeFile(hook, `#!/bin/sh\nprintf '%s' "\${CANA_ARMADA_HOOK_SECRET-unset}" > ${JSON.stringify(marker)}\n`);
  await fs.chmod(hook, 0o755);
  const previous = process.env.CANA_ARMADA_HOOK_SECRET;
  process.env.CANA_ARMADA_HOOK_SECRET = 'must-not-be-observed';
  let worktree;
  try {
    worktree = await createDisposableWorktree({ repoRoot: repo, baseSha, label: 'hook-custody' });
    await assert.rejects(fs.access(marker));
  } finally {
    if (worktree) await removeDisposableWorktree({ repoRoot: repo, worktree });
    if (previous === undefined) delete process.env.CANA_ARMADA_HOOK_SECRET;
    else process.env.CANA_ARMADA_HOOK_SECRET = previous;
  }
});
