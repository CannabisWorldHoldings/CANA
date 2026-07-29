import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDemandCredits, hashBody, GENESIS_HASH } from '../src/lib/demand-credits.mjs';
import { mintPageChallenge, verifyPageChallenge, gradeHandoff } from '../src/lib/page-challenge.mjs';
import {
  BASELINE_MIGRATION_NAME,
  databaseProviderOf,
  migrationsOnDisk,
  readMigrationRows,
  ensureDatabaseMigrated,
  withMigrationLock,
  databaseHealth,
  databaseReadiness,
  initializeDatabaseConfig,
} from '../src/lib/db-config.mjs';
import { environmentRefusalsForSeed, dataRefusalsForSeed } from '../prisma/seed-safety.mjs';

/**
 * MIGRATION COURT — the machinery that takes this schema to a production
 * database, tried on ISOLATED databases it creates and destroys itself.
 *
 * THE GAP THIS COURT EXISTS FOR. Until now there were NO migrations: the schema
 * had only ever been applied with `prisma db push`, which keeps no history and
 * therefore cannot deploy, cannot roll back, and cannot even say what a given
 * database has had applied. This suite proves the new machinery — baseline +
 * incremental migrations, locking, idempotent init, health/readiness, and the
 * seed-safety refusal — does what a production cutover requires.
 *
 * PROVIDER HONESTY, stated once for the whole file: every EXECUTED proof below
 * runs on SQLite, because that is the substrate that exists in this repo. The
 * portability canary proves the one schema GENERATES valid MySQL (MariaDB) and
 * PostgreSQL DDL; it does not prove that DDL applies to a live MariaDB 11.4.9.
 * Tests never claim otherwise.
 *
 * ISOLATION (per tests/README-ISOLATION.md): every database here lives in a
 * fresh temp directory under os.tmpdir(); prisma/dev.db is never touched.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(WEB, 'prisma', 'schema.prisma');
const MIGRATIONS = path.join(WEB, 'prisma', 'migrations');
const SECOND_MIGRATION = '20260726000100_ledger_recorded_at_index';
const NEW_INDEX = 'DemandCreditEntry_merchantId_recordedAt_idx';

function prismaCliPath() {
  for (let dir = WEB; ; dir = path.dirname(dir)) {
    const c = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(c)) return c;
    if (path.dirname(dir) === dir) throw new Error('prisma CLI not found');
  }
}
const PRISMA_CLI = prismaCliPath();

function prisma_(args, env = {}) {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: WEB, encoding: 'utf8', timeout: 240_000, stdio: 'pipe',
    env: { ...process.env, ...env },
  });
}

let BASE;
const clients = [];
before(() => { BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-court-')); });
after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  if (BASE) fs.rmSync(BASE, { recursive: true, force: true });
});

/** Stage a schema + a SUBSET of migrations in a scratch dir, so an "older
 *  schema" is a real, deployable migration set rather than a hand-built fake. */
function stage(name, migrationNames) {
  const dir = path.join(BASE, `stage-${name}`);
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  fs.copyFileSync(SCHEMA, path.join(dir, 'schema.prisma'));
  fs.copyFileSync(path.join(MIGRATIONS, 'migration_lock.toml'), path.join(dir, 'migrations', 'migration_lock.toml'));
  for (const m of migrationNames) {
    fs.mkdirSync(path.join(dir, 'migrations', m), { recursive: true });
    fs.copyFileSync(path.join(MIGRATIONS, m, 'migration.sql'), path.join(dir, 'migrations', m, 'migration.sql'));
  }
  return { schema: path.join(dir, 'schema.prisma'), dir };
}

function deploy(dbPath, schemaPath = SCHEMA) {
  return prisma_(['migrate', 'deploy', '--schema', schemaPath], { DATABASE_URL: `file:${dbPath}` });
}

async function client(dbPath) {
  const { PrismaClient } = await import('@prisma/client');
  const c = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  clients.push(c);
  return c;
}

