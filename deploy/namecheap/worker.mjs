/**
 * MAINTENANCE WORKER — cron-tick job runner for the cPanel deployment.
 *
 * HONESTY FIRST: this application has no in-process background daemons; its
 * request path is fully synchronous. What production genuinely needs on a
 * schedule is (a) database backups and (b) an independent health probe with a
 * local audit trail. That is what this worker does — nothing invented.
 *
 * EXECUTION MODEL — cron ticks, not a daemon. Shared-hosting LVE policy
 * (40 entry processes, provider process management, CAPABILITIES.md §8) makes
 * long-lived daemons the fragile choice; Namecheap cron (min interval 5 min)
 * is the supported primitive. Each tick starts, takes a lock, runs due jobs,
 * releases, exits. A `--loop` mode exists for supervised environments and for
 * proving graceful shutdown, but cron `--once` is the production default.
 *
 * GRACEFUL SHUTDOWN: SIGTERM/SIGINT set a stop flag; the CURRENT job finishes
 * (jobs are short and idempotent), a shutdown record is written to the log,
 * the lock is released, exit code 0. A second signal exits immediately.
 *
 * LOCKING: mkdir-based (atomic on POSIX). A lock older than 30 minutes is
 * considered stale (a killed tick) and is taken over, loudly.
 *
 * USAGE
 *   node worker.mjs --once                 # cron tick: all due jobs (backup, health)
 *   node worker.mjs --once backup          # one job only
 *   node worker.mjs --loop --interval-ms 300000
 *
 * CRON LINE (cPanel -> Cron Jobs; cron does NOT inherit the app's env):
 *   17 3 * * * cd $HOME/apps/orderweeddc/current && \
 *     /opt/alt/alt-nodejs20/root/usr/bin/node worker.mjs --once backup >> $HOME/orderweeddc-backups/cron.out 2>&1
 *
 * ENV (all optional): OWD_DATA_DIR, OWD_BACKUP_DIR, OWD_BACKUP_KEEP,
 * WORKER_HEALTH_URL. No secrets read, no secrets logged.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.OWD_DATA_DIR || path.join(os.homedir(), 'orderweeddc-data');
const DB_PATH = path.join(DATA_DIR, 'prod.db');
const BACKUP_DIR = process.env.OWD_BACKUP_DIR || path.join(os.homedir(), 'orderweeddc-backups');
const KEEP = Math.max(1, Number(process.env.OWD_BACKUP_KEEP || 14));
const LOCK_DIR = path.join(BACKUP_DIR, '.worker-lock');
const LOG_FILE = path.join(BACKUP_DIR, 'worker-log.jsonl');
const STALE_LOCK_MS = 30 * 60 * 1000;

let stopRequested = false;
let signalsSeen = 0;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    signalsSeen += 1;
    if (signalsSeen > 1) {
      log({ event: 'forced-exit', signal });
      process.exit(130);
    }
    stopRequested = true;
    console.error(`${signal} received — finishing current job, then shutting down cleanly.`);
  });
}

function log(record) {
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record });
  console.log(line);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* logging must never take the worker down */
  }
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function acquireLock() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  try {
    fs.mkdirSync(LOCK_DIR);
    fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid));
    return true;
  } catch {
    try {
      const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
      if (age > STALE_LOCK_MS) {
        log({ event: 'stale-lock-takeover', ageMs: Math.round(age) });
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        fs.mkdirSync(LOCK_DIR);
        fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid));
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }
}

