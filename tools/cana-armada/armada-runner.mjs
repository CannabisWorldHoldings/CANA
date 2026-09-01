#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../../apps/web/src/lib/cana-intelligence/core.mjs';
import { runArmadaTournament } from '../../apps/web/src/lib/cana-intelligence/armada.mjs';
import {
  parseJsonFromAgent,
  resolveArmadaAdapter,
  runCommandAgent,
} from './command-executor.mjs';
import { createDisposableWorktree, removeDisposableWorktree, worktreeDiff } from './worktree-sandbox.mjs';

const [configPath, receiptPathArg] = process.argv.slice(2);
if (!configPath) {
  console.error('usage: armada-runner.mjs armada.config.json [receipt.json]');
  process.exit(2);
}
const absoluteConfig = path.resolve(configPath);
const config = JSON.parse(await fs.readFile(absoluteConfig, 'utf8'));
const repoRoot = path.resolve(path.dirname(absoluteConfig), config.repoRoot ?? '.');
const requestedReceiptPath = receiptPathArg ?? config.receiptPath;
if (!requestedReceiptPath) throw new Error('explicit receipt path required');
const receiptPath = path.resolve(path.dirname(absoluteConfig), requestedReceiptPath);

if (!/^[0-9a-f]{40}$/.test(config.baseSha ?? '')) throw new Error('config.baseSha must be an exact 40-character commit SHA');
if (!Array.isArray(config.agents) || config.agents.length < 2) throw new Error('config.agents must contain >=2 agents');
if (!config.verifier?.adapter) throw new Error('config.verifier.adapter required');
if (!Array.isArray(config.trials) || !config.trials.length) throw new Error('config.trials required');

const forbiddenProcessKeys = ['command', 'args', 'cwd', 'env', 'inheritEnvKeys', 'provider', 'model', 'processIdentityDigest'];
for (const processSpec of [...config.agents, config.verifier]) {
  for (const key of forbiddenProcessKeys) {
    if (Object.hasOwn(processSpec, key)) {
      const error = new Error(`Armada config cannot select ${key}; use a source-registered adapter`);
      error.code = 'ARMADA_ARBITRARY_COMMAND_FORBIDDEN';
      throw error;
    }
  }
}
if (Object.hasOwn(config, 'inheritEnvKeys')) {
  const error = new Error('Armada config cannot select inherited environment');
  error.code = 'ARMADA_ARBITRARY_COMMAND_FORBIDDEN';
  throw error;
}
const receiptRelativeToRepo = path.relative(repoRoot, receiptPath);
if (receiptRelativeToRepo === '' || (!receiptRelativeToRepo.startsWith('..') && !path.isAbsolute(receiptRelativeToRepo))) {
  const error = new Error('Armada receipt must be written outside the source repository');
  error.code = 'ARMADA_SOURCE_WRITE_FORBIDDEN';
  throw error;
}

const agentIds = config.agents.map((agent) => agent.id);
if (agentIds.some((id) => typeof id !== 'string' || !id)) throw new Error('candidate agent ids are required');
if (new Set(agentIds).size !== agentIds.length) throw new Error('candidate agent ids must be distinct');
const candidateAdapters = new Map(config.agents.map((agent) => [
  agent.id,
  resolveArmadaAdapter(agent.adapter, 'candidate'),
]));
const verifierAdapter = resolveArmadaAdapter(config.verifier.adapter, 'verifier');
const agentSignatures = [...candidateAdapters.values()].map((adapter) => adapter.identityDigest);
if (new Set(agentSignatures).size !== agentSignatures.length) throw new Error('candidate process/model identities must be distinct');
if (agentSignatures.includes(verifierAdapter.identityDigest)) throw new Error('verifier process/model identity must differ from every candidate');
const candidateSpecs = new Map(config.agents.map((agent) => [agent.id, agent]));
const tournamentAgents = config.agents.map((agent) => {
  const adapter = candidateAdapters.get(agent.id);
  return Object.freeze({
    id: agent.id,
    provider: adapter.provider,
    model: adapter.model,
  });
});

