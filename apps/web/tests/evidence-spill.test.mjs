import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  spillEvidence, readSpill, drainEvidenceSpill, spillPath,
} from '../src/lib/evidence-spill.mjs';

/**
 * EVIDENCE SPILL COURT.
 *
 * An independent verifier asked whether EVIDENCE_WRITE_DEFERRED was real or a
 * euphemism for LOST, and the honest answer was "euphemism": nothing drained it.
 * These tests exist to keep the answer honest, so every one of them attacks the
 * claim rather than demonstrating the happy path.
 *
 * The load-bearing assertions are the ones about FAILURE: that a spill which cannot
 * be written says so instead of returning success, that a drain which cannot write
 * keeps the record instead of dropping it, and that a truncated file does not take
 * the surviving records down with it.
 */

async function tmpEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spill-court-'));
  return { env: { CANA_EVIDENCE_SPILL_PATH: path.join(dir, 'spill.jsonl') }, dir };
}

test('a spilled record is durable and readable back', async () => {
  const { env } = await tmpEnv();
  const r = await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b1', retailerId: 'r1' }, { env });
  assert.equal(r.spilled, true);
  assert.ok(r.spillId, 'a spill must be identifiable, or an operator cannot talk about one');

  const { entries } = await readSpill({ env });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].brandId, 'b1');
  assert.ok(entries[0].spilledAt, 'the time must be recorded');
});

test('THE CORE RULE: a spill that cannot be written reports FALSE, never throws', async () => {
  // This is what separates DEFERRED from LOST. If this ever returns true on a failed
  // write, the route will report a recoverable state for an unrecoverable record —
  // which is the exact defect this whole module was built to end.
  //
  // The fixture is a DIRECTORY standing where the file should be: open(dir,'a')
  // fails EISDIR immediately on every platform. My first attempt pointed at a path
  // under /proc, which did not fail — mkdir HUNG, and hung the whole run. That
  // accident found the deadline defect repaired below, but as a fixture it was
  // simply wrong: a failure test must fail fast and deterministically.
  const { dir } = await tmpEnv();
  const occupied = path.join(dir, 'occupied.jsonl');
  await fs.mkdir(occupied);
  const r = await spillEvidence(
    { kind: 'LEAD_EVENT', brandId: 'b', retailerId: 'r' },
    { env: { CANA_EVIDENCE_SPILL_PATH: occupied } },
  );
  assert.equal(r.spilled, false, 'an unwritable spill must NOT report success');
  assert.ok(r.reason, 'the reason must be reported so an operator can fix the cause');
});

test('a spill failure never throws, because it must not break a consumer handoff', async () => {
  // A recovery mechanism that can take down the product is worse than the problem.
  const { dir } = await tmpEnv();
  const occupied = path.join(dir, 'blocked.jsonl');
  await fs.mkdir(occupied);
  await assert.doesNotReject(() => spillEvidence(
    { kind: 'X' }, { env: { CANA_EVIDENCE_SPILL_PATH: occupied } },
  ));
});

test('THE DEADLINE: a STALLED filesystem cannot hold the consumer path open', async () => {
  // The defect this pins was found by accident and is the sharpest one in the module.
  // The route AWAITS this function inside the consumer's request, so a filesystem
  // that stalls rather than erroring — a dead network mount, a frozen loop device —
  // would stall the redirect. Write-independence means independent of ANY slow write,
  // not just a slow database. A bounded wait is what makes that true.
  //
  // THE FIXTURE IS A FIFO, and the reason matters. My first version passed
  // `timeoutMs: 0` against an ordinary file, assuming zero would always expire first.
  // It did not: on an unloaded machine the write completed inside the same tick and
  // the test reported success — it passed 8/8 alone and FAILED under full-suite load,
  // which is the worst kind of test, since the failure looks like a flake rather than
  // the design error it was. A zero-millisecond deadline races real I/O; it does not
  // beat it.
  //
  // Opening a FIFO for append BLOCKS until a reader attaches, and no reader ever
  // will. That is a genuine, indefinite stall — the actual condition being defended
  // against — so the deadline is the only thing that can end this call. Nothing here
  // depends on timing luck.
  const { dir } = await tmpEnv();
  const fifo = path.join(dir, 'stalled.jsonl');
  try {
    execFileSync('mkfifo', [fifo]);
  } catch {
    return; // No mkfifo (non-POSIX host): skip rather than assert something weaker.
  }

  const started = Date.now();
  const r = await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: 'r' },
    { env: { CANA_EVIDENCE_SPILL_PATH: fifo }, timeoutMs: 3000 });
  const elapsed = Date.now() - started;

  assert.equal(r.spilled, false, 'a stalled spill must NOT claim success');
  assert.ok(r.reason, 'the reason must be reported');
  // Fast, because O_NONBLOCK refuses the readerless fifo outright (ENXIO) rather
  // than waiting for the deadline. If this ever approaches the deadline, the
  // non-blocking open has been lost and the hang is back.
  assert.ok(elapsed < 2000,
    `a stalled path must fail FAST, not wait out the deadline; took ${elapsed}ms`);
});

