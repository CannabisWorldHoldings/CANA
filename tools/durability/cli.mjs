import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  receiptDirectory,
  sha256Bytes,
  sha256File,
  writeReceipt,
} from '../test-runner/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const BASE_RECEIPT = path.join(ROOT, 'tools', 'durability', 'base-remote-receipt.json');

function command(commandName, args, {
  cwd = ROOT,
  input,
  timeout = 120_000,
  allowFailure = false,
  maxBuffer = 128 * 1024 * 1024,
  env = process.env,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    input,
    timeout,
    encoding: 'utf8',
    maxBuffer,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`${commandName} failed to start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function refusal(message) {
  throw Object.assign(new Error(message), { exitCode: 3 });
}

function stateRoot() {
  const root =
    process.env.CANA_LOCAL_STATE_DIR ??
    path.join(ROOT, '.cana-local', 'durability');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.resolve(root);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, file);
}

function git(args, options = {}) {
  return command('git', args, options).stdout.trim();
}

function identity() {
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    status: git(['status', '--porcelain']),
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) refusal(`unexpected durability argument: ${value}`);
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) refusal(`missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function matchOwned(relative, pattern) {
  if (pattern.endsWith('/**')) return relative.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith('/*.yml')) {
    const directory = pattern.slice(0, -6);
    return path.posix.dirname(relative) === directory && relative.endsWith('.yml');
  }
  return relative === pattern;
}

function prerequisites(source) {
  if (source.status) refusal(`durability operation refuses a dirty source:\n${source.status}`);
  if (command('git', ['merge-base', '--is-ancestor', BASE, source.commit], { allowFailure: true }).status !== 0) {
    refusal(`base commit ${BASE} is not an ancestor of ${source.commit}`);
  }
  const fsck = command('git', ['fsck', '--full', '--no-progress'], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (fsck.status !== 0 || /missing|broken|error/i.test(fsck.stdout + fsck.stderr)) {
    refusal(`git integrity failed:\n${fsck.stdout}${fsck.stderr}`);
  }
  const ownership = readJson(
    path.join(ROOT, 'tools', 'test-runner', 'CODEX_CHANGED_FILE_OWNERSHIP.json'),
  );
  const changed = git(['diff', '--name-only', `${BASE}..${source.commit}`])
    .split('\n')
    .filter(Boolean);
  const prohibited = changed.filter((file) => ownership.global_no_edit.includes(file));
  if (prohibited.length) refusal(`prohibited paths changed:\n${prohibited.join('\n')}`);
  const patterns = [
    ownership.explicit_user_assignment.root_dispatcher,
    ...ownership.owned_create_paths,
    ...ownership.owned_modify_paths,
  ];
  const unowned = changed.filter((file) => !patterns.some((pattern) => matchOwned(file, pattern)));
  if (unowned.length) refusal(`outgoing paths lack lane ownership:\n${unowned.join('\n')}`);
  return { changed, fsck: 'PASS', prohibited: [], unowned: [] };
}

function scanSecrets(text) {
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
    ['openai-token', /\bsk-[A-Za-z0-9_-]{32,255}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g],
  ];
  const findings = [];
  for (const [kind, pattern] of patterns) {
    const count = [...text.matchAll(pattern)].length;
    if (count) findings.push({ kind, count });
  }
  return findings;
}

function largeFiles(commit) {
  return git(['ls-tree', '-r', '-l', commit])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\s+\w+\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/);
      return match && match[2] !== '-' ? { oid: match[1], bytes: Number(match[2]), path: match[3] } : null;
    })
    .filter((entry) => entry && entry.bytes >= 10 * 1024 * 1024)
    .sort((left, right) => right.bytes - left.bytes);
}

function artifactForCurrent(source) {
  return path.join(stateRoot(), 'artifacts', source.commit);
}

function resolveArtifact(source, parsed) {
  const artifact = path.resolve(parsed.artifact ?? artifactForCurrent(source));
  if (!fs.existsSync(path.join(artifact, 'manifest.json'))) {
    refusal(`no built durability artifact for ${source.commit}; run ./cana durability build first`);
  }
  return artifact;
}

function checksums(artifact) {
  const lines = fs.readFileSync(path.join(artifact, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    const file = path.join(artifact, match[2]);
    return {
      file: match[2],
      expected: match[1],
      actual: sha256File(file),
      pass: match[1] === sha256File(file),
    };
  });
}

function tarballFor(artifact) {
  return `${artifact}.tar.gz`;
}

