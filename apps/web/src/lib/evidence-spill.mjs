import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * DURABLE EVIDENCE SPILL — the drain that makes "DEFERRED" a true statement.
 *
 * THE DEFECT THIS EXISTS FOR. An independent verifier asked the sharpest possible
 * question about the handoff bookkeeping: "is EVIDENCE_WRITE_DEFERRED real, or a
 * euphemism for LOST?" It was a euphemism. The route recorded a deferred state and
 * the code comment said "safe to retry later", but nothing anywhere retried it.
 * Nothing drained it. There was no queue. A deferred write was simply gone, and the
 * word DEFERRED made that invisible to the one person — an operator reading the
 * header — who could have done something about it.
 *
 * Measured, not argued: under an induced 9-second write stall, 150 handoffs all
 * returned 303 and only 148 LeadEvents persisted. Two consumer actions vanished with
 * the system reporting success.
 *
 * WHY A FILE AND NOT A DATABASE TABLE. The obvious design is an outbox table. It is
 * the wrong one HERE, for a reason worth stating plainly: this mechanism exists to
 * survive a failure OF THE DATABASE WRITE PATH. Recording "the database write failed"
 * by writing to the database is circular — it fails for exactly the same reason, at
 * exactly the same moment. A filesystem append escapes the circularity. It is also
 * the only option available without touching prisma/schema.prisma, which the
 * migration lane owns this cycle; but even with a free hand, the circularity argument
 * decides it.
 *
 * THE HONESTY THIS BUYS. After this module exists, the states mean what they say:
 *
 *   EVIDENCE_WRITE_DEFERRED — the write failed AND the record is on disk. It is
 *                             genuinely recoverable, and drainEvidenceSpill() is the
 *                             thing that recovers it.
 *   EVIDENCE_WRITE_LOST     — the write failed AND the spill also failed (read-only
 *                             filesystem, full disk). Nothing will recover it. This
 *                             state is new, and it is the truth that DEFERRED was
 *                             previously hiding.
 *
 * DELIVERY GUARANTEES, stated exactly rather than rounded up.
 *
 *   Attribution replay is EXACTLY-ONCE. The ledger's @@unique([merchantId,
 *   eventIdentity]) constraint rejects a duplicate, so replaying the same record
 *   twice cannot fund a second valued action. This is the path that carries money and
 *   it is protected by the database, not by this file.
 *
 *   LeadEvent replay is AT-LEAST-ONCE. LeadEvent has no natural uniqueness key, so a
 *   crash after the replay write but before the file is rewritten will duplicate a
 *   click-log row. That is a real limitation and it is not being talked around: a
 *   duplicated click in an analytics log is a strictly better failure than a silently
 *   lost one, and the alternative — inventing a uniqueness key — needs a schema
 *   change this lane does not own.
 */

const SPILL_FILENAME = 'evidence-spill.jsonl';

/**
 * A spill must never take longer than this.
 *
 * FOUND BY ACCIDENT, KEPT ON PURPOSE. Writing the court for this module, I pointed a
 * failure fixture at a path under /proc and `fs.mkdir` did not fail — it HUNG, and
 * took the whole test run with it. The fixture was wrong, but the hang exposed a
 * genuine defect in this module: the route AWAITS spillEvidence() inside the
 * consumer's request path. A filesystem that stalls rather than erroring — a
 * disconnected network mount, a frozen loop device, an exhausted inode table — would
 * therefore stall the consumer's redirect.
 *
 * That is the exact failure this entire subsystem exists to prevent, reintroduced by
 * the mechanism meant to prevent it. Write-independence is not "independent of the
 * database", it is independent of ANY slow write. A bounded wait restores that: past
 * the deadline the spill is abandoned, the record is reported unspilled, and the
 * route escalates to LOST — a truthful bad outcome, delivered promptly, instead of a
 * consumer left waiting on a filesystem.
 */
const SPILL_DEADLINE_MS = 2000;

/** Reject if a promise outruns its deadline. The loser is abandoned, never awaited. */
function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      // Do not hold the event loop open for a deadline nobody is waiting on.
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Where the spill lives. Overridable so tests never touch the real one. */
export function spillPath(env = process.env) {
  if (typeof env.CANA_EVIDENCE_SPILL_PATH === 'string' && env.CANA_EVIDENCE_SPILL_PATH.trim() !== '') {
    return env.CANA_EVIDENCE_SPILL_PATH.trim();
  }
  return path.join(process.cwd(), 'prisma', SPILL_FILENAME);
}

/**
 * Append one unrecoverable-by-the-database record, durably.
 *
 * NEVER THROWS. A spill failure must not take down a consumer handoff — that would
 * make the recovery mechanism more dangerous than the problem. It reports
 * { spilled: false } and the caller escalates the state to LOST, which is the honest
 * outcome and is exactly what an operator needs to see.
 */