function releaseLock() {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

/**
 * Best-effort WAL checkpoint through the artifact's own Prisma client so the
 * copied file is a complete database. If the client is unavailable (repo
 * context, missing engine), the copy still happens but the record says so —
 * a backup that silently skipped its checkpoint is a false receipt.
 */
async function checkpointDatabase() {
  try {
    const { createRequire } = await import('node:module');
    const requireFromApp = createRequire(path.join(process.cwd(), 'noop.js'));
    const { PrismaClient } = requireFromApp('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });
    try {
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
      return 'CHECKPOINTED';
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    return `CHECKPOINT_UNAVAILABLE: ${String(error?.message ?? error).slice(0, 120)}`;
  }
}

const JOBS = {
  /** Copy the production database to a timestamped, hash-sidecarred backup. */
  async backup() {
    if (!fs.existsSync(DB_PATH)) {
      return { skipped: true, reason: `database absent at configured data dir` };
    }
    const checkpoint = await checkpointDatabase();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(BACKUP_DIR, `prod-${stamp}.db`);
    fs.copyFileSync(DB_PATH, target);
    const digest = sha256File(target);
    fs.writeFileSync(`${target}.sha256`, `${digest}  ${path.basename(target)}\n`);
    // Retention: keep the newest KEEP backups (+ sidecars); prune the rest.
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter((name) => /^prod-.*\.db$/.test(name))
      .sort()
      .reverse();
    const prunedFiles = backups.slice(KEEP);
    for (const name of prunedFiles) {
      fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
      fs.rmSync(path.join(BACKUP_DIR, `${name}.sha256`), { force: true });
    }
    return { checkpoint, backup: path.basename(target), sha256: digest, kept: Math.min(backups.length, KEEP), pruned: prunedFiles.length };
  },

  /** Probe the deployed app from outside the request path; log the verdict. */
  async health() {
    const url = process.env.WORKER_HEALTH_URL;
    if (!url) {
      return { skipped: true, reason: 'WORKER_HEALTH_URL not configured' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.text();
      return {
        url,
        httpStatus: response.status,
        healthy: response.status === 200 && body.includes('"status":"HEALTHY"'),
      };
    } catch (error) {
      return { url, healthy: false, error: String(error?.message ?? error).slice(0, 160) };
    } finally {
      clearTimeout(timer);
    }
  },
};

async function runTick(jobNames) {
  const names = jobNames.length > 0 ? jobNames : Object.keys(JOBS);
  for (const name of names) {
    if (stopRequested) {
      log({ event: 'tick-interrupted-before-job', job: name });
      break;
    }
    if (!JOBS[name]) {
      log({ event: 'unknown-job', job: name, known: Object.keys(JOBS) });
      process.exitCode = 2;
      continue;
    }
    try {
      const result = await JOBS[name]();
      log({ event: 'job-complete', job: name, result });
    } catch (error) {
      log({ event: 'job-failed', job: name, error: String(error?.message ?? error).slice(0, 300) });
      process.exitCode = 1;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const loop = args.includes('--loop');
  const intervalIndex = args.indexOf('--interval-ms');
  const intervalMs = intervalIndex >= 0 ? Math.max(5_000, Number(args[intervalIndex + 1])) : 300_000;
  const jobNames = args
    .filter((arg, i) => !arg.startsWith('--') && (intervalIndex < 0 || i !== intervalIndex + 1))
    .flatMap((arg) => arg.split(','))
    .filter(Boolean);

  if (!acquireLock()) {
    log({ event: 'lock-held-exiting', note: 'another worker tick is running; this is normal under cron' });
    return;
  }
  log({ event: 'worker-start', mode: loop ? 'loop' : 'once', jobs: jobNames.length ? jobNames : Object.keys(JOBS) });
  try {
    if (!loop) {
      await runTick(jobNames);
    } else {
      while (!stopRequested) {
        await runTick(jobNames);
        // Interruptible sleep so SIGTERM never waits a full interval.
        const sleepUntil = Date.now() + intervalMs;
        while (!stopRequested && Date.now() < sleepUntil) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  } finally {
    log({ event: 'worker-shutdown', graceful: true, stopRequested });
    releaseLock();
  }
}

main().catch((error) => {
  log({ event: 'worker-crashed', error: String(error?.stack ?? error).slice(0, 500) });
  releaseLock();
  process.exit(1);
});