async function indexExists(p, name) {
  const r = await p.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='index' AND name='${name}'`);
  return Array.isArray(r) && r.length > 0;
}

const future = () => new Date(Date.now() + 30 * 86400_000);
const MERCHANT_A = 'court_merchant_alpha';
const MERCHANT_B = 'court_merchant_beta';
const REPLAY_NONCE = randomBytes(16).toString('hex');

/** Populate a REPRESENTATIVE database: two tenants, demonstration AND real
 *  provenance rows, users beyond the demo trio, lead events, and hash-chained
 *  ledgers for two merchants including a value-bearing attribution that
 *  carries an interaction nonce (the replay-protection record). */
async function populate(p) {
  const org = await p.organization.create({ data: { name: 'Court Holding' } });
  const brandA = await p.brand.create({ data: { name: 'court-a', domain: 'court-a.localhost', organizationId: org.id } });
  const brandB = await p.brand.create({ data: { name: 'court-b', domain: 'court-b.localhost', organizationId: org.id } });
  await p.user.create({ data: { email: 'real.owner@example.com', password: 'x'.repeat(60), role: 'ADMIN' } });

  const demoRet = await p.retailer.create({
    data: {
      name: 'Court Demo Retailer', address: '1 Demo Way', lat: 38.9, lng: -77.0,
      dataStatus: 'DEMONSTRATION_ONLY', dataSource: 'court seed', isDemonstration: true,
    },
  });
  const realRet = await p.retailer.create({
    data: {
      name: 'Court Real Retailer', address: '2 Real Way', lat: 38.91, lng: -77.01,
      dataStatus: 'VERIFIED_CURRENT', dataSource: 'court fixture', isDemonstration: false,
      retrievedAt: new Date(), verifiedAt: new Date(), confidence: 0.97,
    },
  });
  const prod = await p.product.create({ data: { name: 'Court Product', category: 'flower', isDemonstration: false, dataStatus: 'VERIFIED_CURRENT' } });
  await p.menuEntry.create({ data: { retailerId: realRet.id, productId: prod.id, price: 41.5, isDemonstration: false, dataStatus: 'VERIFIED_CURRENT' } });
  await p.leadEvent.create({ data: { brandId: brandA.id, retailerId: realRet.id, eventType: 'HANDOFF_CLICK' } });
  await p.leadEvent.create({ data: { brandId: brandB.id, retailerId: demoRet.id, eventType: 'MENU_VIEW' } });

  const credits = createDemandCredits(p);
  for (const m of [MERCHANT_A, MERCHANT_B]) {
    assert.equal((await credits.issue({ merchantId: m, amount: 500, authorizationRef: `PO-${m}`, expiresAt: future() })).accepted, true);
    assert.equal((await credits.spend({ merchantId: m, amount: 120, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored' })).accepted, true);
  }
  // The replay-protection record: a verified handoff attribution carrying the
  // page-challenge nonce, exactly as the handoff route writes it.
  const att = await credits.attribute({
    merchantId: MERCHANT_A, actionKind: 'HANDOFF',
    evidenceChain: [{ step: 'page_challenge_verified', ref: 'court-render-1' }, { step: 'destination_verified', ref: 'https://merchant.example/menu' }],
    observedAt: new Date(), idempotencyKey: REPLAY_NONCE,
    proofState: 'MERCHANT_HANDOFF_VERIFIED', valueEligible: true,
    interactionNonce: REPLAY_NONCE, destination: 'https://merchant.example/menu',
  });
  assert.equal(att.accepted, true, `populate: attribution refused: ${JSON.stringify(att)}`);
  const attB = await credits.attribute({
    merchantId: MERCHANT_B, actionKind: 'PHONE_CLICK',
    evidenceChain: [{ step: 'page_challenge_verified', ref: 'court-render-2' }],
    observedAt: new Date(), proofState: 'PAGE_INTERACTION_VERIFIED', valueEligible: true,
  });
  assert.equal(attB.accepted, true);
  return { credits };
}

/** Logical snapshot used to prove preservation across migration/restore. */
async function snapshot(p) {
  const credits = createDemandCredits(p);
  const [chainA, chainB] = [await credits.verifyChain(MERCHANT_A), await credits.verifyChain(MERCHANT_B)];
  return {
    retailers: await p.retailer.count(),
    demoRows: await p.retailer.count({ where: { isDemonstration: true } }),
    realRows: await p.retailer.count({ where: { isDemonstration: false } }),
    users: await p.user.count(),
    leadEvents: await p.leadEvent.count(),
    ledger: await p.demandCreditEntry.count(),
    balanceA: await credits.balance(MERCHANT_A),
    chainAValid: chainA.valid, chainAHead: chainA.head,
    chainBValid: chainB.valid, chainBHead: chainB.head,
    demoStatus: (await p.retailer.findFirst({ where: { isDemonstration: true } }))?.dataStatus,
    realStatus: (await p.retailer.findFirst({ where: { isDemonstration: false } }))?.dataStatus,
  };
}

/* ────────────────────────── 0. PORTABILITY CANARY ────────────────────────── */

test('PORTABILITY CANARY: the one schema generates valid DDL for sqlite, mysql (MariaDB) and postgresql', () => {
  // PROVES: generation only. Applying the mysql DDL to a live MariaDB 11.4.9
  // is ARGUED until an instance exists, and nothing in this repo claims it.
  const outDir = path.join(BASE, 'ddl');
  fs.mkdirSync(outDir, { recursive: true });
  const src = fs.readFileSync(SCHEMA, 'utf8');
  // Comments legitimately DISCUSS @db. (the audit lives there); code must not USE it.
  const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('//'));
  assert.ok(codeLines.every((l) => !l.includes('@db.')), 'schema must stay free of provider-native @db. attributes');
  assert.ok(!/^enum\s/m.test(src), 'schema must stay free of enums — string domains are the portable choice already made');

  const ddl = {};
  for (const provider of ['mysql', 'postgresql']) {
    const swapped = src.replace('provider = "sqlite"', `provider = "${provider}"`);
    assert.notEqual(swapped, src, 'provider swap anchor must match');
    const p = path.join(outDir, `schema-${provider}.prisma`);
    fs.writeFileSync(p, swapped);
    ddl[provider] = prisma_(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', p, '--script']);
  }
  // The idempotency constraint must exist on every provider.
  assert.match(ddl.mysql, /UNIQUE INDEX `DemandCreditEntry_merchantId_eventIdentity_key`/);
  assert.match(ddl.postgresql, /CREATE UNIQUE INDEX "DemandCreditEntry_merchantId_eventIdentity_key"/);
  // Millisecond DateTime precision is load-bearing for the hash chain.
  assert.match(ddl.mysql, /`observedAt` DATETIME\(3\)/);
  assert.match(ddl.postgresql, /"observedAt" TIMESTAMP\(3\)/);
  // The audited MySQL hazard is REAL and stays visible: String → VARCHAR(191),
  // including evidenceChain, which MUST become @db.Text at MariaDB cutover.
  assert.match(ddl.mysql, /`evidenceChain` VARCHAR\(191\)/,
    'if this stops matching, the cutover schema fixed it — update the audit');
});

/* ─────────────────────── 1. FORWARD FROM EMPTY ───────────────────────────── */

test('forward migration from EMPTY: deploy applies every migration and records it', async () => {
  const db = path.join(BASE, 'empty.db');
  deploy(db);
  const p = await client(db);
  const rows = await readMigrationRows(p);
  assert.ok(rows, '_prisma_migrations must exist after deploy');
  assert.deepEqual(rows.map((r) => r.migration_name).sort(), migrationsOnDisk(MIGRATIONS),
    'every on-disk migration is recorded');
  assert.ok(rows.every((r) => r.finished_at != null), 'every migration finished');
  assert.ok(await indexExists(p, NEW_INDEX), 'second migration applied');
  // The schema is genuinely usable, not merely recorded.
  await p.organization.create({ data: { name: 'smoke' } });
  assert.equal(await p.organization.count(), 1);
});

test('readiness is HONEST on a fresh deploy: not ready until WAL is initialized, ready after', async () => {
  // A DEDICATED database with exactly ONE client. Switching a SQLite file into
  // WAL while another connection holds it open is not guaranteed to persist
  // file-wide — the first version of this test shared empty.db with the
  // previous test's still-open client and flaked under full-suite load.
  const db = path.join(BASE, 'readiness.db');
  deploy(db);
  const p = await client(db);
  const beforeInit = await databaseReadiness(p, { provider: 'sqlite' });
  const walCheck = beforeInit.checks.find((c) => c.name === 'sqlite_journal_mode_wal');
  assert.ok(walCheck, 'readiness must include the WAL check for sqlite');
  assert.equal(walCheck.pass, false, 'a fresh database has journal_mode=delete — readiness must say so');
  assert.equal(beforeInit.ready, false);

  const init = await initializeDatabaseConfig(p);
  assert.equal(init.ok, true, JSON.stringify({ failures: init.failures, mismatches: init.mismatches }));
  const afterInit = await databaseReadiness(p, { provider: 'sqlite' });
  assert.equal(afterInit.ready, true, JSON.stringify(afterInit.checks));
  assert.ok(afterInit.checks.every((c) => c.pass));
  await p.$disconnect();
});

test('health check answers with latency on a live database and failure on a dead one', async () => {
  const db = path.join(BASE, 'health.db');
  deploy(db);
  const live = await client(db);
  const h = await databaseHealth(live);
  assert.equal(h.healthy, true);
  assert.equal(typeof h.latencyMs, 'number');
  await live.$disconnect();

  const dead = await client(path.join(BASE, 'no-such-dir', 'nested', 'gone.db'));
  const d = await databaseHealth(dead);
  assert.equal(d.healthy, false);
  assert.ok(d.error, 'a dead database must be reported with its error, not a bare false');
});

/* ─────────── 2. OLDER SCHEMA, POPULATED → FORWARD MIGRATION ─────────────── */

let popDb, popSnapBefore, backupPath;

test('a POPULATED database on the OLDER schema migrates forward without losing anything', async () => {
  popDb = path.join(BASE, 'populated.db');
  const older = stage('older', [BASELINE_MIGRATION_NAME]); // schema version N-1, genuinely deployed
  deploy(popDb, older.schema);

  const p = await client(popDb);
  assert.equal(await indexExists(p, NEW_INDEX), false, 'older schema must NOT have the new index yet');
  await populate(p);
  popSnapBefore = await snapshot(p);
  assert.equal(popSnapBefore.chainAValid, true);
  await p.$disconnect();

  // The restore fixture: a byte-copy backup taken BEFORE migrating.
  backupPath = path.join(BASE, 'populated.pre-migration.backup.db');
  fs.copyFileSync(popDb, backupPath);

  deploy(popDb); // full migration set — forward migration of an older, populated database
  const q = await client(popDb);
  assert.equal(await indexExists(q, NEW_INDEX), true, 'forward migration must add the index');
  const after = await snapshot(q);
  assert.deepEqual(after, popSnapBefore, 'logical content must be byte-for-byte preserved by the migration');
});

test('TRUTH-STATUS preservation: migration re-grades nothing', async () => {
  const p = await client(popDb);
  assert.equal(popSnapBefore.demoStatus, 'DEMONSTRATION_ONLY');
  assert.equal(popSnapBefore.realStatus, 'VERIFIED_CURRENT');
  assert.equal((await p.retailer.findFirst({ where: { isDemonstration: true } })).dataStatus, 'DEMONSTRATION_ONLY');
  assert.equal((await p.retailer.findFirst({ where: { isDemonstration: false } })).dataStatus, 'VERIFIED_CURRENT');
  // Migration introduced no demonstration rows and promoted none.
  assert.equal(await p.retailer.count({ where: { isDemonstration: true } }), popSnapBefore.demoRows);
  assert.equal(await p.retailer.count({ where: { isDemonstration: false } }), popSnapBefore.realRows);
});

test('LEDGER CHAIN integrity is preserved: every entry re-hashes to its recorded digest after migration', async () => {
  const p = await client(popDb);
  const credits = createDemandCredits(p);
  for (const m of [MERCHANT_A, MERCHANT_B]) {
    const v = await credits.verifyChain(m);
    assert.equal(v.valid, true, `chain for ${m}: ${JSON.stringify(v)}`);
  }
  // Belt and braces: recompute one entry by hand so a verifyChain bug cannot
  // vacuously pass this court. hashBody takes prevHash as its SECOND argument.
  const rows = await p.demandCreditEntry.findMany({ where: { merchantId: MERCHANT_A }, orderBy: { seq: 'asc' } });
  let prev = GENESIS_HASH;
  for (const e of rows) {
    assert.equal(hashBody(e, prev), e.entryHash, `manual re-hash of seq=${e.seq} must match — DateTime values must round-trip the migration exactly`);
    prev = e.entryHash;
  }
});

test('the DUPLICATE-EVENT constraint still holds after migration — and NULL identities behave as designed', async () => {
  const p = await client(popDb);
  const identity = createHash('sha256').update('court-dup-event').digest('hex');
  const mk = (seq, extra) => p.demandCreditEntry.create({
    data: {
      merchantId: 'court_dup_merchant', seq, id: randomUUID(), kind: 'ATTRIBUTION', amount: 0,
      prevHash: 'p'.repeat(64), entryHash: randomUUID() + seq, ...extra,
    },
  });
  await mk(0, { eventIdentity: identity });
  // Same merchant + same identity: the DATABASE must refuse (P2002), because
  // this is the constraint the application's fast-path lookup is NOT.
  await assert.rejects(() => mk(1, { eventIdentity: identity }), (e) => e?.code === 'P2002',
    'duplicate (merchantId, eventIdentity) must be refused by the database');
  // Same identity, DIFFERENT merchant: allowed — tenant-scoped by construction.
  await p.demandCreditEntry.create({
    data: {
      merchantId: 'court_dup_merchant_2', seq: 0, id: randomUUID(), kind: 'ATTRIBUTION', amount: 0,
      prevHash: 'p'.repeat(64), entryHash: randomUUID() + 'x', eventIdentity: identity,
    },
  });
  // NULL identities: money rows carry eventIdentity=NULL and MANY of them must
  // coexist per merchant. SQLite, MySQL/InnoDB and PostgreSQL (default) all
  // treat NULLs as distinct in unique indexes, so the schema's reliance on
  // this is portable — PROVEN here on sqlite, argued from documented
  // semantics for the others.
  await mk(2, { kind: 'ISSUE', amount: 10, eventIdentity: null });
  await mk(3, { kind: 'SPEND', amount: -5, eventIdentity: null });
  assert.equal(await p.demandCreditEntry.count({ where: { merchantId: 'court_dup_merchant', eventIdentity: null } }), 2);
  // The uncomfortable truth, demonstrated rather than hidden: the DATABASE will
  // also accept a NULL-identity ATTRIBUTION row — the unique index is blind to
  // it. So the idempotency guarantee does NOT rest on NULL semantics: it rests
  // on the constraint FOR non-null identities plus the fail-closed guard in
  // demand-credits.mjs append() (EVENT_IDENTITY_REQUIRED), which refuses to
  // create such a row through the application. Both halves are needed; this
  // court proves the constraint half and pins the DB behaviour the guard
  // half exists to compensate for.
  await mk(4, { kind: 'ATTRIBUTION', eventIdentity: null });
  await mk(5, { kind: 'ATTRIBUTION', eventIdentity: null });
  assert.equal(
    await p.demandCreditEntry.count({ where: { merchantId: 'court_dup_merchant', kind: 'ATTRIBUTION', eventIdentity: null } }),
    2,
    'the DB accepts duplicate NULL-identity attributions — this is WHY the application-level fail-closed guard exists',
  );
  await p.demandCreditEntry.deleteMany({ where: { merchantId: { in: ['court_dup_merchant', 'court_dup_merchant_2'] } } });
});

test('ATTRIBUTION idempotency is preserved: sequential duplicate refused, concurrent duplicate adjudicated by the database', async () => {
  const p = await client(popDb);
  const credits = createDemandCredits(p);
  const chain = [{ step: 'page_challenge_verified', ref: 'idem-after-migration' }];
  const when = new Date();
  const first = await credits.attribute({ merchantId: MERCHANT_B, actionKind: 'MENU_VIEW', evidenceChain: chain, observedAt: when });
  assert.equal(first.accepted, true);
  const dup = await credits.attribute({ merchantId: MERCHANT_B, actionKind: 'MENU_VIEW', evidenceChain: chain, observedAt: when });
  assert.equal(dup.accepted, false);
  assert.equal(dup.denial_code, 'DUPLICATE_ATTRIBUTION');

  // Concurrency: two identical raw inserts race; the CONSTRAINT decides.
  const identity = createHash('sha256').update('court-concurrent').digest('hex');
  const insert = (seq) => p.demandCreditEntry.create({
    data: {
      merchantId: 'court_race_merchant', seq, id: randomUUID(), kind: 'ATTRIBUTION', amount: 0,
      prevHash: GENESIS_HASH, entryHash: randomUUID() + seq, eventIdentity: identity,
    },
  }).then(() => 'won', (e) => (e?.code === 'P2002' ? 'refused' : Promise.reject(e)));
  const results = await Promise.all([insert(0), insert(1)]);
  assert.deepEqual(results.sort(), ['refused', 'won'], 'exactly one of two concurrent duplicates commits');
  assert.equal(await p.demandCreditEntry.count({ where: { merchantId: 'court_race_merchant' } }), 1);
  await p.demandCreditEntry.deleteMany({ where: { merchantId: 'court_race_merchant' } });
});

test('TENANT ISOLATION is preserved: balances, chains and refund scope stay per-merchant', async () => {
  const p = await client(popDb);
  const credits = createDemandCredits(p);
  assert.equal(await credits.balance(MERCHANT_A), 380); // 500 - 120, untouched by B
  const crossRefund = await credits.refund({ merchantId: MERCHANT_B, amount: 10, reason: 'cross-tenant grab', originalSeq: 1e9 });
  assert.equal(crossRefund.accepted, false);
  // A's SPEND sits at seq=1; B must not be able to refund against it.
  const stolen = await credits.refund({ merchantId: MERCHANT_B, amount: 10, reason: 'steal A spend', originalSeq: 1 });
  // B has its own seq=1 SPEND, so this refunds B's own — verify it never reads A's.
  if (stolen.accepted) {
    assert.equal((await p.demandCreditEntry.findFirst({ where: { merchantId: MERCHANT_B, kind: 'REFUND' } })).merchantId, MERCHANT_B);
  }
  const vA = await credits.verifyChain(MERCHANT_A);
  const vB = await credits.verifyChain(MERCHANT_B);
  assert.ok(vA.valid && vB.valid);
  assert.notEqual(vA.head, vB.head, 'chains are independent per tenant');
});

test('PAGE-CHALLENGE replay protection is preserved across the migration', async () => {
  const p = await client(popDb);
  // The nonce recorded BEFORE the migration is still discoverable by the exact
  // lookup the handoff route performs — the replay record survived.
  const redeemed = await p.demandCreditEntry.findFirst({
    where: { merchantId: MERCHANT_A, kind: 'ATTRIBUTION', interactionNonce: REPLAY_NONCE },
  });
  assert.ok(redeemed, 'the pre-migration nonce record must survive migration');

  // A replayed submission grades as already-redeemed: no value, honestly said.
  const secret = 'court-secret';
  const minted = mintPageChallenge({
    secret, tenant: 'court-a.localhost', merchantId: MERCHANT_A,
    pagePath: `/retailer/${MERCHANT_A}`, actionKind: 'HANDOFF', destination: 'https://merchant.example/menu',
  });
  const verified = verifyPageChallenge({
    secret, challenge: minted.challenge, tenant: 'court-a.localhost', merchantId: MERCHANT_A,
    pagePath: `/retailer/${MERCHANT_A}`, actionKind: 'HANDOFF', destination: 'https://merchant.example/menu',
  });
  assert.equal(verified.valid, true);
  const replay = gradeHandoff({ sameOriginForm: true, destinationVerified: true, challengeResult: verified, alreadyRedeemed: true });
  assert.equal(replay.value_eligible, false, 'a replay must never be value-eligible');
  assert.notEqual(replay.state, 'MERCHANT_HANDOFF_VERIFIED');

  // And the ledger refuses a second recording under the same nonce key.
  const credits = createDemandCredits(p);
  const again = await credits.attribute({
    merchantId: MERCHANT_A, actionKind: 'HANDOFF',
    evidenceChain: [{ step: 'page_challenge_verified', ref: 'court-render-1' }],
    observedAt: new Date(), idempotencyKey: REPLAY_NONCE, interactionNonce: REPLAY_NONCE,
  });
  assert.equal(again.accepted, false);
  assert.equal(again.denial_code, 'DUPLICATE_ATTRIBUTION');
});

test('RESTART after migration: a genuinely fresh process reads the migrated database and the chain verifies', () => {
  const script = `
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient({ datasources: { db: { url: 'file:${popDb}' } } });
      const { createDemandCredits } = await import('${path.join(WEB, 'src/lib/demand-credits.mjs')}');
      const v = await createDemandCredits(p).verifyChain('${MERCHANT_A}');
      const rows = await p.$queryRawUnsafe("SELECT migration_name FROM _prisma_migrations ORDER BY migration_name");
      console.log('__R__' + JSON.stringify({ valid: v.valid, entries: v.entries, migrations: rows.length }));
      await p.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: WEB, encoding: 'utf8', timeout: 120_000 });
  const r = JSON.parse(out.split('\n').find((l) => l.startsWith('__R__')).slice(5));
  assert.equal(r.valid, true);
  assert.ok(r.entries >= 3);
  assert.equal(r.migrations, 2);
});