function durabilityStatus() {
  const source = identity();
  const base = readJson(BASE_RECEIPT);
  const uploadStateFile = path.join(stateRoot(), 'upload-state.json');
  const upload = fs.existsSync(uploadStateFile) ? readJson(uploadStateFile) : null;
  const currentRoundTrip =
    upload?.commit === source.commit &&
    upload?.readback?.sha256 === upload?.artifactSha256 &&
    upload?.readback?.verified === true;
  const atVerifiedBase = source.commit === base.commit && base.remote.uploadDownloadHashRoundTripVerified;
  const state = currentRoundTrip || atVerifiedBase ? 'REMOTELY_DURABLE' : 'LOCAL_ONLY_CANDIDATE';
  const ahead = Number(git(['rev-list', '--count', `${BASE}..${source.commit}`]));
  const body = {
    schemaVersion: 1,
    state,
    current: source,
    remotelyDurableFrontier: currentRoundTrip ? source.commit : base.commit,
    baseCorrection: {
      archive: base.archive,
      driveFileId: base.remote.driveFileId,
      historicalReceiptModified: false,
    },
    candidateCommitsBeyondBase: ahead,
    candidateRoundTrip: currentRoundTrip,
  };
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  return body;
}

function buildDurability() {
  const source = identity();
  const preflight = prerequisites(source);
  const historyPatch = git([
    'log',
    '--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n',
    '-p',
    '--binary',
    `${BASE}..${source.commit}`,
  ]);
  const secretFindings = scanSecrets(historyPatch);
  if (secretFindings.length) {
    refusal(`outgoing-history secret scan failed: ${JSON.stringify(secretFindings)}`);
  }
  const artifact = artifactForCurrent(source);
  if (fs.existsSync(artifact)) refusal(`durability artifact already exists: ${artifact}`);
  fs.mkdirSync(artifact, { recursive: true, mode: 0o700 });
  const bundle = path.join(artifact, 'repo.bundle');
  const patch = path.join(artifact, 'outgoing.patch');
  const mailbox = path.join(artifact, 'commits.mbox');
  command('git', ['bundle', 'create', bundle, 'HEAD'], { timeout: 180_000 });
  fs.writeFileSync(
    patch,
    command('git', ['diff', '--binary', BASE, source.commit]).stdout,
    { encoding: 'utf8', mode: 0o600 },
  );
  fs.writeFileSync(
    mailbox,
    command('git', ['format-patch', '--stdout', '--binary', `${BASE}..${source.commit}`]).stdout,
    { encoding: 'utf8', mode: 0o600 },
  );
  const manifest = {
    schemaVersion: 1,
    kind: 'CANA candidate durability artifact',
    createdAt: new Date().toISOString(),
    source,
    baseCommit: BASE,
    baseTree: git(['rev-parse', `${BASE}^{tree}`]),
    preflight,
    secretScan: {
      scope: `all outgoing commit patches ${BASE}..${source.commit}`,
      status: 'PASS',
      findings: [],
      historyPatchSha256: sha256Bytes(historyPatch),
    },
    largeFiles: {
      thresholdBytes: 10 * 1024 * 1024,
      entries: largeFiles(source.commit),
    },
    restoration: {
      bundle: 'repo.bundle',
      binaryPatch: 'outgoing.patch',
      commitMailbox: 'commits.mbox',
    },
    remoteState: 'NOT_UPLOADED',
  };
  writeJson(path.join(artifact, 'manifest.json'), manifest);
  const payloadFiles = ['repo.bundle', 'outgoing.patch', 'commits.mbox', 'manifest.json'];
  const sumBody = payloadFiles
    .map((file) => `${sha256File(path.join(artifact, file))}  ${file}`)
    .join('\n');
  fs.writeFileSync(path.join(artifact, 'SHA256SUMS.txt'), `${sumBody}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const bundleVerify = command('git', ['bundle', 'verify', bundle], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (bundleVerify.status !== 0) {
    refusal(`git bundle verification failed:\n${bundleVerify.stdout}${bundleVerify.stderr}`);
  }
  const tarball = tarballFor(artifact);
  command('tar', ['-czf', tarball, '-C', path.dirname(artifact), path.basename(artifact)], {
    timeout: 180_000,
  });
  const result = {
    artifact,
    tarball,
    tarballBytes: fs.statSync(tarball).size,
    tarballSha256: sha256File(tarball),
    bundleSha256: sha256File(bundle),
    secretScan: 'PASS',
    remoteState: 'NOT_UPLOADED',
  };
  writeJson(path.join(stateRoot(), 'latest-build.json'), { commit: source.commit, ...result });
  const receipt = writeReceipt('durability-build', {
    overall: 'PASS',
    source,
    ...result,
  });
  process.stdout.write(`${JSON.stringify({ ...result, receipt }, null, 2)}\n`);
  return result;
}

function verifyDurability(parsed) {
  const source = identity();
  prerequisites(source);
  const artifact = resolveArtifact(source, parsed);
  const manifest = readJson(path.join(artifact, 'manifest.json'));
  const sumChecks = checksums(artifact);
  if (sumChecks.some((entry) => !entry.pass)) {
    refusal(`durability checksums failed: ${JSON.stringify(sumChecks.filter((entry) => !entry.pass))}`);
  }
  const bundle = path.join(artifact, 'repo.bundle');
  const verifyBundle = command('git', ['bundle', 'verify', bundle], {
    allowFailure: true,
    timeout: 180_000,
  });
  if (verifyBundle.status !== 0) refusal(`bundle verify failed:\n${verifyBundle.stderr}`);
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-durability-verify-'));
  const clone = path.join(runRoot, 'bundle-clone');
  const patchClone = path.join(runRoot, 'patch-clone');
  let focused;
  try {
    command('git', ['clone', '--quiet', bundle, clone], { timeout: 180_000 });
    command('git', ['checkout', '--quiet', manifest.source.commit], { cwd: clone });
    command('git', ['fsck', '--full', '--no-progress'], { cwd: clone, timeout: 180_000 });
    const cloneTree = command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: clone }).stdout.trim();
    if (cloneTree !== manifest.source.tree) {
      refusal(`bundle reconstruction tree mismatch: ${cloneTree}`);
    }
    command('git', ['clone', '--quiet', '--no-checkout', bundle, patchClone], { timeout: 180_000 });
    command('git', ['checkout', '--quiet', manifest.baseCommit], { cwd: patchClone });
    command('git', ['apply', '--index', '--binary', path.join(artifact, 'outgoing.patch')], {
      cwd: patchClone,
      timeout: 180_000,
    });
    const patchTree = command('git', ['write-tree'], { cwd: patchClone }).stdout.trim();
    if (patchTree !== manifest.source.tree) {
      refusal(`binary-patch reconstruction tree mismatch: ${patchTree}`);
    }
    focused = command(path.join(clone, 'cana'), ['verify', 'focused'], {
      cwd: clone,
      allowFailure: true,
      timeout: 15 * 60_000,
      env: {
        ...process.env,
        CANA_RECEIPT_DIR: receiptDirectory(),
      },
    });
    if (focused.status !== 0) {
      refusal(`focused execution in reconstructed clone failed:\n${focused.stdout}${focused.stderr}`);
    }
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const receipt = writeReceipt('durability-verify', {
    overall: 'PASS',
    source,
    artifact,
    checksumCount: sumChecks.length,
    bundle: 'PASS',
    gitFsck: 'PASS',
    bundleReconstructionTree: manifest.source.tree,
    binaryPatchReconstructionTree: manifest.source.tree,
    focusedExecution: {
      status: 'PASS',
      outputSha256: sha256Bytes(focused.stdout + focused.stderr),
      outputTail: (focused.stdout + focused.stderr).slice(-2_000),
    },
  });
  process.stdout.write(`${JSON.stringify({ overall: 'PASS', artifact, receipt }, null, 2)}\n`);
  return receipt.body;
}

function restoreDurability(parsed) {
  const source = identity();
  const artifact = resolveArtifact(source, parsed);
  const manifest = readJson(path.join(artifact, 'manifest.json'));
  const target = path.resolve(
    parsed.target ??
    path.join(os.tmpdir(), `cana-restored-${manifest.source.commit.slice(0, 12)}-${crypto.randomBytes(4).toString('hex')}`),
  );
  if (fs.existsSync(target)) refusal(`restore target already exists; refusing to overwrite: ${target}`);
  const sumChecks = checksums(artifact);
  if (sumChecks.some((entry) => !entry.pass)) refusal('restore refused because artifact checksums failed');
  command('git', ['clone', '--quiet', path.join(artifact, 'repo.bundle'), target], { timeout: 180_000 });
  command('git', ['checkout', '--quiet', manifest.source.commit], { cwd: target });
  command('git', ['fsck', '--full', '--no-progress'], { cwd: target, timeout: 180_000 });
  const restored = {
    commit: command('git', ['rev-parse', 'HEAD'], { cwd: target }).stdout.trim(),
    tree: command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: target }).stdout.trim(),
    status: command('git', ['status', '--porcelain'], { cwd: target }).stdout.trim(),
  };
  if (
    restored.commit !== manifest.source.commit ||
    restored.tree !== manifest.source.tree ||
    restored.status
  ) {
    refusal(`restored identity mismatch: ${JSON.stringify(restored)}`);
  }
  const receipt = writeReceipt('durability-restore', {
    overall: 'PASS',
    artifact,
    target,
    restored,
    overwritten: false,
  });
  process.stdout.write(`${JSON.stringify({ target, restored, receipt }, null, 2)}\n`);
  return receipt.body;
}

function remoteTransport(remote, source, destination, direction) {
  const url = new URL(remote);
  if (url.username || url.password || url.search || url.hash) {
    refusal('remote URL must not contain credentials, query parameters, or fragments');
  }
  if (url.protocol === 's3:') {
    return {
      command: 'aws',
      args: direction === 'upload'
        ? ['s3', 'cp', source, remote]
        : ['s3', 'cp', remote, destination],
      sanitized: `s3://${url.host}${url.pathname}`,
    };
  }
  if (url.protocol === 'ssh:') {
    if (!url.hostname || !url.pathname.startsWith('/')) refusal('ssh remote needs a host and absolute path');
    const endpoint = `${url.hostname}:${url.pathname}`;
    return {
      command: 'scp',
      args: direction === 'upload' ? [source, endpoint] : [endpoint, destination],
      sanitized: `ssh://${url.hostname}${url.pathname}`,
    };
  }
  refusal('supported remote transports are s3:// and ssh:// only');
}