test('THE HANG: a stalled spill must not hold the PROCESS open', async () => {
  // THE ASSERTION THAT COST THE MOST TO LEARN. The deadline releases the caller but
  // cannot cancel an in-flight open — node has no mechanism for it, and an
  // AbortSignal is accepted and ignored (measured). The abandoned operation keeps the
  // event loop alive.
  //
  // Every assertion in this file passed while that was true, and the file still took
  // 884 SECONDS: the full suite hit its time ceiling and 78 test files were marked
  // failed having never run. A green result that consumes the entire budget is a
  // failure wearing a pass, and no assertion about return values can detect it.
  //
  // So this asserts on the PROCESS: spawn a child that spills to a stalled fifo and
  // require it to EXIT. Only a genuinely cancelled open can satisfy it.
  const { dir } = await tmpEnv();
  const fifo = path.join(dir, 'holds-open.jsonl');
  try {
    execFileSync('mkfifo', [fifo]);
  } catch {
    return;
  }
  const started = Date.now();
  execFileSync(process.execPath, ['-e', `
    import('${path.resolve('src/lib/evidence-spill.mjs')}').then(async (m) => {
      const r = await m.spillEvidence({ kind: 'LEAD_EVENT' },
        { env: { CANA_EVIDENCE_SPILL_PATH: ${JSON.stringify(fifo)} }, timeoutMs: 500 });
      if (r.spilled) { console.error('claimed success on a stalled path'); process.exit(2); }
    });
  `], { timeout: 8000, stdio: 'pipe' });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 8000,
    `the process must EXIT after a stalled spill; took ${elapsed}ms — an abandoned open is holding the event loop`);
});
test('concurrent spills do not interleave or lose records', async () => {
  // The burst that causes spilling is exactly when many writers arrive at once, so
  // append atomicity is not a theoretical concern here.
  const { env } = await tmpEnv();
  await Promise.all(Array.from({ length: 60 }, (_, i) =>
    spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: `r${i}` }, { env })));
  const { entries, malformed } = await readSpill({ env });
  assert.equal(entries.length, 60, 'every concurrent spill must survive');
  assert.equal(malformed.length, 0, 'no line may be torn by a concurrent append');
  assert.equal(new Set(entries.map((e) => e.retailerId)).size, 60);
});

test('an oversized record is REFUSED rather than risking a torn line', async () => {
  const { env } = await tmpEnv();
  const r = await spillEvidence({ kind: 'LEAD_EVENT', huge: 'x'.repeat(5000) }, { env });
  assert.equal(r.spilled, false, 'a record too large to append atomically must be refused');
  assert.match(r.reason, /ATOMIC/i);
  // And it must not have corrupted the file for everyone else.
  const { malformed } = await readSpill({ env });
  assert.equal(malformed.length, 0);
});

test('a truncated tail line is reported, not silently dropped', async () => {
  const { env } = await tmpEnv();
  await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: 'good' }, { env });
  await fs.appendFile(env.CANA_EVIDENCE_SPILL_PATH, '{"kind":"LEAD_EVENT","brand');
  const { entries, malformed } = await readSpill({ env });
  assert.equal(entries.length, 1, 'the intact record must still be readable');
  assert.equal(malformed.length, 1, 'the damaged one must be VISIBLE, not vanish');
});

test('a missing spill file is not an error', async () => {
  const { entries, exists } = await readSpill({
    env: { CANA_EVIDENCE_SPILL_PATH: path.join(os.tmpdir(), `absent-${Date.now()}.jsonl`) } });
  assert.equal(exists, false);
  assert.deepEqual(entries, []);
});

