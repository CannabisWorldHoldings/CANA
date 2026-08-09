import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Bytes, sha256File, writeReceipt } from './receipt.mjs';
import {
  startDisposablePostgres,
  stopDisposablePostgres,
} from '../postgres-sim/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKERFILE = path.join(ROOT, 'tools', 'test-runner', 'Dockerfile');
const APPROVED_BASE_IMAGE =
  'node@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';
const STANDARD_PROFILES = new Set(['focused', 'full', 'clean-clone', 'release']);
const TIMEOUTS = {
  focused: 12 * 60_000,
  full: 20 * 60_000,
  'clean-clone': 14 * 60_000,
  release: 12 * 60_000,
};

function command(command, args, {
  cwd = ROOT,
  env = process.env,
  timeout = 60_000,
  allowFailure = false,
  input,
  encoding = 'utf8',
  maxBuffer = 32 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    timeout,
    input,
    encoding,
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    const error = new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`,
    );
    error.result = result;
    throw error;
  }
  return result;
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

function requireClean(source) {
  if (source.status !== '') {
    throw new Error(
      `verification refuses a dirty working tree; commit or isolate changes first:\n${source.status}`,
    );
  }
}

function ensureDocker() {
  if (process.env.CANA_VERIFY_IMAGE) {
    throw new Error('CANA_VERIFY_IMAGE overrides are refused; use the repository verifier image');
  }
  command('docker', ['info'], { timeout: 30_000 });
  const dockerfileSha256 = sha256File(DOCKERFILE);
  const tag = `cana-node-verifier:${dockerfileSha256.slice(0, 16)}`;
  const existing = command('docker', ['image', 'inspect', tag], {
    allowFailure: true,
    timeout: 30_000,
  });
  if (existing.status !== 0) {
    command(
      'docker',
      ['build', '--tag', tag, '--file', DOCKERFILE, ROOT],
      { timeout: 8 * 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
  }
  return {
    tag,
    imageId: command('docker', ['image', 'inspect', tag, '--format', '{{.Id}}']).stdout.trim(),
    dockerfileSha256,
    base: APPROVED_BASE_IMAGE,
  };
}

function addWorktree(runRoot, commit) {
  const worktree = path.join(runRoot, 'worktree');
  command('git', ['worktree', 'add', '--detach', worktree, commit]);
  return worktree;
}

function removeWorktree(worktree) {
  const result = command(
    'git',
    ['worktree', 'remove', '--force', worktree],
    { allowFailure: true },
  );
  return {
    removed: result.status === 0 && !fs.existsSync(worktree),
    detail: (result.stderr || result.stdout).trim(),
  };
}

function sabotageRestore(worktree, commit) {
  const relative = 'apps/web/src/lib/release-identity.mjs';
  const file = path.join(worktree, relative);
  const before = sha256File(file);
  fs.appendFileSync(file, '\n// CANA verification-only sabotage probe\n');
  const sabotaged = sha256File(file);
  const canonical = command(
    'git',
    ['cat-file', 'blob', `${commit}:${relative}`],
    { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 },
  ).stdout;
  fs.writeFileSync(file, canonical);
  const restored = sha256File(file);
  const status = command('git', ['status', '--porcelain'], { cwd: worktree }).stdout.trim();
  return {
    file: relative,
    before,
    sabotaged,
    restored,
    mutationDetected: sabotaged !== before,
    restorationExact: restored === before && status === '',
  };
}

function bundleWorktree(worktree, destination) {
  command(
    'git',
    ['bundle', 'create', destination, 'HEAD'],
    { cwd: worktree, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
}

function cleanClone(runRoot, expected) {
  const bundle = path.join(runRoot, 'source.bundle');
  command('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: ROOT, timeout: 120_000 });
  const clone = path.join(runRoot, 'clean-clone');
  command('git', ['clone', '--quiet', '--no-checkout', bundle, clone], { timeout: 120_000 });
  command('git', ['checkout', '--quiet', expected], { cwd: clone });
  command('git', ['fsck', '--full', '--no-progress'], { cwd: clone, timeout: 120_000 });
  const cloneCommit = command('git', ['rev-parse', 'HEAD'], { cwd: clone }).stdout.trim();
  const cloneTree = command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: clone }).stdout.trim();
  return {
    clone,
    bundle,
    bundleSha256: sha256File(bundle),
    commit: cloneCommit,
    tree: cloneTree,
  };
}

function runContainer({ profile, sourceBundle, expected, verifierImage }) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const name = `cana-verify-${profile.replaceAll('-', '')}-${suffix}`;
  let created = false;
  let database = null;
  let output = '';
  let result;
  try {
    database = startDisposablePostgres({ label: profile });
    command('docker', [
      'create',
      '--name',
      name,
      '--network',
      `container:${database.name}`,
      '--env',
      `DATABASE_URL=${database.databaseUrl}`,
      '--env',
      `DIRECT_URL=${database.databaseUrl}`,
      '-w',
      '/workspace',
      verifierImage.tag,
      'bash',
      '-lc',
      `git clone --quiet /source.bundle /workspace && cd /workspace && git checkout --quiet ${expected} && bash tools/test-runner/container-verify.sh ${profile} ${expected}`,
    ]);
    created = true;
    command('docker', ['cp', sourceBundle, `${name}:/source.bundle`], { timeout: 120_000 });
    result = command('docker', ['start', '-a', name], {
      allowFailure: true,
      timeout: TIMEOUTS[profile],
      maxBuffer: 64 * 1024 * 1024,
    });
    output = `${result.stdout}${result.stderr}`;
  } finally {
    if (created) {
      const logs = command('docker', ['logs', name], {
        allowFailure: true,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (!output) output = `${logs.stdout}${logs.stderr}`;
      command('docker', ['rm', '-f', name], { allowFailure: true, timeout: 30_000 });
    }
    if (database && !stopDisposablePostgres(database)) {
      output += `\nCANA_POSTGRES_CLEANUP_FAILED ${database.name}\n`;
      if (result?.status === 0) result.status = 72;
    }
  }
  const remains = command(
    'docker',
    ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'],
    { timeout: 30_000 },
  ).stdout.trim();
  return {
    name,
    exitCode: result?.status ?? null,
    passed: result?.status === 0,
    cleanup: remains === '',
    database: database
      ? {
          imageId: database.image.imageId,
          dockerfileSha256: database.image.dockerfileSha256,
          baseImage: database.image.base,
          loopbackOnly: true,
          pooledAndDirectSameDisposableInstance: true,
          cleanup: command(
            'docker',
            ['container', 'inspect', database.name],
            { allowFailure: true, timeout: 30_000 },
          ).status !== 0,
        }
      : null,
    output,
    outputSha256: sha256Bytes(output),
  };
}

function tail(value, limit = 12_000) {
  return value.length <= limit ? value : value.slice(-limit);
}

async function standardVerification(profile) {
  const startedAt = new Date().toISOString();
  const source = identity();
  requireClean(source);
  const verifierImage = ensureDocker();
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cana-${profile}-`));
  const worktree = addWorktree(runRoot, source.commit);
  let worktreeCleanup = { removed: false, detail: 'not attempted' };
  let container = null;
  let reconstruction = null;
  let sabotage = null;
  let receiptPayload;
  try {
    sabotage = sabotageRestore(worktree, source.commit);
    if (!sabotage.mutationDetected || !sabotage.restorationExact) {
      throw new Error(`sabotage restoration failed: ${JSON.stringify(sabotage)}`);
    }
    let archiveSource = worktree;
    if (profile === 'clean-clone') {
      reconstruction = cleanClone(runRoot, source.commit);
      if (reconstruction.commit !== source.commit || reconstruction.tree !== source.tree) {
        throw new Error(`clean clone identity mismatch: ${JSON.stringify(reconstruction)}`);
      }
      archiveSource = reconstruction.clone;
    }
    const sourceBundle = path.join(runRoot, 'container-source.bundle');
    bundleWorktree(archiveSource, sourceBundle);
    container = runContainer({
      profile,
      sourceBundle,
      expected: source.commit,
      verifierImage,
    });
    if (!container.cleanup) {
      throw new Error(`verification container ${container.name} was not removed`);
    }
    receiptPayload = {
      overall: container.passed ? 'PASS' : 'FAIL',
      startedAt,
      source,
      isolation: {
        worktree: true,
        database: 'container-local disposable PostgreSQL with PostGIS and H3',
        port: 'container network namespace only; host port is not published',
        dockerImage: verifierImage.imageId,
        dockerfileSha256: verifierImage.dockerfileSha256,
        baseImage: verifierImage.base,
      },
      timeLimitMs: TIMEOUTS[profile],
      staleBuild: {
        required: true,
        evidenceInOutput: container.output.includes('CANA_STALE_BUILD_CHECK_PASS'),
      },
      buildDiagnostics: {
        required: true,
        evidenceInOutput: container.output.includes('CANA_BUILD_DIAGNOSTICS_PASS warnings=0'),
        policy: [
          'NEXT_COMPILED_WITH_WARNINGS',
          'NEXT_ATTEMPTED_IMPORT_ERROR',
          'NEXT_MODULE_NOT_FOUND',
        ],
      },
      serverIdentity: {
        expectedCommit: source.commit,
        evidenceInOutput: container.output.includes(`"gitSha":"${source.commit}"`),
      },
      hangingHandles: {
        containerExited: container.exitCode !== null,
        ownedServerCleanup: container.output.includes('CANA_CLEANUP_PASS'),
      },
      sabotageRestoration: sabotage,
      reconstruction,
      container: {
        exitCode: container.exitCode,
        cleanup: container.cleanup,
        outputSha256: container.outputSha256,
        outputTail: tail(container.output),
        database: container.database,
      },
    };
  } finally {
    worktreeCleanup = removeWorktree(worktree);
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  if (!worktreeCleanup.removed) {
    throw new Error(`isolated worktree cleanup failed: ${worktreeCleanup.detail}`);
  }
  const receipt = writeReceipt(`verify-${profile}`, {
    ...receiptPayload,
    finishedAt: new Date().toISOString(),
    worktree: {
      cleanup: true,
      detail: worktreeCleanup.detail,
    },
  });
  console.log(`receipt: ${receipt.file}`);
  console.log(`receipt sha256: ${receipt.sha256}`);
  if (!container?.passed) {
    process.stderr.write(tail(container?.output ?? 'container did not run'));
    process.exitCode = 1;
    return receipt.body;
  }
  console.log(`PASS verify ${profile} at ${source.commit}`);
  return receipt.body;
}

export async function runVerification(profile) {
  if (STANDARD_PROFILES.has(profile)) {
    return standardVerification(profile);
  }
  if (profile === 'maria') {
    const { runMariaSimulation } = await import('../mariadb-sim/run.mjs');
    return runMariaSimulation({ repoRoot: ROOT });
  }
  if (profile === 'cpanel') {
    const { runCpanelSimulation } = await import('../cpanel-sim/run.mjs');
    return runCpanelSimulation({ repoRoot: ROOT });
  }
  throw Object.assign(new Error(`unknown verification profile: ${profile}`), { exitCode: 2 });
}