/* ──────────────── 3. IDEMPOTENT INIT, ADOPTION, LOCKING ─────────────────── */

test('ensureDatabaseMigrated is idempotent: FRESH applies, MIGRATED no-ops', async () => {
  const db = path.join(BASE, 'ensure.db');
  const first = await ensureDatabaseMigrated({ databaseUrl: `file:${db}` });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.state, 'FRESH');
  const second = await ensureDatabaseMigrated({ databaseUrl: `file:${db}` });
  assert.equal(second.ok, true);
  assert.equal(second.state, 'MIGRATED');
  const p = await client(db);
  assert.equal((await readMigrationRows(p)).length, 2, 'running init twice must not duplicate history');
});

test('a DB-PUSH-ERA database (schema, no migration history) is ADOPTED: baselined then migrated forward', async () => {
  // This is the exact state of every existing database in this project: the
  // BASELINE schema is present (that is precisely what db push produced in the
  // pre-migration era), but there is no `_prisma_migrations` bookkeeping.
  // Recreated by executing the baseline DDL directly — same tables, no history.
  const db = path.join(BASE, 'dbpush-era.db');
  prisma_(['db', 'execute', '--file', path.join(MIGRATIONS, BASELINE_MIGRATION_NAME, 'migration.sql'), '--url', `file:${db}`]);
  const p0 = await client(db);
  await p0.organization.create({ data: { name: 'pre-adoption data' } });
  assert.equal(await readMigrationRows(p0), null, 'db push must leave no migration history — that is the gap');
  await p0.$disconnect();

  const r = await ensureDatabaseMigrated({ databaseUrl: `file:${db}` });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, 'DB_PUSH_ERA');
  const p = await client(db);
  const rows = await readMigrationRows(p);
  assert.deepEqual(rows.map((x) => x.migration_name).sort(), [BASELINE_MIGRATION_NAME, SECOND_MIGRATION]);
  assert.equal(await p.organization.count(), 1, 'adoption must not touch data');
  assert.ok(await indexExists(p, NEW_INDEX), 'newer migration applied on top of the baseline');
});

