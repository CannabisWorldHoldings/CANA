import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixtureRepo(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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

function processSpec(id, adapter, model) {
  return { id, provider: 'fixture', model, adapter };
}

test('process Armada uses source-registered adapters and isolated candidate/verifier worktrees', async () => {
  const { dir, repo, baseSha } = await fixtureRepo('cana-armada-runner-');
  const receipt = path.join(dir, 'receipt.json');
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    mission: 'fixture mission',
    lane: 'architecture',
    repoRoot: repo,
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
  assert.deepEqual(git(repo, ['status', '--porcelain=v1']), '');
  assert.deepEqual(git(repo, ['worktree', 'list', '--porcelain']).match(/worktree /g)?.length, 1);
});

test('runner refuses caller-selected command, args, cwd, environment and inherited secrets', async () => {
  const forbidden = ['command', 'args', 'cwd', 'env', 'inheritEnvKeys'];
  for (const key of forbidden) {
    const { dir, repo, baseSha } = await fixtureRepo(`cana-armada-refuse-${key}-`);
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
            : ['PATH', 'HOME'];
    await fs.writeFile(configPath, JSON.stringify({
      mission: 'fixture mission',
      lane: 'architecture',
      repoRoot: repo,
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

test('runner refuses unknown adapters and candidate identity reuse', async () => {
  const { dir, repo, baseSha } = await fixtureRepo('cana-armada-identity-');
  const base = {
    mission: 'x',
    lane: 'x',
    repoRoot: repo,
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
  const { dir, repo, baseSha } = await fixtureRepo('cana-armada-receipt-');
  const base = {
    mission: 'x',
    lane: 'x',
    repoRoot: repo,
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