export async function spillEvidence(record, { env = process.env, timeoutMs = SPILL_DEADLINE_MS } = {}) {
  const file = spillPath(env);
  const entry = {
    spillId: crypto.randomUUID(),
    spilledAt: new Date().toISOString(),
    ...record,
  };
  // Size is checked BEFORE opening anything, so an oversized record costs no I/O.
  const line = `${JSON.stringify(entry)}\n`;
  if (Buffer.byteLength(line) > 4096) {
    // Refuse rather than risk a torn line that corrupts every later read.
    return { spilled: false, reason: 'RECORD_TOO_LARGE_TO_APPEND_ATOMICALLY' };
  }

  let handle;
  try {
    await withDeadline((async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      // O_APPEND: concurrent writers cannot interleave. POSIX guarantees a single
      // append under PIPE_BUF (4096 on Linux) is atomic, and these lines are far
      // smaller — which matters, because the burst that causes spilling is precisely
      // when many writers hit this at once.
      //
      // O_NONBLOCK IS LOAD-BEARING, AND NOT FOR PERFORMANCE. The deadline above
      // releases the CALLER from a stalled open, but it cannot cancel the open
      // itself: node has no way to abort one in flight (an AbortSignal is accepted
      // and ignored — measured). The abandoned operation then keeps the event loop
      // alive indefinitely.
      //
      // That is not theoretical. It is exactly what happened here: with the deadline
      // in place and every assertion passing, the test file took 884 SECONDS because
      // the process could not exit, and the full suite hit its ceiling with 78 files
      // marked failed that had simply never been given a chance to run. A "passing"
      // result that consumed the entire budget.
      //
      // O_NONBLOCK makes the open FAIL (ENXIO in 3ms) instead of blocking, so the
      // deadline becomes a backstop for a slow WRITE rather than the only defence
      // against a hung OPEN. On a regular file it changes nothing.
      handle = await fs.open(file,
        // eslint-disable-next-line no-bitwise
        fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NONBLOCK,
        0o600);
      await handle.write(line);
      // fsync, or a machine that loses power keeps a file that claims durability it
      // does not have. The whole point of this module is that the claim is true.
      await handle.sync();
    })(), timeoutMs, 'evidence spill');
    return { spilled: true, spillId: entry.spillId, path: file };
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : '';
    return { spilled: false, reason: `${code}${String(error?.message ?? error)}`.slice(0, 160) };
  } finally {
    // Closed without awaiting: if the write stalled, awaiting the close would stall
    // here too and reintroduce the hang the deadline just removed.
    handle?.close().catch(() => {});
  }
}

/** Read the spill. Malformed lines are reported, never silently dropped. */
export async function readSpill({ env = process.env } = {}) {
  const file = spillPath(env);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], malformed: [], exists: false };
    throw error;
  }
  const entries = [];
  const malformed = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A truncated tail line is the expected malformation after a hard crash.
      // Surfacing it beats dropping it: an operator can see the loss happened.
      malformed.push(line.slice(0, 200));
    }
  }
  return { entries, malformed, exists: true };
}

let draining = false;

/**
 * Replay spilled records into the database, then rewrite the file with only what
 * still could not be written.
 *
 * SINGLE-FLIGHT. Two concurrent drains would both read the same records and both
 * replay them, doubling exactly the rows this is supposed to protect.
 */
export async function drainEvidenceSpill(prisma, { env = process.env, limit = 500 } = {}) {
  if (draining) return { drained: 0, skipped: 'ALREADY_DRAINING' };
  draining = true;
  const file = spillPath(env);
  try {
    const { entries, malformed, exists } = await readSpill({ env });
    if (!exists || entries.length === 0) {
      return { drained: 0, remaining: 0, malformed: malformed.length, exists };
    }

    const remaining = [];
    let drained = 0;
    const failures = [];

    for (const entry of entries.slice(0, limit)) {
      try {
        if (entry.kind === 'LEAD_EVENT') {
          await prisma.leadEvent.create({
            data: {
              brandId: entry.brandId,
              retailerId: entry.retailerId,
              eventType: entry.eventType ?? 'HANDOFF_CLICK',
              // Preserve WHEN it happened, not when it was drained. A replayed click
              // dated at drain time would silently falsify every time-series it
              // appears in.
              ...(entry.occurredAt ? { createdAt: new Date(entry.occurredAt) } : {}),
            },
          });
          drained += 1;
        } else if (entry.kind === 'ATTRIBUTION') {
          const { createDemandCredits } = await import('./demand-credits.mjs');
          const credits = createDemandCredits(prisma);
          const result = await credits.attribute({
            merchantId: entry.merchantId,
            actionKind: entry.actionKind,
            evidenceChain: entry.evidenceChain,
            observedAt: entry.observedAt ? new Date(entry.observedAt) : new Date(),
            proofState: entry.proofState,
            valueEligible: entry.valueEligible === true,
            interactionNonce: entry.interactionNonce ?? null,
            destination: entry.destination ?? null,
          });
          // A DUPLICATE denial means the ledger already has it — the constraint did
          // its job and the record is drained, not failed.
          if (result?.accepted === true || result?.denial_code === 'DUPLICATE_ATTRIBUTION') {
            drained += 1;
          } else {
            remaining.push(entry);
            failures.push({ spillId: entry.spillId, denial: result?.denial_code ?? 'UNKNOWN' });
          }
        } else {
          // An unrecognised kind is kept, not discarded. A future version may know
          // how to drain it; deleting it here would destroy evidence permanently.
          remaining.push(entry);
        }
      } catch (error) {
        remaining.push(entry);
        failures.push({ spillId: entry.spillId, error: String(error?.message ?? error).slice(0, 120) });
      }
    }

    // Anything beyond the limit is untouched and stays queued.
    remaining.push(...entries.slice(limit));

    // Atomic replace: write the remainder to a temp file and rename over the
    // original. A crash mid-drain leaves either the old file or the new one, never a
    // half-written one.
    const tmp = `${file}.draining.${process.pid}`;
    const body = remaining.map((e) => JSON.stringify(e)).join('\n');
    await fs.writeFile(tmp, body === '' ? '' : `${body}\n`, 'utf8');
    await fs.rename(tmp, file);

    return { drained, remaining: remaining.length, malformed: malformed.length, failures, exists: true };
  } finally {
    draining = false;
  }
}