test('MIGRATION LOCK: concurrent critical sections are strictly serialised', async () => {
  const db = path.join(BASE, 'lock-probe.db');
  const log = path.join(BASE, 'lock-log.txt');
  const worker = (tag) => `
    import('${path.join(WEB, 'src/lib/db-config.mjs')}').then(async (m) => {
      const fs = await import('node:fs');
      await m.withMigrationLock('file:${db}', async () => {
        fs.appendFileSync('${log}', 'enter ${tag} ' + Date.now() + '\\n');
        await new Promise((r) => setTimeout(r, 400));
        fs.appendFileSync('${log}', 'exit ${tag} ' + Date.now() + '\\n');
      });
    }).catch((e) => { console.error(e); process.exit(1); });
  `;
  const run = (tag) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', worker(tag)], { cwd: WEB, stdio: 'pipe' });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${tag}: ${err}`))));
  });
  await Promise.all([run('one'), run('two')]);
  const events = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' '));
  assert.equal(events.length, 4);
  // Serialisation: the second 'enter' must come AFTER the first 'exit'.
  assert.equal(events[0][0], 'enter');
  assert.equal(events[1][0], 'exit', `overlap detected: ${JSON.stringify(events)} — the lock did not serialise`);
  assert.equal(events[1][1], events[0][1], 'exit must belong to the same holder that entered');
});

