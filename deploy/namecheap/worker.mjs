/**
 * MAINTENANCE WORKER — cron-tick job runner for the cPanel deployment.
 *
 * HONESTY FIRST: this application has no in-process background daemons; its
 * request path is fully synchronous. What production genuinely needs on a
 * schedule is an independent health probe with a local audit trail. Managed
 * PostgreSQL backups remain provider/operator authority and are never faked by
 * copying a local file.
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
 *   node worker.mjs --once health          # independent health tick
 *   node worker.mjs --once backup          # explicit fail-closed authority check
 *   node worker.mjs --loop --interval-ms 300000
 *
 * CRON LINE (cPanel -> Cron Jobs; cron does NOT inherit the app's env):
 *   mkdir -p $HOME/orderweeddc-backups && cd $HOME/apps/orderweeddc/current && \
 *     OWD_BACKUP_DIR=$HOME/orderweeddc-backups \
 *     WORKER_HEALTH_URL=https://orderweeddc.com/api/health \
 *     /opt/alt/alt-nodejs20/root/usr/bin/node worker.mjs --once health >> $HOME/orderweeddc-backups/cron.out 2>&1
 *
 * ENV (all optional): OWD_BACKUP_DIR, WORKER_HEALTH_URL. No secrets read,
 * no secrets logged.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BACKUP_DIR = process.env.OWD_BACKUP_DIR || path.join(os.homedir(), 'orderweeddc-backups');
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

const JOBS = {
  /**
   * Wake the sovereign continuation kernel (apps/web/scripts/continuation-tick.mjs).
   *
   * The database owns every future mission/trigger/receipt; this cron tick
   * merely evaluates durable state against the clock. Losing this host, this
   * cron, or this process erases nothing — any other runtime can run the same
   * tick against the same database, and concurrent ticks are exactly-once by
   * conditional claim. Configuration follows the WORKER_HEALTH_URL pattern:
   * WORKER_TICK_SCRIPT points at the tick entry (cron does not inherit the
   * app's env), DATABASE_URL must be present. Absent config is a skipped
   * state with a reason — never a silent success.
   */
  async 'continuation-tick'() {
    const configuredScript = process.env.WORKER_TICK_SCRIPT;
    if (!configuredScript) {
      return { skipped: true, reason: 'WORKER_TICK_SCRIPT not configured' };
    }
    const script = path.resolve(configuredScript);
    if (!process.env.DATABASE_URL) {
      return { skipped: true, reason: 'DATABASE_URL not configured' };
    }
    if (!fs.existsSync(script)) {
      return { skipped: true, reason: `tick script not found: ${script}` };
    }
    const { execFileSync } = await import('node:child_process');
    try {
      const stdout = execFileSync(process.execPath, [script], {
        cwd: path.dirname(script),
        timeout: 120_000,
        encoding: 'utf8',
      });
      const lastLine = stdout.trim().split('\n').at(-1) ?? '';
      return { ok: true, summary: lastLine.slice(0, 500) };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 300) };
    }
  },

  /** Refuse to forge a managed-database backup receipt from the web host. */
  async backup() {
    throw new Error(
      'MANAGED_POSTGRES_BACKUP_AUTHORITY_REQUIRED: obtain and verify a provider/operator backup receipt',
    );
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
      if (name === 'health' && result.skipped !== true && result.healthy !== true) {
        throw new Error(`HEALTH_PROBE_UNHEALTHY: ${JSON.stringify(result)}`);
      }
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
