import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Bytes, sha256File, writeReceipt } from '../test-runner/receipt.mjs';

export const CANONICAL_REPOSITORY = 'CannabisWorldHoldings/CANA';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const AUTHORITATIVE = 'recover/competitive-ui-day-night';
export const INTEGRATION_BRANCH = 'integration/cana-technical-promotion-de4a497b';

function command(commandName, args, {
  cwd = ROOT,
  timeout = 120_000,
  allowFailure = false,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    timeout,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`${commandName} failed to start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function git(args, options = {}) {
  return command('git', args, options).stdout.trim();
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--dry-run' || value === '--validate-only') {
      parsed[value.slice(2)] = true;
      continue;
    }
    if (!value.startsWith('--') || !args[index + 1]) {
      throw Object.assign(new Error(`invalid GitHub preparation argument: ${value}`), { exitCode: 2 });
    }
    parsed[value.slice(2)] = args[index + 1];
    index += 1;
  }
  return parsed;
}

export function classifyBranch(name, commit) {
  if (name === 'main') return 'protected-main';
  if (name === AUTHORITATIVE) return 'authoritative-source';
  if (name === 'codex/cana-bottleneck-clearance') return 'candidate-bottleneck-lane';
  if (name === INTEGRATION_BRANCH) return 'integration-traceability';
  if (name.startsWith('codex/')) return 'candidate-lane';
  if (name.startsWith('recover/')) return 'recovery-evidence';
  return commit === BASE ? 'base-evidence' : 'unclassified-owner-review-required';
}

function branches() {
  return git(['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, commit] = line.split('\t');
      return { name, commit, classification: classifyBranch(name, commit) };
    });
}

function secretScan(text) {
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
    ['openai-token', /\bsk-[A-Za-z0-9_-]{32,255}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g],
  ];
  return patterns
    .map(([kind, pattern]) => ({ kind, count: [...text.matchAll(pattern)].length }))
    .filter((entry) => entry.count > 0);
}

function largeFiles(commit) {
  return git(['ls-tree', '-r', '-l', commit])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\s+\w+\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/);
      return match && match[2] !== '-'
        ? { oid: match[1], bytes: Number(match[2]), path: match[3] }
        : null;
    })
    .filter((entry) => entry && entry.bytes >= 10 * 1024 * 1024)
    .sort((left, right) => right.bytes - left.bytes);
}

function workflowJobs(workflow) {
  const jobs = [];
  let inJobs = false;
  for (const line of workflow.split('\n')) {
    if (line === 'jobs:') {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const match = line.match(/^  ([a-z0-9-]+):$/);
    if (match) jobs.push(match[1]);
  }
  return jobs;
}

function localStateDirectory(commit) {
  const root =
    process.env.CANA_GITHUB_IMPORT_STATE_DIR ??
    path.join(ROOT, '.cana-local', 'github-import');
  const directory = path.join(path.resolve(root), commit);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function runtimeEvidence(parsed) {
  if (parsed['runtime-receipt']) {
    const file = path.resolve(parsed['runtime-receipt']);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      receipt.environment !== 'CPANEL_SIMULATION' ||
      receipt.overall !== 'PASS' ||
      !/^[0-9a-f]{40}$/.test(receipt.source?.commit ?? '')
    ) {
      throw Object.assign(new Error('runtime receipt must be a passing CPANEL_SIMULATION release receipt'), { exitCode: 2 });
    }
    return {
      sha: receipt.source.commit,
      evidence: {
        kind: 'CPANEL_SIMULATION release receipt',
        file,
        sha256: sha256File(file),
      },
    };
  }
  return {
    sha: parsed['runtime-sha'],
    evidence: parsed['runtime-sha']
      ? { kind: 'caller-supplied SHA only', file: null, sha256: null }
      : null,
  };
}

function compareRuntime(sourceSha, runtime) {
  const runtimeSha = runtime.sha;
  if (!runtimeSha) {
    return {
      status: 'UNPROVEN',
      releaseSha: sourceSha,
      cpanelRuntimeSha: null,
      equal: null,
      evidence: null,
      claim: 'No runtime SHA was supplied. No production equality is claimed.',
    };
  }
  if (!/^[0-9a-f]{40}$/.test(runtimeSha)) {
    throw Object.assign(new Error('runtime SHA must be exactly 40 lowercase hexadecimal characters'), { exitCode: 2 });
  }
  return {
    status: runtimeSha === sourceSha ? 'PASS' : 'FAIL',
    releaseSha: sourceSha,
    cpanelRuntimeSha: runtimeSha,
    equal: runtimeSha === sourceSha,
    evidence: runtime.evidence,
    claim: runtime.evidence?.kind === 'CPANEL_SIMULATION release receipt'
      ? 'Comparison is bound to an executed local simulation receipt. It is not evidence of a live cPanel deployment.'
      : 'Comparison uses only a caller-supplied runtime identity. It is not executed runtime evidence or proof of a live cPanel deployment.',
  };
}

export async function prepareGithubImport({ args = [] } = {}) {
  const parsed = parseArgs(args);
  const source = {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    status: git(['status', '--porcelain']),
  };
  if (source.status) {
    throw new Error(`GitHub import preparation refuses a dirty source:\n${source.status}`);
  }
  if (command('git', ['merge-base', '--is-ancestor', BASE, source.commit], { allowFailure: true }).status !== 0) {
    throw new Error(`${BASE} is not an ancestor of ${source.commit}`);
  }

  const history = git(['log', '-p', '--binary', '--format=commit %H', `${BASE}..${source.commit}`]);
  const findings = secretScan(history);
  const policyFile = path.join(ROOT, 'tools', 'github-import', 'protected-main-policy.json');
  const workflowFile = path.join(ROOT, '.github', 'workflows', 'cana-verify.yml');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const workflow = fs.readFileSync(workflowFile, 'utf8');
  const jobs = workflowJobs(workflow);
  const missingContexts = policy.required_status_checks.contexts.filter(
    (context) => !jobs.includes(context),
  );
  const runtimeComparison = compareRuntime(source.commit, runtimeEvidence(parsed));
  const branchClassification = branches();
  const canonicalRemoteUrl = 'git@github.com:CannabisWorldHoldings/CANA.git';
  const commands = {
    canonicalRemoteSetup: `git remote add canonical ${canonicalRemoteUrl}`,
    fetchAfterAuthorization: 'git fetch --prune canonical',
    protectedMainPushDryRun: `git push --dry-run canonical ${source.commit}:refs/heads/main`,
    authoritativePushDryRun: `git push --dry-run canonical ${AUTHORITATIVE}:refs/heads/${AUTHORITATIVE}`,
    candidatePushDryRun: 'git push --dry-run canonical codex/cana-bottleneck-clearance:refs/heads/codex/cana-bottleneck-clearance',
    integrationPushDryRun: `git push --dry-run canonical ${INTEGRATION_BRANCH}:refs/heads/${INTEGRATION_BRANCH}`,
    protectedMainApply: `gh api --method PUT repos/${CANONICAL_REPOSITORY}/branches/main/protection --input tools/github-import/protected-main-policy.json`,
    integrationPullRequest: `gh pr create --repo ${CANONICAL_REPOSITORY} --base main --head codex/cana-bottleneck-clearance --template tools/github-import/PULL_REQUEST_TEMPLATE.md`,
    releaseTag: `git tag -s cana-candidate-${source.commit.slice(0, 12)} ${source.commit}`,
    releasePublish: `gh release create cana-candidate-${source.commit.slice(0, 12)} --repo ${CANONICAL_REPOSITORY} --verify-tag`,
    gitRollback: 'git revert -m 1 <integration-merge-sha>',
    cpanelRollback: 'ln -s releases/<previous-runtime-sha> current.next && mv -Tf current.next current',
  };
  const remotes = git(['remote', '-v'])
    .split('\n')
    .filter(Boolean);
  const overall =
    findings.length === 0 &&
    missingContexts.length === 0 &&
    policy.enforce_admins === true &&
    policy.required_status_checks.strict === true &&
    runtimeComparison.status !== 'FAIL'
      ? 'PASS'
      : 'FAIL';
  const report = {
    schemaVersion: 1,
    kind: 'canonical-github-import-preparation',
    preparedAt: new Date().toISOString(),
    overall,
    source,
    canonical: {
      repository: CANONICAL_REPOSITORY,
      remoteUrl: canonicalRemoteUrl,
      accessed: false,
      probed: false,
      mutated: false,
      ownerGated: true,
    },
    localRemotesObserved: remotes,
    branchClassification,
    outgoingHistory: {
      range: `${BASE}..${source.commit}`,
      secretScan: findings.length === 0 ? 'PASS' : 'FAIL',
      findings,
      scannedPatchSha256: sha256Bytes(history),
    },
    largeFileInventory: {
      thresholdBytes: 10 * 1024 * 1024,
      entries: largeFiles(source.commit),
    },
    protectedMain: {
      policyFile: path.relative(ROOT, policyFile),
      policySha256: sha256File(policyFile),
      strict: policy.required_status_checks.strict,
      enforceAdmins: policy.enforce_admins,
      requiredChecks: policy.required_status_checks.contexts,
      missingWorkflowJobs: missingContexts,
    },
    workflow: {
      file: path.relative(ROOT, workflowFile),
      jobs,
      tokenPermissions: 'contents: read',
      networkMutationSteps: false,
    },
    commands: Object.fromEntries(
      Object.entries(commands).map(([name, value]) => [
        name,
        { command: value, executed: false, ownerGated: true },
      ]),
    ),
    runtimeComparison,
    rollback: {
      git: commands.gitRollback,
      cpanelActivation: commands.cpanelRollback,
      database: 'restore only from a hash-verified backup after owner authorization',
    },
    ownerGatedActions: [
      `access, probe, create, or push ${CANONICAL_REPOSITORY}`,
      'apply main branch protection',
      'open or merge an integration pull request',
      'create or publish a release tag',
      'change a real cPanel runtime',
    ],
  };
  const directory = localStateDirectory(source.commit);
  const reportFile = path.resolve(
    parsed.output ??
    path.join(directory, `github-import-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.json`),
  );
  fs.mkdirSync(path.dirname(reportFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const receipt = writeReceipt('github-import-prepare', {
    overall,
    source,
    report: {
      file: reportFile,
      sha256: sha256File(reportFile),
    },
    canonicalAccessed: false,
    ownerGatedCommandsExecuted: 0,
    runtimeComparison,
  });
  process.stdout.write(`${JSON.stringify({ report: reportFile, reportSha256: sha256File(reportFile), receipt }, null, 2)}\n`);
  if (overall !== 'PASS') process.exitCode = 1;
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareGithubImport({ args: process.argv.slice(2) });
}