test('CONCURRENT initializers: two simultaneous ensureDatabaseMigrated runs apply each migration exactly once', async () => {
  const db = path.join(BASE, 'concurrent-init.db');
  const worker = `
    import('${path.join(WEB, 'src/lib/db-config.mjs')}').then(async (m) => {
      const r = await m.ensureDatabaseMigrated({ databaseUrl: 'file:${db}' });
      if (!r.ok) { console.error(JSON.stringify(r)); process.exit(2); }
    }).catch((e) => { console.error(e); process.exit(1); });
  `;
  const run = () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', worker], { cwd: WEB, stdio: 'pipe' });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err || `exit ${code}`))));
  });
  await Promise.all([run(), run()]);
  const p = await client(db);
  const rows = await readMigrationRows(p);
  const names = rows.map((r) => r.migration_name).sort();
  assert.deepEqual(names, [BASELINE_MIGRATION_NAME, SECOND_MIGRATION],
    `each migration must appear EXACTLY once, got ${JSON.stringify(names)}`);
});

/* ─────────────── 4. INTERRUPTION, ROLLBACK AND RESTORE ──────────────────── */

test('INTERRUPTED migration: deploy refuses to continue, readiness says why, and the documented recovery works', async () => {
  const db = path.join(BASE, 'interrupted.db');
  const older = stage('interrupted', [BASELINE_MIGRATION_NAME]);
  deploy(db, older.schema);
  const p = await client(db);
  await p.organization.create({ data: { name: 'survives interruption' } });

  // Simulate a migrator killed mid-flight: a started-but-never-finished row.
  // This is exactly what Prisma leaves behind on a crash.
  const checksum = createHash('sha256')
    .update(fs.readFileSync(path.join(MIGRATIONS, SECOND_MIGRATION, 'migration.sql')))
    .digest('hex');
  await p.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ('${randomUUID()}', '${checksum}', NULL, '${SECOND_MIGRATION}', NULL, NULL, '${new Date().toISOString()}', 0)`,
  );

  // 1. deploy must REFUSE — continuing past a half-applied migration is how
  //    databases diverge silently.
  let refusal = null;
  try { deploy(db); } catch (e) { refusal = e; }
  assert.ok(refusal, 'deploy must throw while a failed migration is recorded');
  const refusalText = `${refusal.message ?? ''}${refusal.stdout ?? ''}${refusal.stderr ?? ''}`;
  assert.match(refusalText, /P3009|failed migrations|not finished/i, `unexpected refusal: ${refusalText.slice(0, 400)}`);

  // 2. readiness must name the failure, not just say no.
  const ready = await databaseReadiness(p, { provider: 'sqlite' });
  assert.equal(ready.ready, false);
  const failedCheck = ready.checks.find((c) => c.name === 'no_failed_migrations');
  assert.equal(failedCheck.pass, false);
  assert.match(failedCheck.detail, new RegExp(SECOND_MIGRATION));

  // 3. ensureDatabaseMigrated must fail CLOSED with the recovery steps, and
  //    must not "repair" anything itself.
  const ensure = await ensureDatabaseMigrated({ databaseUrl: `file:${db}` });
  assert.equal(ensure.ok, false);
  assert.equal(ensure.state, 'FAILED_MIGRATION_PRESENT');
  assert.deepEqual(ensure.failed, [SECOND_MIGRATION]);
  assert.ok(ensure.recovery.some((s) => s.includes('--rolled-back')), 'recovery steps must be stated');

  // 4. The documented recovery, executed: mark rolled back, redeploy.
  prisma_(['migrate', 'resolve', '--rolled-back', SECOND_MIGRATION, '--schema', SCHEMA], { DATABASE_URL: `file:${db}` });
  deploy(db);
  assert.ok(await indexExists(p, NEW_INDEX), 'after recovery the migration is genuinely applied');
  assert.equal(await p.organization.count(), 1, 'data survived interruption and recovery');
  const readyAfter = await databaseReadiness(p, { provider: 'sqlite' });
  assert.equal(readyAfter.checks.find((c) => c.name === 'no_failed_migrations').pass, true);
});

test('ROLLBACK: the stored down.sql reverses the migration with data intact, and forward re-applies', async () => {
  const db = path.join(BASE, 'rollback.db');
  deploy(db);
  const p = await client(db);
  await populate(p);
  const before = await snapshot(p);
  assert.ok(await indexExists(p, NEW_INDEX));

  const downFile = path.join(MIGRATIONS, SECOND_MIGRATION, 'down.sql');
  assert.ok(fs.existsSync(downFile), 'every post-baseline migration must ship its down.sql');
  prisma_(['db', 'execute', '--file', downFile, '--url', `file:${db}`]);
  // Prisma has no first-class down command. Rolling back an APPLIED migration
  // is down.sql + removing its bookkeeping row so a later deploy re-applies it.
  // (`migrate resolve --rolled-back` is only for migrations in a FAILED state —
  // that path is exercised in the INTERRUPTED test above.)
  await p.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE migration_name = '${SECOND_MIGRATION}'`);

  assert.equal(await indexExists(p, NEW_INDEX), false, 'down.sql must remove what the migration added');
  assert.deepEqual(await snapshot(p), before, 'rollback of a schema-only migration must not touch data');

  deploy(db); // roll forward again
  assert.ok(await indexExists(p, NEW_INDEX), 'the rolled-back migration re-applies cleanly');
  assert.deepEqual(await snapshot(p), before);
});

