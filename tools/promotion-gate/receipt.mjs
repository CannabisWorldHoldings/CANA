import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Bytes, sha256File } from '../test-runner/receipt.mjs';
import { analyzeEvidenceChain } from './evidence-chain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROTECTED_BRANCH = 'recover/competitive-ui-day-night';
const PROTECTED_COMMIT = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const PROTECTED_TREE = 'f7c56f6dad3875ccba10dfadbd2d953baf5c1509';
const CANDIDATE_BRANCH = 'codex/cana-bottleneck-clearance';
const CANDIDATE_COMMIT = 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318';
const CANDIDATE_TREE = '432cf8117f24a7401b29df4c403181dae8e7ec32';
const INTEGRATION_BRANCH = 'integration/cana-technical-promotion-de4a497b';
const INTEGRATION_MERGE = 'd84486b32fd424d196bc8b535d13396245875042';
const REQUIRED_RECEIPTS = [
  'verify-focused',
  'verify-full',
  'verify-clean-clone',
  'verify-release',
  'verify-maria',
  'verify-cpanel',
  'durability-build',
  'durability-verify',
  'durability-restore',
  'github-import-prepare',
];
const REQUIRED_VERIFIERS = [
  'mariadb',
  'deterministic-verifier',
  'durability',
  'cpanel',
  'release-identity',
  'security',
];
const TRACKED_STATE = [
  'docs/technical-promotion/TECHNICAL_PROMOTION_STATE.md',
  'docs/technical-promotion/OWNER_ACTION_PACKET.md',
  'docs/technical-promotion/EVIDENCE_CHAIN_LIMITS.md',
];

function command(commandName, args, { cwd = ROOT, allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function git(args, options) {
  return command('git', args, options).stdout.trim();
}

function sourceIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    status: git(['status', '--porcelain']),
  };
}

function refIdentity(ref) {
  return {
    branch: ref,
    commit: git(['rev-parse', ref]),
    tree: git(['rev-parse', `${ref}^{tree}`]),
  };
}

function isAncestor(ancestor, descendant = 'HEAD') {
  return command('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    allowFailure: true,
  }).status === 0;
}

export function promotionStatus() {
  const source = sourceIdentity();
  const protectedIdentity = refIdentity(PROTECTED_BRANCH);
  const candidate = refIdentity(CANDIDATE_BRANCH);
  const mergeParents = git(['show', '-s', '--format=%P', INTEGRATION_MERGE]).split(' ');
  const history = {
    candidateIsAncestor: isAncestor(CANDIDATE_COMMIT),
    integrationMergeIsAncestor: isAncestor(INTEGRATION_MERGE),
    integrationMergeParents: mergeParents,
    integrationMergeParentsExact:
      mergeParents.length === 2 &&
      mergeParents[0] === PROTECTED_COMMIT &&
      mergeParents[1] === CANDIDATE_COMMIT,
    candidateCommitCount: Number(
      git(['rev-list', '--count', `${PROTECTED_COMMIT}..${CANDIDATE_COMMIT}`]),
    ),
  };
  const boundaries = {
    protectedExact:
      protectedIdentity.commit === PROTECTED_COMMIT && protectedIdentity.tree === PROTECTED_TREE,
    candidateExact: candidate.commit === CANDIDATE_COMMIT && candidate.tree === CANDIDATE_TREE,
    branchExact: source.branch === INTEGRATION_BRANCH,
  };
  return {
    schemaVersion: 1,
    kind: 'CANA technical promotion status',
    branch: source.branch,
    source,
    protected: protectedIdentity,
    candidate,
    integrationMerge: INTEGRATION_MERGE,
    history,
    boundaries,
    ready:
      !source.status &&
      boundaries.protectedExact &&
      boundaries.candidateExact &&
      boundaries.branchExact &&
      history.candidateIsAncestor &&
      history.integrationMergeIsAncestor &&
      history.integrationMergeParentsExact &&
      history.candidateCommitCount === 40,
    externalSystemsModified: false,
  };
}

