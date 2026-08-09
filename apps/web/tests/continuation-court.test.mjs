/**
 * SOVEREIGN CONTINUATION KERNEL — database court.
 *
 * The laws that only a real database can prove, proven on a real database:
 *
 *  C1 EXACTLY-ONCE: two ticks racing on the same due trigger fire it once.
 *  C2 RESTART SURVIVAL: a trigger created by one process fires in a FRESH
 *     process with a cold import cache — the conversation/model/machine that
 *     created it is irrelevant. The database owns the future.
 *  C3 EXPIRED NEVER FIRES, durably.
 *  C4 DEPENDENCY gating resolves from durable state across ticks.
 *  C5 REJECTED SPECS NEVER REACH THE TABLE (no stop condition -> no row).
 *  C6 NO SELF-RAISED AUTHORITY, enforced at the write boundary.
 *  C7 EFFECTFUL work does not fire until explicitly APPROVED.
 *  C8 RECURRENCE IS FINITE: a remaining=1 policy fires exactly twice, ever.
 *  C9 RECEIPTS ARE TAMPER-EVIDENT: editing history breaks the hash chain.
 *
 * ISOLATION: uniquely named disposable PostgreSQL databases on the loopback
 * server, created in before() and dropped WITH (FORCE) in after() — the
 * pattern proven in tests/migration-court.test.mjs.
 *
 * PORTABILITY NOTE (deliberate): this court applies the kernel's own
 * migration (20260809170000_continuation_kernel) directly, NOT `migrate
 * deploy` — the kernel is standalone-by-design on bare PostgreSQL and must
 * never acquire a PostGIS dependency. Full migration-lane integration
 * (baseline + geo + kernel via `migrate deploy`) is covered by the existing
 * migration court in environments with PostGIS installed.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMission,
  createTrigger,
  approveTrigger,
  runTick,
  verifyReceiptChain,
} from '../src/lib/continuation/continuation-repository.mjs';

const REPO_WEB = fileURLToPath(new URL('..', import.meta.url));
const KERNEL_MIGRATION = join(
  REPO_WEB, 'prisma', 'migrations', '20260809170000_continuation_kernel', 'migration.sql',
);

const PG_HOST = 'postgresql://postgres@127.0.0.1:5432';
const PG_ADMIN_URL = `${PG_HOST}/postgres`;

function prismaCliPath() {
  for (let dir = REPO_WEB; ; dir = dirname(dir)) {
    const c = join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (existsSync(c)) return c;
    if (dirname(dir) === dir) throw new Error('prisma CLI not found');
  }
}

function prisma_(args, env = {}, stdin) {
  return execFileSync(process.execPath, [prismaCliPath(), ...args], {
    cwd: REPO_WEB, encoding: 'utf8', timeout: 240_000, stdio: 'pipe',
    ...(stdin === undefined ? {} : { input: stdin }),
    env: { ...process.env, ...env },
  });
}

const createdDbs = [];
function createDatabase(label = '') {
  const name = `contkernel_${label ? `${label}_` : ''}${randomBytes(6).toString('hex')}`;
  prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `CREATE DATABASE "${name}";`);
  createdDbs.push(name);
  const url = `${PG_HOST}/${name}`;
  prisma_(['db', 'execute', '--url', url, '--file', KERNEL_MIGRATION]);
  return { name, url };
}

const clients = [];
async function client(url) {
  const { PrismaClient } = await import('@prisma/client');
  const c = new PrismaClient({ datasources: { db: { url } } });
  clients.push(c);
  return c;
}

const TENANT = 'orderweeddc.com';
const HOUR = 60 * 60 * 1000;

function missionSpec(overrides = {}) {
  return {
    tenant: TENANT,
    purpose: 'court fixture mission',
    createdFrom: 'CONTINUATION_COURT',
    authorityCeiling: 'OBSERVE_ONLY',
    budgetCentsMax: 1000,
    stopCondition: 'court run completes',
    ...overrides,
  };
}

function triggerSpec(missionId, overrides = {}) {
  const now = Date.now();
  return {
    missionId,
    tenant: TENANT,
    triggerType: 'SCHEDULED',
    reason: 'court fixture trigger',
    createdFrom: 'CONTINUATION_COURT',
    stopCondition: 'fires once',
    budgetCentsMax: 100,
    authorityCeiling: 'OBSERVE_ONLY',
    nextEligibleAt: new Date(now - 1000), // already due
    expiresAt: new Date(now + 24 * HOUR),
    ...overrides,
  };
}

let db;
let prisma;

before(async () => {
  db = createDatabase('court');
  prisma = await client(db.url);
});

after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  for (const name of createdDbs) {
    try {
      prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
    } catch { /* best effort */ }
  }
});

