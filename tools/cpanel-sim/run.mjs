import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { startDisposablePostgres, stopDisposablePostgres } from '../postgres-sim/runtime.mjs';
import { sha256Bytes, sha256File, writeReceipt } from '../test-runner/receipt.mjs';
import { loadCanonicalMigrationManifest } from '../../apps/web/prisma/migration-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = path.join(ROOT, 'tools', 'cpanel-sim', 'templates');
const NAMECHEAP = path.join(ROOT, 'deploy', 'namecheap');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const APPROVED_IMAGE =
  'node@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';
const IMAGE = process.env.CANA_CPANEL_IMAGE ?? APPROVED_IMAGE;
const CANONICAL_MIGRATIONS = loadCanonicalMigrationManifest().migrations;
const NAMECHEAP_SCRIPTS = [
  'app.js',
  'deploy.sh',
  'restart.sh',
  'rollback.sh',
  'migrate.sh',
  'healthcheck.sh',
  'readycheck.sh',
  'smoke-test.sh',
  'restore-backup.sh',
  'worker.mjs',
];

function command(commandName, args, {
  cwd = ROOT,
  env = process.env,
  timeout = 120_000,
  allowFailure = false,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    env,
    timeout,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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

function ensureProofImage() {
  if (IMAGE !== APPROVED_IMAGE) {
    throw new Error(`CANA_CPANEL_IMAGE is not approved; expected immutable ${APPROVED_IMAGE}`);
  }
  command('docker', ['info'], { timeout: 30_000 });
  let inspect = command(
    'docker',
    ['image', 'inspect', IMAGE, '--format', '{{json .RepoDigests}}'],
    { allowFailure: true, timeout: 30_000 },
  );
  if (inspect.status !== 0) {
    command('docker', ['pull', IMAGE], { timeout: 8 * 60_000 });
    inspect = command(
      'docker',
      ['image', 'inspect', IMAGE, '--format', '{{json .RepoDigests}}'],
      { timeout: 30_000 },
    );
  }
  return inspect.stdout.trim();
}

function runRealPrismaProof(source) {
  const imageRepoDigests = ensureProofImage();
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-cpanel-prisma-proof-'));
  const bundle = path.join(runRoot, 'source.bundle');
  const suffix = crypto.randomBytes(6).toString('hex');
  const dependencyContainer = `cana-cpanel-deps-${suffix}`;
  const proofContainer = `cana-cpanel-prisma-${suffix}`;
  const dependencyVolume = `cana-cpanel-deps-${suffix}`;
  const proofNetwork = `cana-cpanel-prisma-${suffix}`;
  const packageFiles = [
    'package.json',
    'package-lock.json',
    'apps/web/package.json',
    'packages/ad-creative/package.json',
    'packages/ai/package.json',
  ];
  let dependencyCreated = false;
  let proofCreated = false;
  let volumeCreated = false;
  let networkCreated = false;
  let postgres = null;
  let postgresContainerId = '';
  let result;
  let output = '';
  let executionNetwork = '';
  try {
    const enginePrefetchSchema = path.join(runRoot, 'engine-prefetch.prisma');
    fs.writeFileSync(
      enginePrefetchSchema,
      `generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x", "rhel-openssl-1.1.x", "debian-openssl-1.1.x"]
}

datasource db {
  provider = "postgresql"
  url      = "postgresql://postgres@127.0.0.1:5432/cana_engine_prefetch"
}

model EnginePrefetch {
  id Int @id
}
`,
      { encoding: 'utf8', mode: 0o600 },
    );
    command('git', ['bundle', 'create', bundle, 'HEAD'], {
      cwd: ROOT,
      timeout: 120_000,
    });
    command('docker', ['volume', 'create', dependencyVolume], { timeout: 30_000 });
    volumeCreated = true;
    command('docker', [
      'create',
      '--name',
      dependencyContainer,
      '-w',
      '/workspace',
      '--mount',
      `type=volume,source=${dependencyVolume},target=/workspace/node_modules`,
      IMAGE,
      'bash',
      '-lc',
      'sleep infinity',
    ]);
    dependencyCreated = true;
    command('docker', ['start', dependencyContainer], { timeout: 30_000 });
    command('docker', [
      'exec',
      dependencyContainer,
      'mkdir',
      '-p',
      '/workspace/apps/web',
      '/workspace/packages/ad-creative',
      '/workspace/packages/ai',
    ]);
    for (const file of packageFiles) {
      command(
        'docker',
        ['cp', path.join(ROOT, file), `${dependencyContainer}:/workspace/${file}`],
        { timeout: 30_000 },
      );
    }
    command(
      'docker',
      [
        'cp',
        enginePrefetchSchema,
        `${dependencyContainer}:/workspace/engine-prefetch.prisma`,
      ],
      { timeout: 30_000 },
    );
    const install = command(
      'docker',
      [
        'exec',
        dependencyContainer,
        'npm',
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { allowFailure: true, timeout: 12 * 60_000 },
    );
    if (install.status !== 0) {
      throw new Error(
        `manifest-only dependency fetch failed:\n${install.stdout}${install.stderr}`,
      );
    }
    const enginePrefetch = command(
      'docker',
      [
        'exec',
        dependencyContainer,
        'npx',
        '--no-install',
        'prisma',
        '-v',
      ],
      { allowFailure: true, timeout: 5 * 60_000 },
    );
    if (
      enginePrefetch.status !== 0 ||
      !/^prisma\s*:\s*6\.19\.3$/m.test(enginePrefetch.stdout)
    ) {
      throw new Error(
        `explicit Prisma 6.19.3 engine prefetch failed:\n${enginePrefetch.stdout}${enginePrefetch.stderr}`,
      );
    }
    const clientEnginePrefetch = command(
      'docker',
      [
        'exec',
        dependencyContainer,
        'npx',
        '--no-install',
        'prisma',
        'generate',
        '--schema',
        '/workspace/engine-prefetch.prisma',
      ],
      { allowFailure: true, timeout: 5 * 60_000 },
    );
    if (
      clientEnginePrefetch.status !== 0 ||
      !/Generated Prisma Client/i.test(clientEnginePrefetch.stdout)
    ) {
      throw new Error(
        `explicit Prisma client-engine prefetch failed:\n${clientEnginePrefetch.stdout}${clientEnginePrefetch.stderr}`,
      );
    }
    command('docker', ['rm', '-f', dependencyContainer], { timeout: 30_000 });
    dependencyCreated = false;
    command('docker', ['network', 'create', '--internal', proofNetwork], { timeout: 30_000 });
    networkCreated = true;
    postgres = startDisposablePostgres({
      label: 'cpanel',
      network: proofNetwork,
      networkAlias: 'postgres',
      sharedNetworkNamespace: true,
    });
    postgresContainerId = command(
      'docker',
      ['inspect', postgres.name, '--format', '{{.Id}}'],
      { timeout: 30_000 },
    ).stdout.trim();
    command('docker', [
      'create',
      '--name',
      proofContainer,
      '--network',
      `container:${postgres.name}`,
      '--env',
      `DATABASE_URL=${postgres.databaseUrl}`,
      '--env',
      `DIRECT_URL=${postgres.databaseUrl}`,
      '--env',
      `CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER=${postgres.systemIdentifier}`,
      '-w',
      '/workspace',
      '--mount',
      `type=volume,source=${dependencyVolume},target=/workspace/node_modules`,
      IMAGE,
      'bash',
      '-lc',
      `git clone --quiet /source.bundle /clone && git -C /clone checkout --quiet ${source.commit} && cp -a /clone/. /workspace/ && cd /workspace && bash tools/cpanel-sim/real-prisma-proof.sh ${source.commit}`,
    ]);
    proofCreated = true;
    executionNetwork = command(
      'docker',
      ['inspect', proofContainer, '--format', '{{.HostConfig.NetworkMode}}'],
      { timeout: 30_000 },
    ).stdout.trim();
    if (executionNetwork !== `container:${postgresContainerId}`) {
      throw new Error(`real Prisma proof network is ${executionNetwork}, expected container:${postgresContainerId}`);
    }
    command('docker', ['cp', bundle, `${proofContainer}:/source.bundle`], {
      timeout: 120_000,
    });
    result = command('docker', ['start', '-a', proofContainer], {
      allowFailure: true,
      timeout: 15 * 60_000,
    });
    output = `${result.stdout}${result.stderr}`;
  } finally {
    if (proofCreated) {
      if (!output) {
        const logs = command('docker', ['logs', proofContainer], {
          allowFailure: true,
          timeout: 30_000,
        });
        output = `${logs.stdout}${logs.stderr}`;
      }
      command('docker', ['rm', '-f', proofContainer], {
        allowFailure: true,
        timeout: 30_000,
      });
    }
    if (dependencyCreated) {
      command('docker', ['rm', '-f', dependencyContainer], {
        allowFailure: true,
        timeout: 30_000,
      });
    }
    if (volumeCreated) {
      command('docker', ['volume', 'rm', dependencyVolume], {
        allowFailure: true,
        timeout: 30_000,
      });
    }
    if (postgres) stopDisposablePostgres(postgres);
    if (networkCreated) {
      command('docker', ['network', 'rm', proofNetwork], {
        allowFailure: true,
        timeout: 30_000,
      });
    }
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const proofRemains = command(
    'docker',
    ['ps', '-a', '--filter', `name=^/${proofContainer}$`, '--format', '{{.Names}}'],
    { timeout: 30_000 },
  ).stdout.trim();
  const dependencyRemains = command(
    'docker',
    ['ps', '-a', '--filter', `name=^/${dependencyContainer}$`, '--format', '{{.Names}}'],
    { timeout: 30_000 },
  ).stdout.trim();
  const volumeRemains = command(
    'docker',
    ['volume', 'inspect', dependencyVolume],
    { allowFailure: true, timeout: 30_000 },
  ).status === 0;
  const networkRemains = command(
    'docker',
    ['network', 'inspect', proofNetwork],
    { allowFailure: true, timeout: 30_000 },
  ).status === 0;
  const marker = output
    .split('\n')
    .find((line) => line.startsWith('CANA_REAL_PRISMA_PROOF '));
  const proof = marker
    ? JSON.parse(marker.slice('CANA_REAL_PRISMA_PROOF '.length))
    : null;
  if (
    result?.status !== 0 ||
    proofRemains ||
    dependencyRemains ||
    volumeRemains ||
    networkRemains ||
    proof?.overall !== 'PASS' ||
    proof?.commit !== source.commit
  ) {
    throw new Error(
      `real Prisma cPanel proof failed: exit=${result?.status ?? 'none'} proof-remains=${proofRemains || 'none'} dependency-remains=${dependencyRemains || 'none'} volume-remains=${volumeRemains} network-remains=${networkRemains}\n${output.slice(-12_000)}`,
    );
  }
  return {
    image: IMAGE,
    imageRepoDigests,
    dependencyFetch: {
      sourceMounted: false,
      lifecycleScriptsEnabled: false,
      prismaEnginePrefetch: '6.19.3',
      prismaClientEnginePrefetched: true,
      packageFiles,
    },
    executionNetwork: 'internal-only-disposable-postgresql',
    outputSha256: sha256Bytes(output),
    outputTail: output.slice(-4_000),
    cleanup: {
      containerRemoved: true,
      dependencyContainerRemoved: true,
      volumeRemoved: true,
      databaseContainerRemoved: true,
      networkRemoved: true,
    },
    proof,
  };
}

function check(checks, name, pass, evidence) {
  const entry = { name, pass: Boolean(pass), evidence: String(evidence) };
  checks.push(entry);
  if (!entry.pass) throw new Error(`${name} failed: ${evidence}`);
}

function releaseIdentity(commit, artifact) {
  return {
    environment: 'CPANEL_SIMULATION',
    claim: 'Local cPanel-like staging simulation only. This is not a live deployment.',
    gitSha: commit,
    shortSha: commit.slice(0, 7),
    artifact,
    bundler: 'webpack',
    createdAt: new Date().toISOString(),
  };
}

function copyNamecheapScripts(target) {
  fs.mkdirSync(target, { recursive: true });
  const hashes = {};
  for (const file of NAMECHEAP_SCRIPTS) {
    const source = path.join(NAMECHEAP, file);
    const destination = path.join(target, file);
    fs.copyFileSync(source, destination);
    if (file.endsWith('.sh')) fs.chmodSync(destination, 0o755);
    hashes[file] = sha256File(source);
  }
  return hashes;
}

function createRelease(root, name, commit) {
  const release = path.join(root, 'releases', name);
  fs.mkdirSync(release, { recursive: true });
  fs.cpSync(TEMPLATES, release, { recursive: true });
  copyNamecheapScripts(path.join(release, 'namecheap-scripts'));
  fs.writeFileSync(
    path.join(release, 'release.json'),
    `${JSON.stringify(releaseIdentity(commit, name), null, 2)}\n`,
  );
  command('git', ['archive', '--format=tar', '--output', path.join(release, 'source.tar'), commit]);
  return release;
}

function createNamecheapArtifact(root, name, commit) {
  const buildRoot = path.join(root, 'namecheap-artifacts', name);
  const release = path.join(buildRoot, name);
  const uploads = path.join(root, 'account-home', 'uploads');
  fs.mkdirSync(release, { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });
  fs.cpSync(TEMPLATES, release, { recursive: true });
  const scriptHashes = copyNamecheapScripts(release);
  fs.copyFileSync(path.join(TEMPLATES, 'passenger-server.cjs'), path.join(release, 'server.js'));
  fs.cpSync(path.join(ROOT, 'apps', 'web', 'prisma'), path.join(release, 'prisma'), {
    recursive: true,
  });
  const identity = releaseIdentity(commit, name);
  fs.writeFileSync(path.join(release, 'release.json'), `${JSON.stringify(identity, null, 2)}\n`);
  fs.writeFileSync(
    path.join(release, 'receipt.json'),
    `${JSON.stringify({
      artifact: name,
      gitSha: commit,
      bundler: 'webpack',
      unresolvedExternalScan: { unresolved: [] },
      isolatedRuntimeTest: { passed: true },
      builtAt: identity.createdAt,
      environment: 'CPANEL_SIMULATION',
    }, null, 2)}\n`,
  );
  const tarName = `${name}.tar.gz`;
  const tarFile = path.join(uploads, tarName);
  command('tar', ['-czf', tarFile, '-C', buildRoot, name]);
  return { tarName, tarFile, tarSha256: sha256File(tarFile), scriptHashes };
}

function makeImmutable(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      makeImmutable(target);
      fs.chmodSync(target, 0o555);
    } else {
      fs.chmodSync(target, entry.name.endsWith('.sh') ? 0o555 : 0o444);
    }
  }
  fs.chmodSync(directory, 0o555);
}

function makeWritable(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      makeWritable(target);
    } else {
      fs.chmodSync(target, 0o644);
    }
  }
  fs.chmodSync(directory, 0o755);
}