test('RESTORE: the pre-migration byte-copy backup is a working database with a verifying chain', async () => {
  // SQLite restore IS a file copy — proven here. The MariaDB equivalent
  // (mysqldump / mariabackup before `migrate deploy`) is ARGUED, not proven.
  const restored = path.join(BASE, 'restored-from-backup.db');
  fs.copyFileSync(backupPath, restored);
  const p = await client(restored);
  assert.equal(await indexExists(p, NEW_INDEX), false, 'the backup predates the second migration');
  const snap = await snapshot(p);
  assert.equal(snap.chainAValid, true, 'the restored ledger chain verifies');
  assert.equal(snap.ledger, popSnapBefore.ledger, 'restored ledger has the pre-migration entry count');
  assert.equal(snap.realRows, popSnapBefore.realRows);
  // And the restored database can be migrated forward again.
  deploy(restored);
  assert.ok(await indexExists(p, NEW_INDEX));
});

/* ──────────────────── 5. SEED SAFETY — ZERO LEAKAGE ─────────────────────── */

function runSeed(env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['prisma/seed.mjs'], {
      cwd: WEB, stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => resolve({ code, out, err }));
  });
}

test('SEED REFUSAL: a database containing real data cannot be seeded — and is left untouched', async () => {
  const p = await client(popDb);
  const before = await snapshot(p);
  const r = await runSeed({ DATABASE_URL: `file:${popDb}` });
  assert.notEqual(r.code, 0, 'the seed must exit non-zero against a database holding real rows');
  assert.match(r.err, /SEED REFUSED/);
  assert.match(r.err, /R4_/, 'the refusal must cite the data-level rule');
  assert.deepEqual(await snapshot(p), before, 'a refused seed must not have modified ONE row');
});