test('C1: a due trigger fires EXACTLY ONCE across a tick and a replayed tick', async () => {
  const mission = await createMission(prisma, missionSpec());
  const trigger = await createTrigger(prisma, triggerSpec(mission.id));

  const tick1 = await runTick(prisma, { tickId: 'tick-A' });
  assert.deepEqual(tick1.fired, [trigger.id]);

  const tick2 = await runTick(prisma, { tickId: 'tick-B' });
  assert.deepEqual(tick2.fired, [], 'a FIRED trigger must never fire again');

  const firedReceipts = await prisma.continuationReceipt.count({
    where: { triggerId: trigger.id, action: 'FIRED' },
  });
  assert.equal(firedReceipts, 1);
});

test('C1b: two ticks racing CONCURRENTLY fire the trigger exactly once', async () => {
  const mission = await createMission(prisma, missionSpec());
  const trigger = await createTrigger(prisma, triggerSpec(mission.id));
  const clientB = await client(db.url);

  const [r1, r2] = await Promise.all([
    runTick(prisma, { tickId: 'race-1' }),
    runTick(clientB, { tickId: 'race-2' }),
  ]);
  const totalFired = r1.fired.filter((id) => id === trigger.id).length
    + r2.fired.filter((id) => id === trigger.id).length;
  assert.equal(totalFired, 1, `exactly one racer may win, got ${totalFired}`);

  const firedReceipts = await prisma.continuationReceipt.count({
    where: { triggerId: trigger.id, action: 'FIRED' },
  });
  assert.equal(firedReceipts, 1);
});