function assertReady() {
  const status = promotionStatus();
  if (!status.ready) {
    throw new Error(`promotion source is not ready: ${JSON.stringify(status)}`);
  }
  return status;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw Object.assign(new Error(`invalid promotion argument near ${key ?? '<end>'}`), {
        exitCode: 2,
      });
    }
    if (Object.hasOwn(parsed, key.slice(2))) {
      throw Object.assign(new Error(`duplicate promotion argument: ${key}`), { exitCode: 2 });
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function writeJson(file, body) {
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

export function initializePromotionSession(options = {}) {
  const status = assertReady();
  const evidenceRoot = path.resolve(
    options.evidenceRoot ?? path.join(ROOT, '.cana-local', 'promotion-gate'),
  );
  const sessionId = crypto.randomUUID();
  const sessionRoot = path.join(evidenceRoot, status.source.commit, sessionId);
  const receiptDirectory = path.join(sessionRoot, 'receipts');
  fs.mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(sessionRoot, 0o700);
  fs.chmodSync(receiptDirectory, 0o700);
  const sessionFile = path.join(sessionRoot, 'session.json');
  const session = {
    schemaVersion: 1,
    kind: 'cana-final-receipt-session',
    purpose: 'CANA technical promotion',
    sessionId,
    nonce: crypto.randomBytes(32).toString('hex'),
    startedAt: new Date().toISOString(),
    source: status.source,
    protected: status.protected,
    candidate: status.candidate,
    integrationMerge: status.integrationMerge,
    receiptDirectory,
    trustedAttestation: false,
    externalSystemsModified: false,
  };
  writeJson(sessionFile, session);
  return {
    sessionFile,
    receiptDirectory,
    source: status.source,
    environment: {
      CANA_RECEIPT_SESSION: sessionFile,
      CANA_RECEIPT_DIR: receiptDirectory,
    },
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateSession(sessionFile, source) {
  const file = path.resolve(sessionFile);
  const session = readJson(file);
  const receipts = path.resolve(session.receiptDirectory ?? '');
  const fileStat = fs.statSync(file);
  const receiptStat = fs.statSync(receipts);
  if (
    session.schemaVersion !== 1 ||
    session.kind !== 'cana-final-receipt-session' ||
    session.purpose !== 'CANA technical promotion' ||
    !/^[0-9a-f-]{36}$/.test(session.sessionId ?? '') ||
    !/^[0-9a-f]{64}$/.test(session.nonce ?? '') ||
    session.source?.commit !== source.commit ||
    session.source?.tree !== source.tree ||
    session.source?.branch !== source.branch ||
    session.source?.status !== '' ||
    session.protected?.commit !== PROTECTED_COMMIT ||
    session.protected?.tree !== PROTECTED_TREE ||
    session.candidate?.commit !== CANDIDATE_COMMIT ||
    session.candidate?.tree !== CANDIDATE_TREE ||
    session.integrationMerge !== INTEGRATION_MERGE ||
    path.dirname(file) !== path.dirname(receipts) ||
    path.basename(receipts) !== 'receipts' ||
    fileStat.uid !== process.getuid() ||
    receiptStat.uid !== process.getuid() ||
    (fileStat.mode & 0o077) !== 0 ||
    (receiptStat.mode & 0o077) !== 0
  ) {
    throw new Error('invalid or source-mismatched promotion receipt session');
  }
  return { file, body: session, receipts };
}

function allReceipts(directory) {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name))
    .map((file) => ({ file, body: readJson(file) }));
}

function exactReceipts(session, source) {
  const nonceSha256 = sha256Bytes(session.body.nonce);
  const eligible = allReceipts(session.receipts).filter(({ body }) =>
    Date.parse(body.recordedAt) >= Date.parse(session.body.startedAt) &&
    body.receiptSession?.sessionId === session.body.sessionId &&
    body.receiptSession?.nonceSha256 === nonceSha256 &&
    body.receiptSession?.source?.commit === source.commit &&
    body.receiptSession?.source?.tree === source.tree &&
    body.receiptSession?.trustedAttestation === false
  );
  const selected = REQUIRED_RECEIPTS.map((kind) => {
    const matches = eligible.filter(({ body }) => body.kind === kind);
    if (matches.length !== 1) {
      throw new Error(`expected exactly one promotion receipt for ${kind}; found ${matches.length}`);
    }
    const entry = matches[0];
    if (entry.body.overall !== 'PASS') {
      throw new Error(`promotion receipt is not PASS: ${kind}`);
    }
    return {
      kind,
      file: entry.file,
      sha256: sha256File(entry.file),
      body: entry.body,
    };
  });
  for (const entry of selected.slice(0, 4)) {
    if (
      entry.body.source?.commit !== source.commit ||
      entry.body.source?.tree !== source.tree ||
      entry.body.buildDiagnostics?.evidenceInOutput !== true ||
      entry.body.container?.cleanup !== true ||
      entry.body.worktree?.cleanup !== true
    ) {
      throw new Error(`standard verification guarantee missing from ${entry.kind}`);
    }
  }
  const maria = selected.find((entry) => entry.kind === 'verify-maria').body;
  if (
    maria.source?.commit !== source.commit ||
    maria.source?.tree !== source.tree ||
    maria.checks?.length !== 25 ||
    maria.checks.some((check) => check.pass !== true) ||
    Object.values(maria.cleanup ?? {}).some((value) => value !== true)
  ) {
    throw new Error('MariaDB promotion guarantees are incomplete');
  }
  const cpanel = selected.find((entry) => entry.kind === 'verify-cpanel').body;
  if (
    cpanel.source?.commit !== source.commit ||
    cpanel.source?.tree !== source.tree ||
    cpanel.checks?.length !== 26 ||
    cpanel.checks.some((check) => check.pass !== true) ||
    Object.values(cpanel.cleanup ?? {}).some((value) => value !== true)
  ) {
    throw new Error('cPanel promotion guarantees are incomplete');
  }
  const restored = selected.find((entry) => entry.kind === 'durability-restore').body.restored;
  if (restored?.commit !== source.commit || restored?.tree !== source.tree || restored?.status) {
    throw new Error('durability restore does not reproduce the promotion source');
  }
  const github = selected.find((entry) => entry.kind === 'github-import-prepare').body;
  if (
    github.source?.commit !== source.commit ||
    github.source?.tree !== source.tree ||
    github.ownerGatedCommandsExecuted !== 0 ||
    github.canonicalAccessed !== false
  ) {
    throw new Error('GitHub preparation crossed an owner gate or lost source identity');
  }
  return selected;
}

function verifierReports(directory, source) {
  const root = path.resolve(directory);
  return REQUIRED_VERIFIERS.map((surface) => {
    const file = path.join(root, `${surface}.json`);
    const body = readJson(file);
    if (
      body.schemaVersion !== 1 ||
      body.kind !== 'CANA independent technical verifier' ||
      body.surface !== surface ||
      body.verdict !== 'PASS' ||
      body.isolated !== true ||
      body.source?.commit !== source.commit ||
      body.source?.tree !== source.tree ||
      !Array.isArray(body.evidence) ||
      body.evidence.length === 0
    ) {
      throw new Error(`independent verifier report is invalid: ${surface}`);
    }
    return { surface, file, sha256: sha256File(file), body };
  });
}

function trackedState() {
  return TRACKED_STATE.map((relative) => {
    const file = path.join(ROOT, relative);
    if (!fs.statSync(file).isFile()) throw new Error(`tracked promotion state missing: ${relative}`);
    return { file: relative, sha256: sha256File(file) };
  });
}

function changedFiles(commit) {
  return git(['diff', '--name-only', `${PROTECTED_COMMIT}..${commit}`])
    .split('\n')
    .filter(Boolean);
}

function prohibitedChanges(commit) {
  const ownership = readJson(
    path.join(ROOT, 'tools', 'test-runner', 'CODEX_CHANGED_FILE_OWNERSHIP.json'),
  );
  const changed = new Set(changedFiles(commit));
  return ownership.global_no_edit.filter((relative) => changed.has(relative));
}

function rollbackCommands(source) {
  const afterMerge = git(['rev-list', '--reverse', `${INTEGRATION_MERGE}..${source.commit}`])
    .split('\n')
    .filter(Boolean)
    .reverse();
  return [
    ...afterMerge.map((commit) => `git revert --no-edit ${commit}`),
    `git revert --no-edit -m 1 ${INTEGRATION_MERGE}`,
  ];
}

export function finalizePromotionSession(sessionFile, options) {
  const status = assertReady();
  const session = validateSession(sessionFile, status.source);
  const receipts = exactReceipts(session, status.source);
  const verifiers = verifierReports(options.verifierDirectory, status.source);
  const prohibitedChanged = prohibitedChanges(status.source.commit);
  if (prohibitedChanged.length) {
    throw new Error(`prohibited business source changed: ${prohibitedChanged.join(', ')}`);
  }
  const analysis = analyzeEvidenceChain();
  if (
    analysis.overall !== 'PASS' ||
    analysis.source.commit !== status.source.commit ||
    analysis.source.tree !== status.source.tree ||
    analysis.source.workingTreeClean !== true ||
    analysis.policy.businessApproved !== false ||
    analysis.policy.appliedToBusinessLogic !== false
  ) {
    throw new Error('evidence-chain decision is not bound to the clean promotion source');
  }
  const durableState = trackedState();
  const outputRoot = path.resolve(
    options.outputDirectory ??
    path.join(ROOT, '.cana-local', 'promotion-gate', status.source.commit),
  );
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputRoot, 0o700);
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const output = path.join(outputRoot, `promotion-receipt-${stamp}.json`);
  const body = {
    schemaVersion: 1,
    kind: 'CANA integrated technical promotion receipt',
    recordedAt: new Date().toISOString(),
    overall: 'PASS',
    source: status.source,
    protected: status.protected,
    candidate: status.candidate,
    history: status.history,
    integrationMerge: INTEGRATION_MERGE,
    candidateRange: git([
      'log',
      '--reverse',
      '--format=%H%x09%s',
      `${PROTECTED_COMMIT}..${CANDIDATE_COMMIT}`,
    ]).split('\n').map((line) => {
      const [commit, subject] = line.split('\t');
      return { commit, subject };
    }),
    acceptedChanges: [
      'Complete 40-commit technical candidate history',
      'History-preserving integration merge',
      'Evidence-chain technical limit analysis without business-policy application',
      'Normalized promotion evidence and owner-action automation',
    ],
    rejectedChanges: [
      'Recovery replay',
      'Prohibited business or brand semantics',
      'External deployment, push, provisioning, credentials, or owner approval inference',
    ],
    prohibitedChanged,
    evidenceChain: analysis,
    trackedState: durableState,
    receipts: receipts.map(({ body: ignored, ...entry }) => entry),
    independentVerifiers: verifiers.map(({ body, ...entry }) => ({
      ...entry,
      verdict: body.verdict,
      evidence: body.evidence,
    })),
    locallyProven: [
      'Deterministic clean build and release identity',
      'MariaDB 11.4-compatible migration and evidence round trips',
      'Durability bundle and binary-patch reconstruction',
      'cPanel activation, backup, restore, rollback, and reactivation',
      'Source-history secret scan and owner-gated remote refusal',
    ],
    hostedEnvironment: {
      MariaDB: 'UNPROVEN',
      cPanel: 'UNPROVEN',
      GitHub: 'UNPROVEN',
      remoteDurability: 'UNPROVEN',
    },
    rollback: {
      commands: rollbackCommands(status.source),
      expectedProtectedCommit: PROTECTED_COMMIT,
      expectedProtectedTree: PROTECTED_TREE,
      productionRollbackRequired: false,
    },
    ownerGatedActions: readJson(
      path.join(ROOT, 'tools', 'test-runner', 'CODEX_CHANGED_FILE_OWNERSHIP.json'),
    ).owner_gated_actions,
    externalSystemsModified: false,
    remoteDurability: false,
  };
  writeJson(output, body);
  return { receipt: output, receiptSha256: sha256File(output), body };
}

export async function runPromotion(action, args = []) {
  const parsed = parseArgs(args);
  if (action === 'status') {
    process.stdout.write(`${JSON.stringify(promotionStatus(), null, 2)}\n`);
    return;
  }
  if (action === 'init') {
    const result = initializePromotionSession({ evidenceRoot: parsed['evidence-dir'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (action === 'finalize') {
    if (!parsed.session || !parsed['verifier-dir']) {
      throw Object.assign(
        new Error('promotion finalize requires --session and --verifier-dir'),
        { exitCode: 2 },
      );
    }
    const result = finalizePromotionSession(parsed.session, {
      verifierDirectory: parsed['verifier-dir'],
      outputDirectory: parsed['output-dir'],
    });
    process.stdout.write(`${JSON.stringify({
      receipt: result.receipt,
      receiptSha256: result.receiptSha256,
    }, null, 2)}\n`);
    return;
  }
  throw Object.assign(new Error(`unknown promotion action: ${action}`), { exitCode: 2 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runPromotion(process.argv[2], process.argv.slice(3));
}