function uploadDurability(parsed) {
  const remote = parsed.remote ?? process.env.CANA_DURABILITY_REMOTE;
  if (process.env.CANA_DURABILITY_OWNER_AUTHORIZED !== 'YES' || !remote) {
    refusal('upload requires explicit owner authorization and remote configuration');
  }
  const source = identity();
  prerequisites(source);
  const artifact = resolveArtifact(source, parsed);
  const tarball = tarballFor(artifact);
  if (!fs.existsSync(tarball)) refusal(`artifact tarball is missing: ${tarball}`);
  const transport = remoteTransport(remote, tarball, null, 'upload');
  command(transport.command, transport.args, { timeout: 30 * 60_000 });
  const state = {
    schemaVersion: 1,
    commit: source.commit,
    tree: source.tree,
    remote: transport.sanitized,
    artifact: tarball,
    artifactSha256: sha256File(tarball),
    uploadedAt: new Date().toISOString(),
    readback: null,
    state: 'UPLOAD_RECORDED_READBACK_PENDING',
  };
  writeJson(path.join(stateRoot(), 'upload-state.json'), state);
  const receipt = writeReceipt('durability-upload', {
    overall: 'PASS',
    ...state,
  });
  process.stdout.write(`${JSON.stringify({ ...state, receipt }, null, 2)}\n`);
  return state;
}