test('C2: RESTART SURVIVAL — a fresh process with a cold cache fires a trigger it never created', async () => {
  const mission = await createMission(prisma, missionSpec());
  const trigger = await createTrigger(prisma, triggerSpec(mission.id));

  // A genuinely separate node process: new import cache, new client, nothing
  // shared with the creator but the database. This is the machine-restart /
  // conversation-ended / different-model case.
  const snippet = `
    import { runTick } from ${JSON.stringify(new URL('../src/lib/continuation/continuation-repository.mjs', import.meta.url).href)};
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: ${JSON.stringify(db.url)} } } });
    const summary = await runTick(prisma, { tickId: 'fresh-process-tick' });
    console.log(JSON.stringify(summary.fired));
    await prisma.$disconnect();
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', snippet], {
    cwd: REPO_WEB, encoding: 'utf8', timeout: 120_000,
  });
  const fired = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.ok(fired.includes(trigger.id), `fresh process must fire the durable trigger: ${stdout}`);

  const row = await prisma.continuationTrigger.findUnique({ where: { id: trigger.id } });
  assert.equal(row.status, 'FIRED');
});

test('C3: a due-but-expired trigger EXPIRES durably and never fires', async () => {
  const mission = await createMission(prisma, missionSpec());
  // createTrigger refuses past expiry (L1), so arm a valid trigger and let
  // the clock pass its expiry: tick with an injected future `now`.
  const trigger = await createTrigger(prisma, triggerSpec(mission.id, {
    nextEligibleAt: new Date(Date.now() + 1 * HOUR),
    expiresAt: new Date(Date.now() + 2 * HOUR),
  }));

  const farFuture = new Date(Date.now() + 3 * HOUR); // due AND past expiry
  const tick = await runTick(prisma, { tickId: 'expiry-tick', now: farFuture });
  assert.ok(tick.expired.includes(trigger.id));
  assert.equal(tick.fired.includes(trigger.id), false, 'expired must never fire');

  const row = await prisma.continuationTrigger.findUnique({ where: { id: trigger.id } });
  assert.equal(row.status, 'EXPIRED');
  const firedReceipts = await prisma.continuationReceipt.count({ where: { triggerId: trigger.id, action: 'FIRED' } });
  assert.equal(firedReceipts, 0);
});

test('C4: DEPENDENCY fires only after its dependency has durably FIRED', async () => {
  const mission = await createMission(prisma, missionSpec());
  const upstream = await createTrigger(prisma, triggerSpec(mission.id));
  const downstream = await createTrigger(prisma, triggerSpec(mission.id, {
    triggerType: 'DEPENDENCY',
    dependsOnTriggerId: upstream.id,
    nextEligibleAt: undefined,
  }));

  const tick1 = await runTick(prisma, { tickId: 'dep-tick-1' });
  assert.ok(tick1.fired.includes(upstream.id));
  assert.equal(tick1.fired.includes(downstream.id), false, 'dependency unmet at evaluation time must wait');

  const tick2 = await runTick(prisma, { tickId: 'dep-tick-2' });
  assert.ok(tick2.fired.includes(downstream.id), 'dependency satisfied in durable state must fire');
});

test('C5: a spec with no stop condition NEVER reaches the table', async () => {
  const mission = await createMission(prisma, missionSpec());
  const beforeCount = await prisma.continuationTrigger.count();
  await assert.rejects(
    () => createTrigger(prisma, triggerSpec(mission.id, { stopCondition: '' })),
    /stopCondition/,
  );
  assert.equal(await prisma.continuationTrigger.count(), beforeCount);
});

test('C6: a trigger cannot exceed its mission authority ceiling — no self-raised authority', async () => {
  const mission = await createMission(prisma, missionSpec({ authorityCeiling: 'OBSERVE_ONLY' }));
  await assert.rejects(
    () => createTrigger(prisma, triggerSpec(mission.id, { authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' })),
    /exceeds mission ceiling/,
  );
});

test('C6b: a trigger cannot cross tenant or mission budget boundaries', async () => {
  const mission = await createMission(prisma, missionSpec({ budgetCentsMax: 100 }));
  await assert.rejects(
    () => createTrigger(prisma, triggerSpec(mission.id, { tenant: 'other.example' })),
    /tenant .* does not match mission tenant/,
  );
  await assert.rejects(
    () => createTrigger(prisma, triggerSpec(mission.id, { budgetCentsMax: 101 })),
    /budget ceiling .* exceeds mission budget ceiling/,
  );
});

test('C6c: a dependency cannot point across mission or tenant authority boundaries', async () => {
  const missionA = await createMission(prisma, missionSpec());
  const missionB = await createMission(prisma, missionSpec());
  const triggerA = await createTrigger(prisma, triggerSpec(missionA.id));
  await assert.rejects(
    () => createTrigger(prisma, triggerSpec(missionB.id, {
      triggerType: 'DEPENDENCY', dependsOnTriggerId: triggerA.id, nextEligibleAt: undefined,
    })),
    /dependency must belong to the same mission and tenant/,
  );
});

test('C7: EFFECTFUL work is born PENDING_APPROVAL, ignored by ticks, and fires only after approval', async () => {
  const mission = await createMission(prisma, missionSpec({ authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  const trigger = await createTrigger(prisma, triggerSpec(mission.id, { authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  assert.equal(trigger.status, 'PENDING_APPROVAL');

  const tick1 = await runTick(prisma, { tickId: 'unapproved-tick' });
  assert.equal(tick1.fired.includes(trigger.id), false, 'unapproved effectful work must never fire');

  const approval = await approveTrigger(prisma, { triggerId: trigger.id, approvedBy: 'owner', tickId: 'approval-1' });
  assert.equal(approval.approved, true);

  const tick2 = await runTick(prisma, { tickId: 'approved-tick' });
  assert.ok(tick2.fired.includes(trigger.id));

  const actions = (await prisma.continuationReceipt.findMany({
    where: { triggerId: trigger.id }, orderBy: { seq: 'asc' }, select: { action: true },
  })).map((r) => r.action);
  assert.deepEqual(actions, ['APPROVED', 'FIRED']);
});

test('C8: RECURRENCE IS FINITE — remaining=1 fires exactly twice, ever', async () => {
  const mission = await createMission(prisma, missionSpec());
  const trigger = await createTrigger(prisma, triggerSpec(mission.id, {
    continuationPolicy: JSON.stringify({ kind: 'RESCHEDULE', intervalMs: 1, remaining: 1 }),
  }));

  const tick1 = await runTick(prisma, { tickId: 'recur-1' });
  assert.ok(tick1.fired.includes(trigger.id));
  assert.equal(tick1.successors.length, 1);

  await new Promise((r) => setTimeout(r, 10)); // let the 1ms successor come due
  const tick2 = await runTick(prisma, { tickId: 'recur-2' });
  assert.ok(tick2.fired.includes(tick1.successors[0]));
  assert.equal(tick2.successors.length, 0, 'remaining exhausted — no further successor');

  const tick3 = await runTick(prisma, { tickId: 'recur-3' });
  assert.deepEqual(tick3.fired, []);
  const lineage = await prisma.continuationTrigger.count({ where: { missionId: mission.id } });
  assert.equal(lineage, 2, 'exactly two triggers ever existed in this lineage');
});

test('C9: receipts are TAMPER-EVIDENT — editing history breaks the chain', async () => {
  const mission = await createMission(prisma, missionSpec());
  await createTrigger(prisma, triggerSpec(mission.id));
  await runTick(prisma, { tickId: 'chain-tick' });

  const intact = await verifyReceiptChain(prisma, mission.id);
  assert.equal(intact.ok, true, JSON.stringify(intact));
  assert.ok(intact.length >= 1);

  const first = await prisma.continuationReceipt.findFirst({ where: { missionId: mission.id }, orderBy: { seq: 'asc' } });
  await prisma.continuationReceipt.update({ where: { id: first.id }, data: { detail: 'history, rewritten' } });

  const tampered = await verifyReceiptChain(prisma, mission.id);
  assert.equal(tampered.ok, false, 'a rewritten receipt must break the chain');
  assert.equal(tampered.brokenAtSeq, first.seq);
});

test('C9b: deleting or reordering receipt history is detected', async () => {
  const deletionMission = await createMission(prisma, missionSpec({ authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  const deletionTrigger = await createTrigger(prisma, triggerSpec(deletionMission.id, { authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  await approveTrigger(prisma, { triggerId: deletionTrigger.id, approvedBy: 'owner', tickId: 'delete-approval' });
  await runTick(prisma, { tickId: 'delete-fire' });
  const deletionRows = await prisma.continuationReceipt.findMany({
    where: { missionId: deletionMission.id }, orderBy: { seq: 'asc' },
  });
  assert.equal(deletionRows.length, 2);
  await prisma.continuationReceipt.delete({ where: { id: deletionRows[0].id } });
  assert.equal((await verifyReceiptChain(prisma, deletionMission.id)).ok, false, 'deleted history must break the chain');

  const reorderMission = await createMission(prisma, missionSpec({ authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  const reorderTrigger = await createTrigger(prisma, triggerSpec(reorderMission.id, { authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  await approveTrigger(prisma, { triggerId: reorderTrigger.id, approvedBy: 'owner', tickId: 'reorder-approval' });
  await runTick(prisma, { tickId: 'reorder-fire' });
  const reorderRows = await prisma.continuationReceipt.findMany({
    where: { missionId: reorderMission.id }, orderBy: { seq: 'asc' },
  });
  await prisma.continuationReceipt.update({ where: { id: reorderRows[0].id }, data: { seq: 1000 } });
  await prisma.continuationReceipt.update({ where: { id: reorderRows[1].id }, data: { seq: 1 } });
  await prisma.continuationReceipt.update({ where: { id: reorderRows[0].id }, data: { seq: 2 } });
  assert.equal((await verifyReceiptChain(prisma, reorderMission.id)).ok, false, 'reordered history must break the chain');
});

test('C10: firing state and its truth receipt commit atomically', async () => {
  const mission = await createMission(prisma, missionSpec());
  const trigger = await createTrigger(prisma, triggerSpec(mission.id));
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION refuse_continuation_receipt() RETURNS trigger AS $$
    BEGIN
      IF NEW."tickId" = 'receipt-failure' THEN RAISE EXCEPTION 'injected receipt failure'; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER continuation_receipt_failure BEFORE INSERT ON "ContinuationReceipt"
    FOR EACH ROW EXECUTE FUNCTION refuse_continuation_receipt();
  `);
  try {
    await assert.rejects(() => runTick(prisma, { tickId: 'receipt-failure' }), /injected receipt failure/);
    const after = await prisma.continuationTrigger.findUnique({ where: { id: trigger.id } });
    assert.equal(after.status, 'ARMED', 'a missing receipt must roll back the firing projection');
    assert.equal(await prisma.continuationReceipt.count({ where: { triggerId: trigger.id } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS continuation_receipt_failure ON "ContinuationReceipt";');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS refuse_continuation_receipt();');
  }
});

test('C10b: approval state and its truth receipt commit atomically', async () => {
  const mission = await createMission(prisma, missionSpec({ authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  const trigger = await createTrigger(prisma, triggerSpec(mission.id, { authorityCeiling: 'EFFECTFUL_WITH_APPROVAL' }));
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION refuse_continuation_approval() RETURNS trigger AS $$
    BEGIN
      IF NEW."tickId" = 'approval-failure' THEN RAISE EXCEPTION 'injected approval receipt failure'; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER continuation_approval_failure BEFORE INSERT ON "ContinuationReceipt"
    FOR EACH ROW EXECUTE FUNCTION refuse_continuation_approval();
  `);
  try {
    await assert.rejects(
      () => approveTrigger(prisma, { triggerId: trigger.id, approvedBy: 'owner', tickId: 'approval-failure' }),
      /injected approval receipt failure/,
    );
    const after = await prisma.continuationTrigger.findUnique({ where: { id: trigger.id } });
    assert.equal(after.status, 'PENDING_APPROVAL', 'a missing approval receipt must roll back arming');
    assert.equal(await prisma.continuationReceipt.count({ where: { triggerId: trigger.id } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS continuation_approval_failure ON "ContinuationReceipt";');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS refuse_continuation_approval();');
  }
});