function activate(root, releaseName) {
  const next = path.join(root, 'current.next');
  fs.rmSync(next, { force: true });
  fs.symlinkSync(path.join('releases', releaseName), next);
  fs.renameSync(next, path.join(root, 'current'));
  return fs.realpathSync(path.join(root, 'current'));
}

function runtimeEnvironment(root, releaseRoot, portFile) {
  return {
    ...process.env,
    CANA_RELEASE_ROOT: releaseRoot,
    CANA_SHARED_DATA: path.join(root, 'shared', 'data'),
    CANA_SHARED_LOGS: path.join(root, 'shared', 'logs'),
    CANA_EVIDENCE_SPILL: path.join(root, 'shared', 'evidence-spill'),
    CANA_PORT_FILE: portFile,
  };
}

async function startWeb(root, releaseRoot) {
  const portFile = path.join(root, 'shared', 'logs', `port-${crypto.randomBytes(4).toString('hex')}`);
  const logFile = path.join(root, 'shared', 'logs', 'web-process.log');
  const descriptor = fs.openSync(logFile, 'a');
  const child = spawn('sh', [path.join(releaseRoot, 'web-launcher.sh')], {
    cwd: releaseRoot,
    env: runtimeEnvironment(root, releaseRoot, portFile),
    stdio: ['ignore', descriptor, descriptor],
  });
  fs.closeSync(descriptor);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').trim());
      if (Number.isInteger(port) && port > 0) return { child, port, portFile };
    }
    if (child.exitCode !== null) {
      throw new Error(`simulated web launcher exited ${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error('simulated web launcher did not publish its port');
}

async function startPassengerWeb(root, releaseRoot) {
  const portFile = path.join(root, 'shared', 'logs', `passenger-port-${crypto.randomBytes(4).toString('hex')}`);
  const logFile = path.join(root, 'shared', 'logs', 'passenger-process.log');
  const descriptor = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(releaseRoot, 'app.js')], {
    cwd: releaseRoot,
    env: {
      ...runtimeEnvironment(root, releaseRoot, portFile),
      DATABASE_URL: 'postgresql://app@db.example/orderweeddc?sslmode=require&sslaccept=strict',
      DIRECT_URL: 'postgresql://app@db.example/orderweeddc?sslmode=require&sslaccept=strict',
      HOSTNAME: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', descriptor, descriptor],
  });
  fs.closeSync(descriptor);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').trim());
      if (Number.isInteger(port) && port > 0) return { child, port, portFile };
    }
    if (child.exitCode !== null) {
      throw new Error(`existing Passenger launcher exited ${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error('existing Passenger launcher did not publish its port');
}

async function stopWeb(processState) {
  if (!processState?.child || processState.child.exitCode !== null) return true;
  processState.child.kill('SIGTERM');
  const closed = await Promise.race([
    once(processState.child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!closed && processState.child.exitCode === null) {
    processState.child.kill('SIGKILL');
    await once(processState.child, 'exit');
  }
  return processState.child.exitCode !== null;
}

async function probe(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
  };
}

function sqlite(releaseRoot, database, statement, action = 'query') {
  return command(
    process.execPath,
    [path.join(releaseRoot, 'sqlite-tool.mjs'), action, database, statement],
  ).stdout.trim();
}

function stateDirectory(commit) {
  const root =
    process.env.CANA_CPANEL_STATE_DIR ??
    path.join(ROOT, '.cana-local', 'cpanel-sim');
  const directory = path.join(path.resolve(root), commit);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function exerciseExistingNamecheapScripts({
  root,
  directories,
  source,
  checks,
}) {
  const accountHome = path.join(root, 'account-home');
  const appHome = path.join(accountHome, 'apps', 'orderweeddc-staging');
  const oldName = `orderweeddc-${BASE}`;
  const newName = `orderweeddc-${source.commit}`;
  const oldArtifact = createNamecheapArtifact(root, oldName, BASE);
  const newArtifact = createNamecheapArtifact(root, newName, source.commit);
  const database = path.join(directories.data, 'simulation-control.db');
  const baseEnvironment = {
    ...process.env,
    HOME: accountHome,
    OWD_APP_HOME: appHome,
    OWD_UPLOADS: path.join(accountHome, 'uploads'),
    OWD_DATA_DIR: directories.data,
    OWD_BACKUP_DIR: directories.backups,
    OWD_DB_PATH: database,
    OWD_NODE: process.execPath,
    TMPDIR: directories.logs,
  };
  const executed = [];
  let passenger = null;
  try {
    for (const artifact of [oldArtifact, newArtifact]) {
      const deployed = command('sh', [
        path.join(NAMECHEAP, 'deploy.sh'),
        artifact.tarName,
        artifact.tarSha256,
      ], {
        env: baseEnvironment,
      });
      executed.push({
        script: 'deploy.sh',
        artifact: artifact.tarName,
        output: deployed.stdout.trim(),
      });
    }
    const current = path.join(appHome, 'current');
    const previous = path.join(appHome, 'previous');
    const currentReceipt = JSON.parse(fs.readFileSync(path.join(current, 'receipt.json'), 'utf8'));
    const previousReceipt = JSON.parse(fs.readFileSync(path.join(previous, 'receipt.json'), 'utf8'));
    const exactCopies = Object.entries(newArtifact.scriptHashes).every(
      ([file, expected]) => sha256File(path.join(current, file)) === expected,
    );
    check(
      checks,
      'existing deploy script release swap',
      currentReceipt.gitSha === source.commit &&
        previousReceipt.gitSha === BASE &&
        exactCopies &&
        fs.existsSync(path.join(appHome, 'restart.sh')) &&
        fs.existsSync(path.join(appHome, 'rollback.sh')),
      `deploy.sh installed ${source.commit}, preserved ${BASE}, and copied exact existing scripts`,
    );

    passenger = await startPassengerWeb(root, current);
    const baseUrl = `http://127.0.0.1:${passenger.port}`;
    const health = command('sh', [path.join(current, 'healthcheck.sh'), baseUrl], {
      env: baseEnvironment,
    });
    executed.push({ script: 'healthcheck.sh', output: health.stdout.trim() });
    check(
      checks,
      'existing health script',
      /HEALTHY/.test(health.stdout),
      `healthcheck.sh passed against ${baseUrl}`,
    );

    const ready = command('sh', [path.join(current, 'readycheck.sh'), baseUrl], {
      env: { ...baseEnvironment, OWD_EXPECTED_SHA: source.commit },
    });
    executed.push({ script: 'readycheck.sh', output: ready.stdout.trim() });
    check(
      checks,
      'existing readiness script',
      /READY:/.test(ready.stdout) && /running SHA matches expected/.test(ready.stdout),
      'readycheck.sh proved health, render path, release presence, and exact candidate SHA',
    );

    const smoke = command('sh', [path.join(current, 'smoke-test.sh'), baseUrl], {
      cwd: current,
      env: {
        ...baseEnvironment,
        OWD_EXPECTED_SHA: source.commit,
        OWD_ENVIRONMENT: 'staging',
        OWD_RECEIPT_DIR: directories.logs,
      },
    });
    executed.push({ script: 'smoke-test.sh', output: smoke.stdout.trim() });
    const smokeReceiptFile = fs.readdirSync(directories.logs)
      .filter((name) => /^smoke-receipt-.*\.json$/.test(name))
      .sort()
      .at(-1);
    const smokeReceipt = JSON.parse(
      fs.readFileSync(path.join(directories.logs, smokeReceiptFile), 'utf8'),
    );
    check(
      checks,
      'existing smoke script',
      smokeReceipt.environment === 'staging' &&
        smokeReceipt.fail === 0 &&
        smokeReceipt.runningSha === source.commit &&
        /NO claim that production is live/.test(smokeReceipt.claim),
      `smoke-test.sh passed ${smokeReceipt.pass} read-only checks with a staging-only receipt`,
    );

    const restartFile = path.join(current, 'tmp', 'restart.txt');
    fs.utimesSync(restartFile, new Date(0), new Date(0));
    const restart = command('sh', [path.join(appHome, 'restart.sh')], {
      env: baseEnvironment,
    });
    executed.push({ script: 'restart.sh', output: restart.stdout.trim() });
    check(
      checks,
      'existing restart script',
      fs.statSync(restartFile).mtimeMs > 0,
      'restart.sh updated only the simulated Passenger restart signal',
    );

    check(
      checks,
      'existing Passenger process termination',
      await stopWeb(passenger),
      'only the exact process spawned through deploy/namecheap/app.js was terminated',
    );
    passenger = null;

    const rollback = command('sh', [path.join(appHome, 'rollback.sh')], {
      env: baseEnvironment,
    });
    executed.push({ script: 'rollback.sh', output: rollback.stdout.trim() });
    const rolledBackReceipt = JSON.parse(
      fs.readFileSync(path.join(appHome, 'current', 'receipt.json'), 'utf8'),
    );
    passenger = await startPassengerWeb(root, path.join(appHome, 'current'));
    const rollbackReady = command(
      'sh',
      [
        path.join(appHome, 'current', 'readycheck.sh'),
        `http://127.0.0.1:${passenger.port}`,
      ],
      { env: { ...baseEnvironment, OWD_EXPECTED_SHA: BASE } },
    );
    executed.push({ script: 'readycheck.sh after rollback', output: rollbackReady.stdout.trim() });
    check(
      checks,
      'existing rollback script runtime',
      rolledBackReceipt.gitSha === BASE && /READY:/.test(rollbackReady.stdout),
      `rollback.sh restored and served ${BASE}`,
    );
    await stopWeb(passenger);
    passenger = null;

    const redeploy = command('sh', [
      path.join(NAMECHEAP, 'deploy.sh'),
      newArtifact.tarName,
      newArtifact.tarSha256,
    ], {
      env: baseEnvironment,
    });
    executed.push({
      script: 'deploy.sh reactivation',
      artifact: newArtifact.tarName,
      output: redeploy.stdout.trim(),
    });
    passenger = await startPassengerWeb(root, path.join(appHome, 'current'));
    const finalReady = command(
      'sh',
      [
        path.join(appHome, 'current', 'readycheck.sh'),
        `http://127.0.0.1:${passenger.port}`,
      ],
      { env: { ...baseEnvironment, OWD_EXPECTED_SHA: source.commit } },
    );
    check(
      checks,
      'existing deploy script reactivation',
      /READY:/.test(finalReady.stdout) &&
        JSON.parse(fs.readFileSync(path.join(appHome, 'current', 'receipt.json'), 'utf8')).gitSha ===
          source.commit,
      `deploy.sh reactivated and served ${source.commit}`,
    );
    await stopWeb(passenger);
    passenger = null;
  } finally {
    if (passenger) await stopWeb(passenger);
  }
  return {
    environment: 'CPANEL_SIMULATION',
    claim: 'Exact existing deploy/namecheap scripts executed only inside the local disposable account layout.',
    scripts: newArtifact.scriptHashes,
    artifacts: {
      old: { file: path.basename(oldArtifact.tarFile), sha256: sha256File(oldArtifact.tarFile) },
      candidate: { file: path.basename(newArtifact.tarFile), sha256: sha256File(newArtifact.tarFile) },
    },
    executed,
  };
}

export async function runCpanelSimulation({ repoRoot }) {
  const startedAt = new Date().toISOString();
  const source = {
    commit: git(['rev-parse', 'HEAD'], { cwd: repoRoot }),
    tree: git(['rev-parse', 'HEAD^{tree}'], { cwd: repoRoot }),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }),
    status: git(['status', '--porcelain'], { cwd: repoRoot }),
  };
  if (source.status) throw new Error(`cPanel simulation refuses a dirty source:\n${source.status}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-cpanel-sim-'));
  const shared = path.join(root, 'shared');
  const directories = {
    releases: path.join(root, 'releases'),
    data: path.join(shared, 'data'),
    logs: path.join(shared, 'logs'),
    spill: path.join(shared, 'evidence-spill'),
    backups: path.join(shared, 'backups'),
  };
  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const oldName = `cana-${BASE.slice(0, 12)}`;
  const newName = `cana-${source.commit.slice(0, 12)}`;
  const oldRelease = createRelease(root, oldName, BASE);
  const newRelease = createRelease(root, newName, source.commit);
  activate(root, newName);
  makeImmutable(oldRelease);
  makeImmutable(newRelease);

  const retained = stateDirectory(source.commit);
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const packageFile = path.join(retained, `cpanel-simulation-${stamp}.tar.gz`);
  command(
    'tar',
    ['-czf', packageFile, '-C', root, 'releases', 'current', 'shared'],
    { timeout: 180_000 },
  );
  const checks = [];
  let web = null;
  let failure = null;
  let runtimeRemoved = false;
  let backupSha256 = null;
  let finalPort = null;
  let existingScriptEvidence = null;

  try {
    const currentTarget = fs.realpathSync(path.join(root, 'current'));
    check(
      checks,
      'immutable releases and activation pointer',
      currentTarget === fs.realpathSync(newRelease) &&
        (fs.statSync(newRelease).mode & 0o777) === 0o555 &&
        (fs.statSync(path.join(newRelease, 'release.json')).mode & 0o777) === 0o444,
      `current -> ${newName}; release dir 0555 and identity 0444`,
    );
    const immutableWrite = (() => {
      try {
        fs.appendFileSync(path.join(newRelease, 'release.json'), 'mutation');
        return false;
      } catch {
        return true;
      }
    })();
    check(checks, 'release mutation refusal', immutableWrite, 'append to immutable release identity was refused');

    const database = path.join(directories.data, 'cana.db');
    sqlite(
      newRelease,
      database,
      `CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
       INSERT INTO schema_migrations VALUES(1,datetime('now'));
       CREATE TABLE persistent_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
       INSERT INTO persistent_probe VALUES(1,'persistent-before')`,
      'exec',
    );
    command('sh', [path.join(newRelease, 'migrate.sh')], {
      env: runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
    });
    const versions = sqlite(newRelease, database, 'SELECT group_concat(version) FROM schema_migrations ORDER BY version');
    const persistentBefore = sqlite(newRelease, database, 'SELECT value FROM persistent_probe WHERE id=1');
    check(
      checks,
      'shared-data migration',
      versions === '1,2' && persistentBefore === 'persistent-before',
      'old schema version 1 migrated to version 2 without replacing persistent data',
    );

    const worker = command('sh', [path.join(newRelease, 'worker-launcher.sh')], {
      env: {
        ...runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
        CANA_WORKER_ONCE: '1',
      },
      allowFailure: true,
    });
    check(
      checks,
      'worker launcher',
      worker.status === 0 && fs.existsSync(path.join(directories.logs, 'worker.jsonl')),
      'one-shot worker wrote a shared heartbeat',
    );

    web = await startWeb(root, newRelease);
    finalPort = web.port;
    const health = await probe(web.port, '/api/health');
    const ready = await probe(web.port, '/api/ready');
    const release = await probe(web.port, '/api/release');
    const home = await probe(web.port, '/');
    check(
      checks,
      'web launcher and health',
      health.status === 200 &&
        health.body.status === 'HEALTHY' &&
        health.body.environment === 'CPANEL_SIMULATION',
      `loopback:${web.port} HEALTHY and simulation-labelled`,
    );
    check(
      checks,
      'readiness and release identity',
      ready.body.status === 'READY' &&
        ready.body.gitSha === source.commit &&
        release.body.gitSha === source.commit &&
        release.headers['cache-control'] === 'no-store',
      `ready/release SHA ${source.commit}; no-store`,
    );
    check(
      checks,
      'staging smoke test',
      home.status === 200 &&
        home.body.status === 'CPANEL_SIMULATION' &&
        release.body.environment === 'CPANEL_SIMULATION',
      'homepage, health, readiness and identity probes passed on ephemeral loopback',
    );
    check(
      checks,
      'shared logs and evidence spill',
      fs.statSync(path.join(directories.logs, 'web.jsonl')).size > 0 &&
        fs.readdirSync(directories.spill).length >= 2,
      `${fs.readdirSync(directories.spill).length} spill records plus web and worker logs`,
    );
    check(checks, 'owned web process termination', await stopWeb(web), 'only the spawned web PID was terminated');
    web = null;

    const backupFile = path.join(directories.backups, 'cana.db.backup');
    command('sh', [path.join(newRelease, 'backup.sh')], {
      env: {
        ...runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
        CANA_BACKUP_FILE: backupFile,
      },
    });
    backupSha256 = sha256File(backupFile);
    sqlite(
      newRelease,
      database,
      "UPDATE persistent_probe SET value='mutated-after-backup' WHERE id=1",
      'exec',
    );
    command('sh', [path.join(newRelease, 'restore.sh')], {
      env: {
        ...runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
        CANA_BACKUP_FILE: backupFile,
      },
    });
    const restoredValue = sqlite(newRelease, database, 'SELECT value FROM persistent_probe WHERE id=1');
    check(
      checks,
      'backup and restore',
      restoredValue === 'persistent-before',
      `SQLite backup ${backupSha256} restored the persistent sentinel`,
    );

    const rolledBack = activate(root, oldName);
    check(
      checks,
      'activation rollback',
      rolledBack === fs.realpathSync(oldRelease) &&
        sqlite(oldRelease, database, 'SELECT value FROM persistent_probe WHERE id=1') === 'persistent-before',
      `current -> ${oldName}; shared database persisted`,
    );
    web = await startWeb(root, oldRelease);
    const oldIdentity = await probe(web.port, '/api/release');
    check(
      checks,
      'rollback runtime identity',
      oldIdentity.body.gitSha === BASE,
      `rolled-back launcher serves ${BASE}`,
    );
    check(checks, 'rolled-back process termination', await stopWeb(web), 'rolled-back web PID terminated');
    web = null;

    const reactivated = activate(root, newName);
    web = await startWeb(root, newRelease);
    finalPort = web.port;
    const finalHealth = await probe(web.port, '/api/health');
    const finalIdentity = await probe(web.port, '/api/release');
    check(
      checks,
      'reactivation smoke',
      reactivated === fs.realpathSync(newRelease) &&
        finalHealth.body.status === 'HEALTHY' &&
        finalIdentity.body.gitSha === source.commit,
      `current -> ${newName}; final health and SHA pass`,
    );
    check(checks, 'final process termination', await stopWeb(web), 'final web PID terminated');
    web = null;

    existingScriptEvidence = await exerciseExistingNamecheapScripts({
      root,
      directories,
      source,
      checks,
    });
    const realPrismaProof = runRealPrismaProof(source);
    existingScriptEvidence.realPrismaProof = realPrismaProof;
    check(
      checks,
      'existing migration script with real Prisma CLI',
      realPrismaProof.proof.prismaVersion === '6.19.3' &&
        realPrismaProof.proof.migrationsApplied === CANONICAL_MIGRATIONS.length &&
        JSON.stringify(realPrismaProof.proof.migrationUniverse) === JSON.stringify(CANONICAL_MIGRATIONS) &&
        realPrismaProof.proof.coreTables === 2 &&
        /^3\./.test(realPrismaProof.proof.postgis) &&
        realPrismaProof.proof.h3 === '4.2.3' &&
        realPrismaProof.proof.directUrlContract === 'SAME_DISPOSABLE_POSTGRESQL_INSTANCE' &&
        realPrismaProof.proof.forgedLoopbackIdentityRefusalProven === true &&
        realPrismaProof.proof.appIdentityRefusalProven === true &&
        realPrismaProof.proof.appIdentityAcceptanceProven === true &&
        realPrismaProof.proof.migrationOutputRedacted === true &&
        realPrismaProof.dependencyFetch.sourceMounted === false &&
        realPrismaProof.dependencyFetch.lifecycleScriptsEnabled === false &&
        realPrismaProof.dependencyFetch.prismaEnginePrefetch === '6.19.3' &&
        realPrismaProof.dependencyFetch.prismaClientEnginePrefetched === true &&
        realPrismaProof.executionNetwork === 'internal-only-disposable-postgresql',
      `migrate.sh ran Prisma ${realPrismaProof.proof.prismaVersion} and the exact ${CANONICAL_MIGRATIONS.length}-migration reviewed PostgreSQL universe after manifest-only, ignore-scripts fetch plus explicit engine prefetch; proof network ${realPrismaProof.executionNetwork}`,
    );
    check(
      checks,
      'managed PostgreSQL backup authority refusal',
      realPrismaProof.proof.backupAuthority === 'PROVIDER_OPERATOR_REQUIRED' &&
        realPrismaProof.proof.backupRefusalProven === true,
      'worker.mjs refused to fabricate a local-file backup',
    );
    check(
      checks,
      'real Prisma proof resource cleanup',
      realPrismaProof.cleanup.containerRemoved &&
        realPrismaProof.cleanup.dependencyContainerRemoved &&
        realPrismaProof.cleanup.volumeRemoved &&
        realPrismaProof.cleanup.databaseContainerRemoved &&
        realPrismaProof.cleanup.networkRemoved,
      'source, dependency, database, volume, and internal-network proof resources were removed',
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (web) await stopWeb(web);
    makeWritable(oldRelease);
    makeWritable(newRelease);
    fs.rmSync(root, { recursive: true, force: true });
    runtimeRemoved = !fs.existsSync(root);
  }

  const overall =
    !failure &&
    checks.length === 26 &&
    checks.every((entry) => entry.pass) &&
    runtimeRemoved
      ? 'PASS'
      : 'FAIL';
  const releaseReceipt = {
    schemaVersion: 1,
    environment: 'CPANEL_SIMULATION',
    claim: 'Local cPanel-like staging simulation only. No production account was contacted and no live deployment is proven.',
    overall,
    startedAt,
    finishedAt: new Date().toISOString(),
    source,
    package: {
      file: packageFile,
      bytes: fs.statSync(packageFile).size,
      sha256: sha256File(packageFile),
    },
    layout: {
      releases: [oldName, newName],
      activationPointer: 'current',
      shared: ['data', 'logs', 'evidence-spill', 'backups'],
    },
    portIsolation: `ephemeral loopback port; final observed port ${finalPort}; no public listener`,
    backupSha256,
    existingNamecheapScripts: existingScriptEvidence,
    checks,
    cleanup: {
      runtimeRemoved,
      ownedProcessesTerminated: web === null,
    },
    failure,
  };
  const releaseReceiptFile = path.join(retained, `release-receipt-${stamp}.json`);
  fs.writeFileSync(releaseReceiptFile, `${JSON.stringify(releaseReceipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const receipt = writeReceipt('verify-cpanel', {
    ...releaseReceipt,
    releaseReceipt: {
      file: releaseReceiptFile,
      sha256: sha256File(releaseReceiptFile),
    },
  });
  console.log(`package: ${packageFile}`);
  console.log(`release receipt: ${releaseReceiptFile}`);
  console.log(`receipt: ${receipt.file}`);
  console.log(`receipt sha256: ${receipt.sha256}`);
  if (overall !== 'PASS') {
    process.stderr.write(`${failure ?? 'cPanel simulation check or cleanup failed'}\n`);
    process.exitCode = 1;
  } else {
    console.log(`PASS verify cpanel at ${source.commit}`);
  }
  return receipt.body;
}