function readbackDurability() {
  const stateFile = path.join(stateRoot(), 'upload-state.json');
  if (!fs.existsSync(stateFile)) refusal('readback requires a recorded upload');
  if (process.env.CANA_DURABILITY_OWNER_AUTHORIZED !== 'YES') {
    refusal('readback requires explicit owner authorization');
  }
  const state = readJson(stateFile);
  const destination = path.join(
    os.tmpdir(),
    `cana-durability-readback-${crypto.randomBytes(8).toString('hex')}.tar.gz`,
  );
  const transport = remoteTransport(state.remote, null, destination, 'readback');
  try {
    command(transport.command, transport.args, { timeout: 30 * 60_000 });
    const downloaded = sha256File(destination);
    if (downloaded !== state.artifactSha256) {
      refusal(`remote readback hash mismatch: expected ${state.artifactSha256}, got ${downloaded}`);
    }
    state.readback = {
      verified: true,
      sha256: downloaded,
      bytes: fs.statSync(destination).size,
      verifiedAt: new Date().toISOString(),
    };
    state.state = 'REMOTELY_DURABLE';
    writeJson(stateFile, state);
  } finally {
    fs.rmSync(destination, { force: true });
  }
  const receipt = writeReceipt('durability-readback', {
    overall: 'PASS',
    ...state,
  });
  process.stdout.write(`${JSON.stringify({ ...state, receipt }, null, 2)}\n`);
  return state;
}

export async function runDurability(action, args = []) {
  const parsed = parseArgs(args);
  if (action === 'status') return durabilityStatus();
  if (action === 'build') return buildDurability();
  if (action === 'verify') return verifyDurability(parsed);
  if (action === 'restore') return restoreDurability(parsed);
  if (action === 'upload') return uploadDurability(parsed);
  if (action === 'readback') return readbackDurability(parsed);
  throw Object.assign(new Error(`unknown durability action: ${action}`), { exitCode: 2 });
}