// ------------------------------------------------------------------------ drain
function fakeDb(behaviour = {}) {
  const created = [];
  return {
    created,
    leadEvent: {
      create: async ({ data }) => {
        if (behaviour.leadThrows) throw new Error('database is locked');
        created.push(data);
        return { id: `id${created.length}` };
      },
    },
  };
}

test('draining writes the spilled record and EMPTIES the file', async () => {
  const { env } = await tmpEnv();
  await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b1', retailerId: 'r1' }, { env });
  await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b2', retailerId: 'r2' }, { env });

  const db = fakeDb();
  const res = await drainEvidenceSpill(db, { env });
  assert.equal(res.drained, 2);
  assert.equal(res.remaining, 0);
  assert.equal(db.created.length, 2);

  const { entries } = await readSpill({ env });
  assert.equal(entries.length, 0, 'a drained record must not be drained twice');
});

test('THE SECOND CORE RULE: a record the drain cannot write is KEPT', async () => {
  // If a failed drain deleted the record, the "durable" queue would destroy evidence
  // faster than having no queue at all.
  const { env } = await tmpEnv();
  await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: 'r' }, { env });
  const res = await drainEvidenceSpill(fakeDb({ leadThrows: true }), { env });
  assert.equal(res.drained, 0);
  assert.equal(res.remaining, 1, 'an undrainable record must survive for the next attempt');
  const { entries } = await readSpill({ env });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].retailerId, 'r');
});

test('a replayed click keeps its ORIGINAL time, not the drain time', async () => {
  // A click replayed with a drain-time timestamp silently falsifies every time series
  // it appears in — a subtle corruption that would be very hard to trace later.
  const { env } = await tmpEnv();
  const when = new Date(Date.now() - 86_400_000).toISOString();
  await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: 'r', occurredAt: when }, { env });
  const db = fakeDb();
  await drainEvidenceSpill(db, { env });
  assert.equal(db.created[0].createdAt.toISOString(), when);
});

test('an unrecognised record kind is preserved, never discarded', async () => {
  const { env } = await tmpEnv();
  await spillEvidence({ kind: 'SOME_FUTURE_KIND', payload: 1 }, { env });
  const res = await drainEvidenceSpill(fakeDb(), { env });
  assert.equal(res.drained, 0);
  assert.equal(res.remaining, 1, 'a kind we cannot drain YET must not be destroyed');
});

test('the limit bounds a drain without losing the overflow', async () => {
  const { env } = await tmpEnv();
  for (let i = 0; i < 7; i += 1) {
    await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: `r${i}` }, { env });
  }
  const res = await drainEvidenceSpill(fakeDb(), { env, limit: 3 });
  assert.equal(res.drained, 3);
  assert.equal(res.remaining, 4, 'the overflow must stay queued, not disappear');
});

test('the drain is SINGLE-FLIGHT, so a record cannot be replayed twice at once', async () => {
  // Two concurrent drains would each read the same records and each write them,
  // doubling exactly the rows this exists to protect.
  const { env } = await tmpEnv();
  for (let i = 0; i < 5; i += 1) {
    await spillEvidence({ kind: 'LEAD_EVENT', brandId: 'b', retailerId: `r${i}` }, { env });
  }
  const db = fakeDb();
  const [a, b] = await Promise.all([
    drainEvidenceSpill(db, { env }),
    drainEvidenceSpill(db, { env }),
  ]);
  const skipped = [a, b].filter((r) => r.skipped === 'ALREADY_DRAINING');
  assert.equal(skipped.length, 1, 'exactly one concurrent drain must be refused');
  assert.equal(db.created.length, 5, 'each record must be written exactly once');
});

test('the spill path is overridable, so a test can never touch the real one', async () => {
  const custom = '/tmp/x/custom.jsonl';
  assert.equal(spillPath({ CANA_EVIDENCE_SPILL_PATH: custom }), custom);
  assert.match(spillPath({}), /prisma[/\\]evidence-spill\.jsonl$/);
  assert.equal(spillPath({ CANA_EVIDENCE_SPILL_PATH: '   ' }), spillPath({}),
    'a blank override must fall back, not resolve to an empty path');
});
