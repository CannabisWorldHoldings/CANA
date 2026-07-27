import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { sha256File, writeReceipt } from '../test-runner/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = path.join(ROOT, 'tools', 'cpanel-sim', 'templates');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';

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
    artifact,
    createdAt: new Date().toISOString(),
  };
}

function createRelease(root, name, commit) {
  const release = path.join(root, 'releases', name);
  fs.mkdirSync(release, { recursive: true });
  fs.cpSync(TEMPLATES, release, { recursive: true });
  fs.writeFileSync(
    path.join(release, 'release.json'),
    `${JSON.stringify(releaseIdentity(commit, name), null, 2)}\n`,
  );
  command('git', ['archive', '--format=tar', '--output', path.join(release, 'source.tar'), commit]);
  return release;
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

function sqlite(database, statement) {
  return command('sqlite3', [database, statement]).stdout.trim();
}

function stateDirectory(commit) {
  const root =
    process.env.CANA_CPANEL_STATE_DIR ??
    path.join(ROOT, '.cana-local', 'cpanel-sim');
  const directory = path.join(path.resolve(root), commit);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
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

  try {
    const currentTarget = fs.realpathSync(path.join(root, 'current'));
    check(
      checks,
      'immutable releases and activation pointer',
      currentTarget === newRelease &&
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
      database,
      `CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
       INSERT INTO schema_migrations VALUES(1,datetime('now'));
       CREATE TABLE persistent_probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
       INSERT INTO persistent_probe VALUES(1,'persistent-before')`,
    );
    command('sh', [path.join(newRelease, 'migrate.sh')], {
      env: runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
    });
    const versions = sqlite(database, 'SELECT group_concat(version) FROM schema_migrations ORDER BY version');
    const persistentBefore = sqlite(database, 'SELECT value FROM persistent_probe WHERE id=1');
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
    sqlite(database, "UPDATE persistent_probe SET value='mutated-after-backup' WHERE id=1");
    command('sh', [path.join(newRelease, 'restore.sh')], {
      env: {
        ...runtimeEnvironment(root, newRelease, path.join(directories.logs, 'unused-port')),
        CANA_BACKUP_FILE: backupFile,
      },
    });
    const restoredValue = sqlite(database, 'SELECT value FROM persistent_probe WHERE id=1');
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
      rolledBack === oldRelease && sqlite(database, 'SELECT value FROM persistent_probe WHERE id=1') === 'persistent-before',
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
      reactivated === newRelease &&
        finalHealth.body.status === 'HEALTHY' &&
        finalIdentity.body.gitSha === source.commit,
      `current -> ${newName}; final health and SHA pass`,
    );
    check(checks, 'final process termination', await stopWeb(web), 'final web PID terminated');
    web = null;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (web) await stopWeb(web);
    fs.chmodSync(oldRelease, 0o755);
    fs.chmodSync(newRelease, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
    runtimeRemoved = !fs.existsSync(root);
  }

  const overall =
    !failure &&
    checks.length === 15 &&
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