test('SEED REFUSAL: NODE_ENV=production is refused before anything is touched', async () => {
  const db = path.join(BASE, 'prod-env.db');
  deploy(db);
  const r = await runSeed({ DATABASE_URL: `file:${db}`, NODE_ENV: 'production' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /R1_PRODUCTION_NODE_ENV/);
  const p = await client(db);
  assert.equal(await p.organization.count(), 0, 'nothing may be written on a refused seed');
});

test('SEED REFUSAL: a server database URL (MariaDB/PostgreSQL) is refused WITHOUT connecting', async () => {
  // The hostname does not resolve; if the guard tried to connect first, this
  // would fail with a network error instead of the refusal — so the assertion
  // on R3 also proves the check happens before any connection.
  const r = await runSeed({ DATABASE_URL: 'mysql://app:secret@db.internal.example:3306/orderweeddc' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /R3_SERVER_DATABASE_REFUSED/);
  assert.doesNotMatch(r.err, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/, 'refusal must precede any connection attempt');

  const r2 = await runSeed({ DATABASE_URL: 'postgresql://app:secret@db.internal.example:5432/orderweeddc' });
  assert.notEqual(r2.code, 0);
  assert.match(r2.err, /R3_SERVER_DATABASE_REFUSED/);

  const r3 = await runSeed({ DATABASE_URL: '' });
  assert.notEqual(r3.code, 0, 'a missing DATABASE_URL must refuse, never seed a default');
});

test('SEED HAPPY PATH: a fresh migrated local file database seeds, and a re-seed of pure demonstration data is allowed', async () => {
  const db = path.join(BASE, 'seed-ok.db');
  deploy(db);
  const r = await runSeed({ DATABASE_URL: `file:${db}` });
  assert.equal(r.code, 0, `legitimate local seeding must still work: ${r.err.slice(0, 400)}`);
  const p = await client(db);
  assert.ok(await p.retailer.count() > 0);
  assert.equal(await p.retailer.count({ where: { isDemonstration: false } }), 0,
    'the seed itself must introduce ONLY demonstration rows');
  // Re-seed: a database holding only demonstration data is a legitimate target.
  const r2 = await runSeed({ DATABASE_URL: `file:${db}` });
  assert.equal(r2.code, 0, `re-seeding a demonstration database must work: ${r2.err.slice(0, 400)}`);
});

test('the refusal rules themselves are visible and testable as data', async () => {
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'file:./x.db', nodeEnv: 'test' }).length, 0);
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'file:./x.db', nodeEnv: 'production' })[0].rule, 'R1_PRODUCTION_NODE_ENV');
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'mysql://h/db', nodeEnv: 'test' })[0].rule, 'R3_SERVER_DATABASE_REFUSED');
  assert.equal(environmentRefusalsForSeed({ databaseUrl: '', nodeEnv: 'test' })[0].rule, 'R2_DATABASE_URL_REQUIRED');
  // Data rules run against the populated court database and find every category.
  const p = await client(popDb);
  const refusals = await dataRefusalsForSeed(p);
  const rules = new Set(refusals.map((r) => r.rule));
  assert.ok(rules.has('R4_REAL_DATA_PRESENT'));
  assert.ok(rules.has('R4_LEDGER_PRESENT'));
  assert.ok(rules.has('R4_LEAD_EVENTS_PRESENT'));
  assert.ok(rules.has('R4_REAL_USERS_PRESENT'));
});

/* ─────────────────────────── 6. BOOKKEEPING ─────────────────────────────── */

test('provider classification fails closed and the second migration is on disk with its down script', () => {
  assert.equal(databaseProviderOf('file:./dev.db'), 'sqlite');
  assert.equal(databaseProviderOf('mysql://h/db'), 'mysql');
  assert.equal(databaseProviderOf('mariadb://h/db'), 'mysql');
  assert.equal(databaseProviderOf('postgresql://h/db'), 'postgresql');
  assert.equal(databaseProviderOf('postgres://h/db'), 'postgresql');
  assert.equal(databaseProviderOf('mongodb://h/db'), 'unknown');
  assert.equal(databaseProviderOf(undefined), 'unknown');
  const onDisk = migrationsOnDisk(MIGRATIONS);
  assert.deepEqual(onDisk, [BASELINE_MIGRATION_NAME, SECOND_MIGRATION]);
  assert.ok(fs.existsSync(path.join(MIGRATIONS, SECOND_MIGRATION, 'down.sql')));
});