const worktrees = new Map();
let verifierWorktree = null;
try {
  for (const agent of config.agents) {
    worktrees.set(agent.id, await createDisposableWorktree({
      repoRoot,
      baseSha: config.baseSha,
      label: `armada-${agent.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    }));
  }
  verifierWorktree = await createDisposableWorktree({
    repoRoot,
    baseSha: config.baseSha,
    label: 'armada-independent-verifier',
  });
  const executor = async ({ agent, mission, lane, trial }) => {
    const cwd = worktrees.get(agent.id);
    const processSpec = candidateSpecs.get(agent.id);
    const payload = {
      role: 'CANA_ARMADA_CANDIDATE',
      mission,
      lane,
      trial,
      baseSha: config.baseSha,
      effectAuthority: 'NONE',
      requirements: {
        returnJson: true,
        doNotClaimExecutionWithoutEvidence: true,
        epistemicDiscipline: true,
      },
    };
    const run = await runCommandAgent({
      adapter: candidateAdapters.get(agent.id),
      input: JSON.stringify(payload),
      cwd,
      timeoutMs: processSpec.timeoutMs ?? config.timeoutMs ?? 120_000,
      maxOutputBytes: config.maxOutputBytes ?? 2_000_000,
    });
    const diff = await worktreeDiff({ worktree: cwd });
    return {
      agentResult: parseJsonFromAgent(run),
      processReceipt: run,
      workspaceDiff: diff,
      workspaceDiffDigest: digest(diff, 'workspace_diff'),
    };
  };
  const verifier = async ({ agent, mission, lane, trial, output }) => {
    const payload = {
      role: 'CANA_ARMADA_INDEPENDENT_VERIFIER',
      candidateAgent: {
        id: agent.id,
        provider: agent.provider,
        model: agent.model,
        processIdentityDigest: candidateAdapters.get(agent.id).identityDigest,
      },
      mission,
      lane,
      trial,
      baseSha: config.baseSha,
      effectAuthority: 'NONE',
      candidateOutput: output.agentResult,
      processEvidence: {
        stdoutDigest: output.processReceipt.stdoutDigest,
        stderrDigest: output.processReceipt.stderrDigest,
        exitCode: output.processReceipt.code,
        durationMs: output.processReceipt.durationMs,
        workspaceDiffDigest: output.workspaceDiffDigest,
      },
      scoringContract: {
        scoreRange: [0, 1],
        requiredFields: ['verifierId', 'score', 'verdict', 'reasons'],
        forbidSelfCertification: true,
      },
    };
    const run = await runCommandAgent({
      adapter: verifierAdapter,
      input: JSON.stringify(payload),
      cwd: verifierWorktree,
      timeoutMs: config.verifier.timeoutMs ?? config.timeoutMs ?? 120_000,
      maxOutputBytes: config.maxOutputBytes ?? 2_000_000,
    });
    if (await worktreeDiff({ worktree: verifierWorktree })) {
      const error = new Error('independent verifier attempted workspace mutation');
      error.code = 'ARMADA_VERIFIER_MUTATION_FORBIDDEN';
      throw error;
    }
    const verdict = parseJsonFromAgent(run);
    if (!verdict.verifierId) verdict.verifierId = verifierAdapter.verifierId;
    if (verdict.verifierId !== verifierAdapter.verifierId) {
      const error = new Error('verifier identity does not match source registration');
      error.code = 'ARMADA_VERIFIER_IDENTITY_MISMATCH';
      throw error;
    }
    if (!Number.isFinite(verdict.score) || verdict.score < 0 || verdict.score > 1) throw new Error('verifier score must be in [0,1]');
    return {
      ...verdict,
      verifierProcessDigest: digest({
        stdoutDigest: run.stdoutDigest,
        stderrDigest: run.stderrDigest,
        code: run.code,
        durationMs: run.durationMs,
      }, 'verifier-process'),
    };
  };
  const receipt = await runArmadaTournament({
    mission: config.mission,
    lane: config.lane,
    agents: tournamentAgents,
    executor,
    verifier,
    trials: config.trials,
    baseSha: config.baseSha,
    resolveAgentIdentity: (agent) => {
      const adapter = candidateAdapters.get(agent.id);
      return {
        provider: adapter.provider,
        model: adapter.model,
        identityDigest: adapter.identityDigest,
      };
    },
  });
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    receiptPath,
    winnerAgentId: receipt.winnerAgentId,
    winnerScore: receipt.winnerScore,
    allocationDigest: receipt.allocationDigest,
  }, null, 2));
} finally {
  for (const worktree of worktrees.values()) await removeDisposableWorktree({ repoRoot, worktree });
  if (verifierWorktree) await removeDisposableWorktree({ repoRoot, worktree: verifierWorktree });
}
