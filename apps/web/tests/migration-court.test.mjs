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
  loadCanonicalMigrationManifest,
  validateCanonicalMigrationUniverse,
} from '../src/lib/db-config.mjs';
import { environmentRefusalsForSeed, dataRefusalsForSeed } from '../prisma/seed-safety.mjs';
import { recordAskWork } from '../src/lib/ask/ask-work.mjs';
import { buildAnswerabilityFrontier } from '../src/lib/ask/answerability-frontier.mjs';
import {
  compileLiveMarketAcquisition,
  compileOfficialMarketSnapshot,
  revokeMarketEvidence,
  verifyLiveMarketAcquisition,
  verifyOfficialMarketSnapshot,
} from '../src/lib/reality/reality-repository.mjs';
import {
  ABCA_FIELDS,
  buildSnapshotArtifacts,
} from '../src/lib/reality/official-source-snapshot.mjs';
import {
  acquireLiveMarketReality,
  createPrismaAcquisitionStore,
} from '../src/lib/reality/live-reality-acquisition.mjs';
import { selectCurrentClaimDecisions } from '../src/lib/reality/market-claim-adapter.mjs';

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
 * PROVIDER HONESTY, stated once for the whole file. The canonical CANA datastore
 * is managed PostgreSQL + PostGIS (docs/adr/0001), so every EXECUTED proof below
 * now runs on PostgreSQL — the real substrate — against disposable databases
 * this suite creates and drops itself. That is a strictly stronger claim than
 * the retired SQLite lane made: the migrations, the ledger hash chain, the
 * locking and the readiness checks are exercised on the substrate that actually
 * ships, not on a stand-in. The PORTABILITY CANARY still proves the ONE schema
 * GENERATES valid sqlite and mysql (MariaDB) DDL from the same file — generation
 * only; it does not claim that DDL applies to a live MariaDB 11.4.9, and nothing
 * here does. The SQLite readiness lane (WAL pragma) is retired WITH the
 * substrate: PostgreSQL has no journal_mode, so readiness on postgres asserts
 * the WAL check is ABSENT rather than pretending a sqlite pragma is meaningful.
 *
 * ISOLATION (per tests/README-ISOLATION.md): every database here is a uniquely
 * named PostgreSQL database on the loopback server, created in `before`-time on
 * demand and DROPped WITH (FORCE) in the `after` hook. No shared database —
 * cana_app or otherwise — is ever migrated, seeded or mutated by this suite.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = path.resolve(WEB, '..', '..');
const REPOSITORY_COMMIT_SHA = execFileSync('git', ['-C', REPOSITORY, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const REPOSITORY_TREE_SHA = execFileSync('git', ['-C', REPOSITORY, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const SCHEMA = path.join(WEB, 'prisma', 'schema.prisma');
const MIGRATIONS = path.join(WEB, 'prisma', 'migrations');
const SECOND_MIGRATION = '20260726000100_ledger_recorded_at_index';
const SECOND_MIGRATION_DOWN = path.join(MIGRATIONS, SECOND_MIGRATION, 'down.sql');
const GEO_MIGRATION = '20260809100000_geo_kernel';
const CONTINUATION_MIGRATION = '20260809170000_continuation_kernel';
const REALITY_MIGRATION = '20260810000000_market_reality_compiler';
const LIVE_REALITY_MIGRATION = '20260810200000_live_reality_acquisition';
const CANA_EVIDENCE_BRIDGE_MIGRATION = '20260824120000_cana_evidence_bridge';
const REALITY_FIXTURE = path.join(
  WEB,
  'fixtures',
  'reality',
  'dc-abca-layer-31',
  '2026-06-05',
);
const CANONICAL_MIGRATIONS = loadCanonicalMigrationManifest().migrations.map((entry) => entry.name);
const NEW_INDEX = 'DemandCreditEntry_merchantId_recordedAt_idx';

/** The loopback PostgreSQL server every disposable database lives on. The
 *  `postgres` maintenance database is where CREATE/DROP DATABASE are issued —
 *  you cannot drop a database while connected to it. */
const PG_HOST = process.env.CANA_MIGRATION_COURT_POSTGRES_ORIGIN
  ?? 'postgresql://postgres@127.0.0.1:5432';
const PG_ADMIN_URL = `${PG_HOST}/postgres`;

function prismaCliPath() {
  for (let dir = WEB; ; dir = path.dirname(dir)) {
    const c = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(c)) return c;
    if (path.dirname(dir) === dir) throw new Error('prisma CLI not found');
  }
}

/** Invoke the Prisma CLI. A defined `stdin` is fed to the process (for
 *  `db execute --stdin`); otherwise stdin is inherited-pipe. */
function prisma_(args, env = {}, stdin) {
  return execFileSync(process.execPath, [prismaCliPath(), ...args], {
    cwd: WEB, encoding: 'utf8', timeout: 240_000, stdio: 'pipe',
    ...(stdin === undefined ? {} : { input: stdin }),
    env: { ...process.env, ...env },
  });
}

let BASE;
const clients = [];
/** Every disposable database this suite creates, so `after` can drop them all
 *  even if a test throws before its own cleanup. */
const createdDbs = [];

/** Create a uniquely named disposable database on the loopback server and
 *  return its URL. The name is `court_<random hex>` so parallel runs and
 *  crashed prior runs never collide. CREATE DATABASE is issued through the
 *  Prisma CLI (`db execute --stdin`) against the maintenance database, which is
 *  the cleanest primitive available without a standalone pg client installed. */
function createDatabase(label = '') {
  const name = `court_${label ? `${label}_` : ''}${randomBytes(6).toString('hex')}`;
  // Identifier is our own hex + a fixed prefix — no user input — so a plain
  // quoted identifier is safe here.
  prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `CREATE DATABASE "${name}";`);
  const url = `${PG_HOST}/${name}`;
  createdDbs.push(name);
  return url;
}

before(() => { BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-court-')); });
after(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  // Drop every disposable database. WITH (FORCE) terminates any lingering
  // backend connection so a still-open pool cannot wedge the drop.
  for (const name of createdDbs) {
    try {
      prisma_(['db', 'execute', '--url', PG_ADMIN_URL, '--stdin'], {}, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
    } catch { /* best-effort teardown — a failed drop must not fail the suite */ }
  }
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

/** Deploy the (full or staged) migration set to a postgres URL. `migrate deploy`
 *  reads the schema's `directUrl` = env("DIRECT_URL"), so BOTH env vars must
 *  point at the disposable database or the CLI silently targets whatever
 *  DIRECT_URL the runner exported. */
function deploy(url, schemaPath = SCHEMA) {
  return prisma_(['migrate', 'deploy', '--schema', schemaPath], { DATABASE_URL: url, DIRECT_URL: url });
}

async function client(url) {
  const { PrismaClient } = await import('@prisma/client');
  const c = new PrismaClient({ datasources: { db: { url } } });
  clients.push(c);
  return c;
}

function liveRealitySource({ fail = false } = {}) {
  let call = 0;
  const record = {
    attributes: {
      OBJECTID: 4101,
      GLOBALID: '{11111111-2222-3333-4444-555555555555}',
      ABCA_NUMBER: 'ABRA-123456',
      FACILITY_NAME: 'Live Court Cannabis',
      FACILITY_TYPE: 'Retailer',
      LICENSE_TYPE: 'Medical Cannabis Retailer',
      EXPIRATION_DATE: Date.parse('2027-12-31T00:00:00.000Z'),
      ADDRESS: '100 Live Court St NW',
      LATITUDE: 38.9,
      LONGITDUE: -77.03,
      TRADE_NAME: 'Live Court Cannabis',
      ENTITY_NAME: 'Live Court Cannabis LLC',
      STATUS: 'Active',
      ISSUE_DATE: Date.parse('2025-07-17T00:00:00.000Z'),
      EDITED: 1780587905000,
      WARD: 2,
      ENDORSEMENTS: null,
    },
    geometry: { x: -77.03, y: 38.9 },
  };
  const metadata = {
    id: 31,
    name: 'Licensed Medical Cannabis Retailer',
    currentVersion: 11.5,
    maxRecordCount: 1000,
    capabilities: 'Map,Query,Data',
    supportsPagination: true,
    advancedQueryCapabilities: { supportsPagination: true, supportsOrderBy: true },
    editingInfo: { lastEditDate: 1781114729000 },
    fields: ABCA_FIELDS.map((name) => ({ name })),
  };
  const bodies = [metadata, { count: 1 }, { features: [record], exceededTransferLimit: false }, metadata, { count: 1 }];
  return {
    lookup: async () => [{ address: '23.48.99.80', family: 4 }],
    fetchImpl: async () => {
      const index = call;
      call += 1;
      if (fail) return new Response('incident body', { status: 500, headers: { 'content-type': 'text/plain' } });
      return new Response(JSON.stringify(bodies[index]), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=UTF-8', etag: `"live-${index}"` },
      });
    },
  };
}

function liveRealityOptions(source, { attemptId, asOf }) {
  let tick = Date.parse(asOf);
  return {
    tenant: 'orderweeddc.com',
    attemptId,
    asOf,
    env: { CANA_LIVE_REALITY_NETWORK: '1' },
    lookup: source.lookup,
    fetchImpl: source.fetchImpl,
    clock: () => new Date(tick += 1000),
    versions: {
      repositoryCommitSha: REPOSITORY_COMMIT_SHA,
      repositoryTreeSha: REPOSITORY_TREE_SHA,
      adapterVersion: 'dc-abca-live-v1',
      parserVersion: 'cana-dc-abca-arcgis-snapshot-v1',
      compilerVersion: 'cana-reality-compiler-v1',
      entityResolverVersion: 'dc-abca-identity-v1',
      authorityPolicyVersion: 'dc-abca-authority-v1',
      freshnessPolicyVersion: 'dc-abca-freshness-v1',
      verificationCourtVersion: 'cana-market-claim-court-v1',
    },
  };
}

/** Run `ensureDatabaseMigrated`/`withMigrationLock` with DIRECT_URL pinned to
 *  the disposable database. db-config's `runPrisma` forwards process.env and
 *  overrides only DATABASE_URL; on the postgres lane `migrate` uses DIRECT_URL,
 *  so it must be pinned here or the migrator targets the runner's DIRECT_URL. */
async function withDirectUrl(url, fn) {
  const prevDirect = process.env.DIRECT_URL;
  const prevDb = process.env.DATABASE_URL;
  process.env.DIRECT_URL = url;
  process.env.DATABASE_URL = url;
  try {
    return await fn();
  } finally {
    if (prevDirect === undefined) delete process.env.DIRECT_URL; else process.env.DIRECT_URL = prevDirect;
    if (prevDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDb;
  }
}

/** Index-existence probe. On PostgreSQL this is pg_indexes, not sqlite_master. */
async function indexExists(p, name) {
  const r = await p.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE indexname = '${name}'`);
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

/* ─────────────────────────── 0. APPLICATION ROOT ─────────────────────────── */

test('APPLICATION ROOT: the migration court resolves apps/web from its module location', () => {
  assert.equal(path.dirname(SCHEMA), path.join(WEB, 'prisma'));
  assert.equal(path.dirname(MIGRATIONS), path.join(WEB, 'prisma'));
  assert.ok(fs.existsSync(SCHEMA));
  assert.ok(fs.existsSync(MIGRATIONS));
});

/* ────────────────────────── 1. PORTABILITY CANARY ────────────────────────── */

test('PORTABILITY CANARY: the one (postgres) schema still generates valid DDL for sqlite and mysql (MariaDB)', () => {
  // PROVES: generation only, and now from the CANONICAL direction. The schema
  // ships as postgresql; the canary swaps it DOWN to sqlite and mysql to prove
  // the one file still emits valid DDL for both. Applying the mysql DDL to a
  // live MariaDB 11.4.9 is ARGUED until an instance exists, and nothing in this
  // repo claims it. The executed proofs elsewhere in this file run on the real
  // PostgreSQL substrate, so this canary's only job is cross-provider GENERATION.
  const outDir = path.join(BASE, 'ddl');
  fs.mkdirSync(outDir, { recursive: true });
  const src = fs.readFileSync(SCHEMA, 'utf8');
  // Comments legitimately DISCUSS @db. (the audit lives there); code must not USE it.
  const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('//'));
  assert.ok(codeLines.every((l) => !l.includes('@db.')), 'schema must stay free of provider-native @db. attributes');
  assert.ok(!/^enum\s/m.test(src), 'schema must stay free of enums — string domains are the portable choice already made');

  // Postgres-only datasource/generator lines that sqlite and mysql reject: the
  // directUrl, the PostGIS extension, and the previewFeature that enables it.
  // Strip them for the non-postgres variants so `migrate diff` can even parse.
  const forProvider = (provider) => src
    .replace('provider   = "postgresql"', `provider   = "${provider}"`)
    .replace(/\n\s*directUrl\s*=\s*env\("DIRECT_URL"\)/, '')
    .replace(/\n\s*extensions\s*=\s*\[postgis\]/, '')
    .replace(/\n\s*previewFeatures\s*=\s*\["postgresqlExtensions"\]/, '');

  const ddl = {};
  for (const provider of ['sqlite', 'mysql']) {
    const swapped = forProvider(provider);
    assert.notEqual(swapped, src, 'provider swap anchor must match');
    // The postgres-only CODE lines must be gone. Comments legitimately still
    // discuss directUrl/extensions/postgresqlExtensions (the audit header), so
    // check only non-comment lines — the same code/comment split used above.
    const swappedCode = swapped.split('\n').filter((l) => !l.trim().startsWith('//'));
    assert.ok(swappedCode.every((l) => !/\bdirectUrl\b|extensions\s*=\s*\[postgis\]|previewFeatures\s*=\s*\["postgresqlExtensions"\]/.test(l)),
      `${provider} variant must have the postgres-only datasource/generator lines stripped`);
    const p = path.join(outDir, `schema-${provider}.prisma`);
    fs.writeFileSync(p, swapped);
    ddl[provider] = prisma_(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', p, '--script']);
  }
  // Both non-postgres providers still GENERATE a schema (not an empty diff).
  assert.match(ddl.sqlite, /CREATE TABLE/, 'sqlite DDL must still generate from the one schema');
  assert.match(ddl.mysql, /CREATE TABLE/, 'mysql DDL must still generate from the one schema');
  // The MySQL (MariaDB) hazards the audit records must stay VISIBLE in the DDL:
  //  - the idempotency unique index, backtick-quoted the MySQL way
  assert.match(ddl.mysql, /UNIQUE INDEX `DemandCreditEntry_merchantId_eventIdentity_key`/);
  //  - millisecond DateTime precision, load-bearing for the hash chain
  assert.match(ddl.mysql, /`observedAt` DATETIME\(3\)/);
  //  - String → VARCHAR(191), including evidenceChain, which MUST become
  //    @db.Text at MariaDB cutover (the audited hazard, demonstrated not hidden)
  assert.match(ddl.mysql, /`evidenceChain` VARCHAR\(191\)/,
    'if this stops matching, the cutover schema fixed it — update the audit');

  // And the POSTGRES lane — the one that actually ships — has its real
  // migrations on disk, PostGIS and all. Generation of sqlite/mysql is a
  // canary; deployment of THESE is what the executed proofs below exercise.
  const onDisk = migrationsOnDisk(MIGRATIONS);
  assert.ok(onDisk.includes(BASELINE_MIGRATION_NAME) && onDisk.includes(GEO_MIGRATION),
    `postgres migrations must exist on disk, got ${JSON.stringify(onDisk)}`);
  const baselineSql = fs.readFileSync(path.join(MIGRATIONS, BASELINE_MIGRATION_NAME, 'migration.sql'), 'utf8');
  assert.match(baselineSql, /CREATE EXTENSION IF NOT EXISTS "postgis"/, 'the postgres baseline installs PostGIS');
  const geoSql = fs.readFileSync(path.join(MIGRATIONS, GEO_MIGRATION, 'migration.sql'), 'utf8');
  assert.match(geoSql, /geometry\(Point, 4326\)/, 'the geo kernel migration declares real PostGIS geometry');
});

/* ─────────────────────── 1. FORWARD FROM EMPTY ───────────────────────────── */

test('forward migration from EMPTY: deploy applies every migration and records it', async () => {
  const url = createDatabase('empty');
  deploy(url);
  const p = await client(url);
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

test('REALITY COMPILER: evidence records are present and append-only after migration', async () => {
  const url = createDatabase('reality_compiler');
  deploy(url);
  const p = await client(url);
  const snapshot = await p.marketSourceSnapshot.create({
    data: {
      sourceKey: 'dc_abca_retailers',
      sourceUrl: 'https://maps2.dcgis.dc.gov/example',
      queryParameters: '{}',
      fetchedAt: new Date('2026-08-09T20:00:00Z'),
      payloadSha256: 'a'.repeat(64),
      payloadBytes: 2,
      recordCount: 0,
      schemaVersion: 'dc-abca-arcgis-v1',
      payloadJson: '{}',
      completeness: 'UNKNOWN',
    },
  });
  await assert.rejects(
    p.marketSourceSnapshot.update({ where: { id: snapshot.id }, data: { recordCount: 1 } }),
    /CANA_REALITY_APPEND_ONLY/,
  );
  await assert.rejects(
    p.marketSourceSnapshot.delete({ where: { id: snapshot.id } }),
    /CANA_REALITY_APPEND_ONLY/,
  );
  assert.equal(await p.marketSourceSnapshot.count(), 1);
});

test('LIVE REALITY: one content identity supports distinct append-only acquisition events across upgrade', async () => {
  const url = createDatabase('live_reality_identity');
  const previous = stage('live-reality-previous', CANONICAL_MIGRATIONS.filter((name) => name !== LIVE_REALITY_MIGRATION));
  deploy(url, previous.schema);
  const p = await client(url);
  const snapshot = await p.marketSourceSnapshot.create({
    data: {
      sourceKey: 'dcgis_abca_retailers_layer_31',
      sourceUrl: 'https://maps2.dcgis.dc.gov/example',
      queryParameters: '{"where":"1=1"}',
      fetchedAt: new Date('2026-08-10T12:00:00.000Z'),
      payloadSha256: 'a'.repeat(64),
      payloadBytes: 2,
      recordCount: 0,
      schemaVersion: 'dc-abca-arcgis-v1',
      payloadJson: '{}',
      completeness: 'COMPLETE',
    },
  });
  await p.$executeRawUnsafe(
    `INSERT INTO "MarketCompilation" ("id", "tenant", "snapshotId")
     VALUES ('legacy-live-compilation', 'orderweeddc.com', '${snapshot.id}')`,
  );
  await p.$executeRawUnsafe(`
    INSERT INTO "MarketEntityResolution" (
      "id", "snapshotId", "compilationId", "sourceRecordId", "sourceRecordSha256",
      "status", "reason", "candidateIds", "normalizationVersion"
    ) VALUES (
      'legacy-live-resolution', '${snapshot.id}', 'legacy-live-compilation',
      'legacy-live-record', '${'b'.repeat(64)}', 'UNMATCHED', 'legacy court fixture',
      '[]', 'dc-abca-exact-v1'
    )
  `);
  await p.$executeRawUnsafe(`
    INSERT INTO "MarketClaim" (
      "id", "tenant", "claimKey", "claimType", "claimValue", "version",
      "resolutionId", "snapshotId", "compilationId", "observedAt",
      "freshnessExpiresAt", "verification", "decisionEligible"
    ) VALUES (
      'legacy-live-claim', 'orderweeddc.com', 'legacy-live-claim-key',
      'operating_status', 'UNKNOWN', 1, 'legacy-live-resolution', '${snapshot.id}',
      'legacy-live-compilation', TIMESTAMP '2026-08-10 12:00:00+00',
      TIMESTAMP '2026-08-11 12:00:00+00', 'UNKNOWN', false
    )
  `);
  await p.$executeRawUnsafe(`
    INSERT INTO "MarketVerificationEvent" (
      "id", "claimId", "decision", "reason", "evaluatorVersion", "evidenceDigest", "asOf"
    ) VALUES (
      'legacy-live-verification', 'legacy-live-claim', 'DENY', 'legacy court fixture',
      'cana-market-claim-court-v1', '${'c'.repeat(64)}', TIMESTAMP '2026-08-10 13:00:00+00'
    )
  `);

  deploy(url);
  const artifacts = await p.$queryRawUnsafe(
    'SELECT "id", "sourceKey", "contentSha256" FROM "MarketSourceContentArtifact"',
  );
  const firstEvents = await p.$queryRawUnsafe(
    'SELECT "id", "sourceKey", "contentArtifactId", "snapshotId", "attemptId", "sequence", "fetchedAt", "eventHash" FROM "MarketSourceAcquisitionEvent" ORDER BY "fetchedAt", "id"',
  );
  assert.equal(artifacts.length, 1, 'upgrade must create one immutable content identity');
  assert.equal(artifacts[0].sourceKey, snapshot.sourceKey);
  assert.equal(artifacts[0].contentSha256, snapshot.payloadSha256);
  assert.equal(firstEvents.length, 1, 'upgrade must preserve the historical observation as one acquisition event');
  assert.equal(firstEvents[0].contentArtifactId, artifacts[0].id);
  assert.equal(firstEvents[0].snapshotId, snapshot.id);
  assert.equal(firstEvents[0].fetchedAt.toISOString(), snapshot.fetchedAt.toISOString());
  const [legacyCompilation] = await p.$queryRawUnsafe(
    'SELECT "contentArtifactId", "acquisitionEventId" FROM "MarketCompilation" WHERE "id" = \'legacy-live-compilation\'',
  );
  const [legacyVerification] = await p.$queryRawUnsafe(
    'SELECT "acquisitionEventId", "freshnessExpiresAt" FROM "MarketVerificationEvent" WHERE "id" = \'legacy-live-verification\'',
  );
  assert.equal(legacyCompilation.contentArtifactId, artifacts[0].id);
  assert.equal(legacyCompilation.acquisitionEventId, firstEvents[0].id);
  assert.equal(legacyVerification.acquisitionEventId, firstEvents[0].id);
  assert.equal(legacyVerification.freshnessExpiresAt.toISOString(), '2026-08-11T12:00:00.000Z');
  assert.equal(
    firstEvents[0].eventHash,
    createHash('sha256').update(`${firstEvents[0].sourceKey}:${snapshot.id}`).digest('hex'),
    'legacy acquisition backfill must use the same SHA-256 digest family as runtime event chains',
  );

  await p.$executeRawUnsafe(`
    INSERT INTO "MarketSourceAcquisitionEvent" (
      "id", "sourceKey", "attemptId", "sequence", "state", "outcome", "predicateScope",
      "requestedAt", "eventAt", "fetchedAt", "sourceRevision", "revisionState", "requestDigest",
      "completeness", "adapterVersion", "parserVersion", "repositoryCommitSha",
      "contentArtifactId", "snapshotId", "priorEventHash", "eventHash"
    ) VALUES (
      'live-reality-acquisition-2', '${snapshot.sourceKey}', 'attempt-2026-08-17', 1,
      'COMPLETED', 'SOURCE_UNCHANGED', 'licensed_retailer_identity,status,address,coordinates',
      TIMESTAMP '2026-08-17 12:00:00+00', TIMESTAMP '2026-08-17 12:00:01+00', TIMESTAMP '2026-08-17 12:00:01+00',
      'UNKNOWN', 'UNKNOWN', '${'b'.repeat(64)}', 'COMPLETE',
      'dc-abca-live-v1', 'dc-abca-arcgis-v1', 'VERSION_PROVENANCE_UNKNOWN',
      '${artifacts[0].id}', '${snapshot.id}', '${'c'.repeat(64)}', '${'d'.repeat(64)}'
    )
  `);
  const secondEvents = await p.$queryRawUnsafe(
    'SELECT "id", "contentArtifactId", "fetchedAt" FROM "MarketSourceAcquisitionEvent" ORDER BY "fetchedAt", "id"',
  );
  assert.equal(await p.$queryRawUnsafe('SELECT "id" FROM "MarketSourceContentArtifact"').then((rows) => rows.length), 1);
  assert.equal(secondEvents.length, 2, 'identical bytes at a later time must remain a separate acquisition');
  assert.equal(secondEvents[1].contentArtifactId, artifacts[0].id);
  assert.notEqual(secondEvents[0].fetchedAt.toISOString(), secondEvents[1].fetchedAt.toISOString());

  await assert.rejects(
    p.$executeRawUnsafe(`UPDATE "MarketSourceContentArtifact" SET "payloadBytes" = 3 WHERE "id" = '${artifacts[0].id}'`),
    /CANA_REALITY_APPEND_ONLY/,
  );
  await assert.rejects(
    p.$executeRawUnsafe('DELETE FROM "MarketSourceAcquisitionEvent" WHERE "id" = \'live-reality-acquisition-2\''),
    /CANA_REALITY_APPEND_ONLY/,
  );
  await assert.rejects(
    p.$executeRawUnsafe('UPDATE "MarketCompilation" SET "tenant" = \'attacker.example\' WHERE "id" = \'legacy-live-compilation\''),
    /CANA_REALITY_APPEND_ONLY/,
  );
  await assert.rejects(
    p.$executeRawUnsafe('UPDATE "MarketVerificationEvent" SET "reason" = \'tampered\' WHERE "id" = \'legacy-live-verification\''),
    /CANA_REALITY_APPEND_ONLY/,
  );
  assert.equal(await p.marketSourceSnapshot.count(), 1, 'upgrade and re-observation must preserve the legacy snapshot');
});

test('LIVE REALITY: changed compilation and unchanged revalidation are acquisition-bound and outage-safe', async () => {
  const url = createDatabase('live_reality_court');
  deploy(url);
  const p = await client(url);
  await p.retailer.create({ data: {
    id: 'live-reality-retailer',
    name: 'Live Court Cannabis',
    type: 'storefront',
    address: '100 Live Court St NW',
    city: 'Washington',
    state: 'DC',
    lat: 38.9,
    lng: -77.03,
    licenseNumber: 'ABRA-123456',
  } });
  const store = createPrismaAcquisitionStore(p);
  const firstSource = liveRealitySource();
  const first = await acquireLiveMarketReality(store, liveRealityOptions(firstSource, {
    attemptId: 'live-court-first',
    asOf: '2026-08-10T15:00:00.000Z',
  }));
  assert.equal(first.state, 'COMPLETED');
  assert.equal(first.outcome, 'SOURCE_CHANGED');
  const compiled = await compileLiveMarketAcquisition(p, {
    tenant: 'orderweeddc.com',
    acquisitionEventId: first.acquisition_event_id,
  });
  assert.equal(compiled.state, 'COMPILED');
  assert.equal(compiled.acquisition_event_id, first.acquisition_event_id);
  const claimCount = await p.marketClaim.count();
  assert.ok(claimCount > 0);
  assert.equal(await p.marketClaim.count({ where: { decisionEligible: true } }), 0);

  const firstCourt = await verifyLiveMarketAcquisition(p, {
    tenant: 'orderweeddc.com',
    acquisitionEventId: first.acquisition_event_id,
    asOf: new Date('2026-08-11T15:00:00.000Z'),
  });
  assert.ok(firstCourt.admitted_claims >= 4);
  assert.equal(firstCourt.public_cohorts, 1);
  assert.equal(await p.marketClaim.count(), claimCount, 'live court must not mutate immutable claims');
  const offlineClaim = await p.marketClaim.findFirstOrThrow({ where: { tenant: 'orderweeddc.com' } });
  const offlineEvidenceDigest = 'e'.repeat(64);
  const offlineEvent = {
    claimId: offlineClaim.id,
    decision: 'DENY',
    reason: 'OFFLINE_UNIQUENESS_COURT',
    evaluatorVersion: 'cana-market-claim-court-v1',
    evidenceDigest: offlineEvidenceDigest,
    asOf: new Date('2026-08-11T15:01:00.000Z'),
  };
  await p.marketVerificationEvent.create({ data: offlineEvent });
  await assert.rejects(
    p.marketVerificationEvent.create({ data: offlineEvent }),
    /unique constraint/i,
    'NULL acquisition lineage must not bypass verification-event idempotency',
  );
  const firstEventCount = await p.marketVerificationEvent.count();
  assert.ok(firstEventCount > 0);

  const secondSource = liveRealitySource();
  const second = await acquireLiveMarketReality(store, liveRealityOptions(secondSource, {
    attemptId: 'live-court-second',
    asOf: '2026-08-17T15:00:00.000Z',
  }));
  assert.equal(second.outcome, 'SOURCE_UNCHANGED');
  assert.equal(second.content_artifact_id, first.content_artifact_id);
  assert.equal(await p.marketSourceContentArtifact.count(), 1);
  const secondCourt = await verifyLiveMarketAcquisition(p, {
    tenant: 'orderweeddc.com',
    acquisitionEventId: second.acquisition_event_id,
    asOf: new Date('2026-08-18T15:00:00.000Z'),
  });
  assert.ok(secondCourt.verification_events_created > 0);
  assert.equal(await p.marketClaim.count(), claimCount);
  assert.equal(await p.marketVerificationEvent.count(), firstEventCount + secondCourt.verification_events_created);
  const repeatedCourt = await verifyLiveMarketAcquisition(p, {
    tenant: 'orderweeddc.com',
    acquisitionEventId: second.acquisition_event_id,
    asOf: new Date('2026-08-18T15:00:00.000Z'),
  });
  assert.equal(repeatedCourt.verification_events_created, 0);

  const beforeOutage = await p.retailer.findUnique({ where: { id: 'live-reality-retailer' } });
  const outageSource = liveRealitySource({ fail: true });
  const outage = await acquireLiveMarketReality(store, liveRealityOptions(outageSource, {
    attemptId: 'live-court-outage',
    asOf: '2026-08-19T15:00:00.000Z',
  }));
  assert.equal(outage.state, 'FAILED');
  const afterOutage = await p.retailer.findUnique({ where: { id: 'live-reality-retailer' } });
  assert.equal(afterOutage.dataStatus, beforeOutage.dataStatus);
  assert.equal(afterOutage.verifiedAt.toISOString(), beforeOutage.verifiedAt.toISOString());
  assert.equal(await p.marketSourceContentArtifact.count(), 1);
  assert.equal(await p.marketClaim.count(), claimCount);

  await assert.rejects(
    revokeMarketEvidence(p, {
      tenant: 'unrelated-tenant.example',
      targetKind: 'CONTENT_ARTIFACT',
      targetId: first.content_artifact_id,
      cause: 'cross-tenant revocation must not poison shared evidence',
      actorKind: 'HOSTILE_TEST',
      effectiveAt: new Date('2026-08-20T14:00:00.000Z'),
    }),
    /CANA_REALITY_REVOCATION_TARGET_NOT_FOUND/,
  );

  const persistedClaims = (await p.marketClaim.findMany({
    where: { tenant: 'orderweeddc.com' },
    include: { evidence: { select: { observationId: true } } },
  })).map(({ evidence, ...claim }) => ({
    ...claim,
    observationIds: evidence.map((entry) => entry.observationId),
  }));
  const persistedEvents = await p.marketVerificationEvent.findMany({
    where: { claimId: { in: persistedClaims.map((claim) => claim.id) } },
  });
  const persistedAcquisitions = await p.marketSourceAcquisitionEvent.findMany({
    where: { tenant: 'orderweeddc.com' },
  });
  const persistedContentArtifacts = await p.marketSourceContentArtifact.findMany();
  const persistedSourceSnapshots = await p.marketSourceSnapshot.findMany({
    where: { id: { in: persistedContentArtifacts.map((artifact) => artifact.snapshotId) } },
  });
  assert.ok(selectCurrentClaimDecisions({
    claims: persistedClaims,
    verificationEvents: persistedEvents,
    acquisitionEvents: persistedAcquisitions,
    contentArtifacts: persistedContentArtifacts,
    sourceSnapshots: persistedSourceSnapshots,
    revocations: [],
    asOf: new Date('2026-08-20T14:15:00.000Z'),
  }).length >= 4, 'persisted acquisition and court lineage must support current truth');

  const forgedAcquisition = await p.marketSourceAcquisitionEvent.create({
    data: {
      sourceKey: 'attacker-source',
      attemptId: 'cross-tenant-failed-acquisition',
      sequence: 1,
      state: 'FAILED',
      outcome: 'SOURCE_FAILED',
      predicateScope: 'licensed_retailer_identity,status,address,coordinates',
      requestedAt: new Date('2026-08-20T14:16:00.000Z'),
      eventAt: new Date('2026-08-20T14:16:01.000Z'),
      sourceRevision: 'UNKNOWN',
      revisionState: 'UNKNOWN',
      requestDigest: '5'.repeat(64),
      completeness: 'UNKNOWN',
      adapterVersion: 'hostile-adapter-v1',
      parserVersion: 'hostile-parser-v1',
      authorityPolicyVersion: 'hostile-authority-v1',
      freshnessPolicyVersion: 'hostile-freshness-v1',
      verificationCourtVersion: 'cana-market-claim-court-v1',
      repositoryCommitSha: '6'.repeat(40),
      tenant: 'other.example',
      priorEventHash: '7'.repeat(64),
      eventHash: '8'.repeat(64),
      errorCode: 'CANA_LIVE_REALITY_SOURCE_FAILED',
    },
  });
  const forgedClaim = persistedClaims[0];
  await p.marketVerificationEvent.create({
    data: {
      claimId: forgedClaim.id,
      acquisitionEventId: forgedAcquisition.id,
      decision: 'ALLOW',
      reason: 'HOSTILE_FORGED_ALLOW',
      evaluatorVersion: 'cana-market-claim-court-v1',
      evidenceDigest: '9'.repeat(64),
      asOf: new Date('2026-08-20T14:17:00.000Z'),
      freshnessExpiresAt: new Date('2026-08-25T14:17:00.000Z'),
    },
  });
  const persistedEventsWithForgery = await p.marketVerificationEvent.findMany({
    where: { claimId: { in: persistedClaims.map((claim) => claim.id) } },
  });
  const persistedAcquisitionsWithForgery = await p.marketSourceAcquisitionEvent.findMany();
  assert.equal(selectCurrentClaimDecisions({
    claims: persistedClaims,
    verificationEvents: persistedEventsWithForgery,
    acquisitionEvents: persistedAcquisitionsWithForgery,
    contentArtifacts: persistedContentArtifacts,
    sourceSnapshots: persistedSourceSnapshots,
    revocations: [],
    asOf: new Date('2026-08-20T14:20:00.000Z'),
  }).some((claim) => claim.claim_id === forgedClaim.id), false,
  'a persisted failed, cross-tenant, wrong-source acquisition cannot authorize current truth');

  const persistedSecondAcquisition = await p.marketSourceAcquisitionEvent.findUnique({
    where: { id: second.acquisition_event_id },
  });
  const mismatchedCourtAcquisition = await p.marketSourceAcquisitionEvent.create({
    data: {
      ...persistedSecondAcquisition,
      id: undefined,
      createdAt: undefined,
      attemptId: 'live-court-version-mismatch',
      sequence: 1,
      verificationCourtVersion: 'forged-court-v9',
      priorEventHash: 'a'.repeat(64),
      eventHash: 'b'.repeat(64),
    },
  });
  await assert.rejects(
    verifyLiveMarketAcquisition(p, {
      tenant: 'orderweeddc.com',
      acquisitionEventId: mismatchedCourtAcquisition.id,
      asOf: new Date('2026-08-20T14:25:00.000Z'),
    }),
    /CANA_REALITY_ACQUISITION_COURT_VERSION_MISMATCH/,
  );

  const policyRevoked = await revokeMarketEvidence(p, {
    tenant: 'orderweeddc.com',
    targetKind: 'POLICY_VERSION',
    targetId: 'cana-market-claim-court-v1',
    cause: 'court policy lineage withdrawn by integration court',
    actorKind: 'TEST_COURT',
    effectiveAt: new Date('2026-08-20T14:30:00.000Z'),
  });
  assert.equal(policyRevoked.state, 'REVOKED');
  assert.ok(policyRevoked.affected_claims > 0);
  assert.equal(policyRevoked.replacement_truth_created, 0);
  assert.equal((await p.retailer.findUnique({ where: { id: 'live-reality-retailer' } })).dataStatus, 'STALE');
  const policyRevocations = await p.marketEvidenceRevocationEvent.findMany({
    where: { tenant: 'orderweeddc.com', targetKind: 'POLICY_VERSION' },
  });
  assert.deepEqual(selectCurrentClaimDecisions({
    claims: persistedClaims,
    verificationEvents: persistedEvents,
    acquisitionEvents: persistedAcquisitions,
    contentArtifacts: persistedContentArtifacts,
    sourceSnapshots: persistedSourceSnapshots,
    revocations: policyRevocations,
    asOf: new Date('2026-08-20T14:45:00.000Z'),
  }), [], 'revoked persisted court lineage must not remain current truth');
  await assert.rejects(
    verifyLiveMarketAcquisition(p, {
      tenant: 'orderweeddc.com',
      acquisitionEventId: second.acquisition_event_id,
      asOf: new Date('2026-08-20T14:45:00.000Z'),
    }),
    /CANA_REALITY_EVIDENCE_REVOKED/,
  );

  const revoked = await revokeMarketEvidence(p, {
    tenant: 'orderweeddc.com',
    targetKind: 'CONTENT_ARTIFACT',
    targetId: first.content_artifact_id,
    cause: 'hostile court proves append-only epistemic recall',
    actorKind: 'TEST_COURT',
    effectiveAt: new Date('2026-08-20T15:00:00.000Z'),
  });
  assert.equal(revoked.state, 'REVOKED');
  assert.ok(revoked.affected_claims > 0);
  assert.equal(revoked.replacement_truth_created, 0);
  assert.ok(await p.marketClaim.count() > claimCount);
  assert.equal((await p.retailer.findUnique({ where: { id: 'live-reality-retailer' } })).dataStatus, 'STALE');
  assert.equal(await p.marketSourceContentArtifact.count(), 1, 'revocation preserves immutable content history');
});

test('REALITY COMPILER: repeated court verification is an exact database no-op', async () => {
  const url = createDatabase('reality_idempotency');
  deploy(url);
  const p = await client(url);
  await p.retailer.create({
    data: {
      id: 'reality-idempotency-retailer',
      name: 'Capital City Care',
      type: 'storefront',
      address: '1115 U St NW',
      city: 'Washington',
      state: 'DC',
      lat: 38.916804,
      lng: -77.027099,
      licenseNumber: 'ABCA-133578',
    },
  });

  const compiled = await compileOfficialMarketSnapshot(p, {
    snapshotDirectory: REALITY_FIXTURE,
    tenant: 'orderweeddc.com',
  });
  assert.equal(compiled.state, 'COMPILED');
  assert.ok(compiled.claims > 0);

  const historicalClock = new Date('2026-06-06T00:00:00.000Z');
  const firstHistorical = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: historicalClock,
  });
  assert.ok(firstHistorical.verification_events_created > 0);
  const historicalCounts = {
    claims: await p.marketClaim.count(),
    events: await p.marketVerificationEvent.count(),
  };
  const secondHistorical = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: historicalClock,
  });
  assert.equal(secondHistorical.verification_events_created, 0);
  assert.deepEqual(
    {
      claims: await p.marketClaim.count(),
      events: await p.marketVerificationEvent.count(),
    },
    historicalCounts,
  );

  const currentClock = new Date('2026-08-10T00:00:00.000Z');
  const firstCurrent = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: currentClock,
  });
  assert.ok(firstCurrent.verification_events_created > 0);
  const currentCounts = {
    claims: await p.marketClaim.count(),
    events: await p.marketVerificationEvent.count(),
  };
  const secondCurrent = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: currentClock,
  });
  assert.equal(secondCurrent.verification_events_created, 0);
  assert.deepEqual(
    {
      claims: await p.marketClaim.count(),
      events: await p.marketVerificationEvent.count(),
    },
    currentCounts,
  );
});

test('REALITY COMPILER: forged identity resolution cannot verify or project onto a victim retailer', async () => {
  const url = createDatabase('reality_forged_identity');
  deploy(url);
  const p = await client(url);
  await p.retailer.createMany({ data: [
    {
      id: 'reality-right-retailer',
      name: 'Capital City Care',
      type: 'storefront',
      address: '1115 U St NW',
      city: 'Washington',
      state: 'DC',
      lat: 38.916804,
      lng: -77.027099,
      licenseNumber: 'ABCA-133578',
    },
    {
      id: 'reality-victim-retailer',
      name: 'Unrelated Victim',
      type: 'storefront',
      address: '200 Unrelated Ave NW',
      city: 'Washington',
      state: 'DC',
      lat: 38.9,
      lng: -77.01,
      licenseNumber: 'VICTIM-0001',
    },
  ] });
  const victimGeo = await p.geoEntity.create({
    data: {
      id: 'reality-victim-geo',
      name: 'Unrelated Victim',
      lat: 38.9,
      lng: -77.01,
      retailerId: 'reality-victim-retailer',
      source: 'hostile-test',
      observedAt: new Date('2026-06-05T00:00:00.000Z'),
      verification: 'UNKNOWN',
    },
  });

  await compileOfficialMarketSnapshot(p, {
    snapshotDirectory: REALITY_FIXTURE,
    tenant: 'evidence-seed.example',
  });
  const seedResolution = await p.marketEntityResolution.findFirstOrThrow({
    where: { compilation: { tenant: 'evidence-seed.example' }, sourceRecordId: 'ABCA-133578' },
    include: { snapshot: true },
  });
  const forgedCompilation = await p.marketCompilation.create({
    data: { tenant: 'orderweeddc.com', snapshotId: seedResolution.snapshotId },
  });
  const forgedResolution = await p.marketEntityResolution.create({
    data: {
      snapshotId: seedResolution.snapshotId,
      compilationId: forgedCompilation.id,
      sourceRecordId: seedResolution.sourceRecordId,
      sourceRecordSha256: seedResolution.sourceRecordSha256,
      normalizedLicense: seedResolution.normalizedLicense,
      normalizedName: seedResolution.normalizedName,
      normalizedAddress: seedResolution.normalizedAddress,
      status: 'MATCH',
      reason: 'EXACT_LICENSE',
      candidateIds: JSON.stringify(['reality-victim-retailer']),
      normalizationVersion: seedResolution.normalizationVersion,
      retailerId: 'reality-victim-retailer',
      geoEntityId: victimGeo.id,
    },
  });
  const observations = await p.marketObservation.findMany({
    where: { snapshotId: seedResolution.snapshotId, sourceRecordId: seedResolution.sourceRecordId },
  });
  for (const observation of observations) {
    const claim = await p.marketClaim.create({
      data: {
        tenant: 'orderweeddc.com',
        claimKey: `reality-victim-retailer:${observation.fieldName}`,
        claimType: observation.fieldName,
        claimValue: observation.normalizedValue,
        version: 1,
        resolutionId: forgedResolution.id,
        snapshotId: seedResolution.snapshotId,
        compilationId: forgedCompilation.id,
        observedAt: observation.observedAt,
        freshnessExpiresAt: observation.freshnessExpiresAt,
        confidence: observation.confidence,
        uncertaintyJson: observation.uncertaintyJson,
        verification: 'UNKNOWN',
        decisionEligible: false,
      },
    });
    await p.marketClaimEvidence.create({
      data: { claimId: claim.id, observationId: observation.id, role: 'SUPPORTS' },
    });
  }

  const verdict = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: new Date('2026-06-06T00:00:00.000Z'),
  });
  assert.equal(verdict.admitted_claims, 0);
  assert.equal(verdict.public_cohorts, 0);
  const victim = await p.retailer.findUniqueOrThrow({ where: { id: 'reality-victim-retailer' } });
  assert.notEqual(victim.dataStatus, 'VERIFIED_CURRENT');
  assert.equal(await p.geoClaim.count({
    where: { geoEntityId: victimGeo.id, decisionEligible: true },
  }), 0);
});

test('REALITY COMPILER: contradiction lineage uses stored observation IDs and demotes older court projections', async () => {
  const url = createDatabase('reality_contradiction_lineage');
  deploy(url);
  const p = await client(url);
  await p.retailer.create({
    data: {
      id: 'reality-contradiction-retailer',
      name: 'Capital City Care',
      type: 'storefront',
      address: '1115 U St NW',
      city: 'Washington',
      state: 'DC',
      lat: 38.916804,
      lng: -77.027099,
      licenseNumber: 'ABCA-133578',
    },
  });
  const geo = await p.geoEntity.create({
    data: {
      id: 'reality-contradiction-geo',
      name: 'Capital City Care',
      lat: 38.916804,
      lng: -77.027099,
      retailerId: 'reality-contradiction-retailer',
      source: 'hostile-test',
      observedAt: new Date('2026-06-05T00:00:00.000Z'),
      verification: 'UNKNOWN',
    },
  });

  await compileOfficialMarketSnapshot(p, {
    snapshotDirectory: REALITY_FIXTURE,
    tenant: 'orderweeddc.com',
  });
  const admitted = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: new Date('2026-06-06T00:00:00.000Z'),
  });
  assert.equal(admitted.public_cohorts, 1);
  await p.retailer.update({
    where: { id: 'reality-contradiction-retailer' },
    data: { reviewedBy: 'older-court-version' },
  });

  const originalEnvelope = JSON.parse(fs.readFileSync(path.join(REALITY_FIXTURE, 'snapshot.json'), 'utf8'));
  const metadataBytes = Buffer.from(originalEnvelope.metadata_base64, 'base64');
  const firstPage = JSON.parse(Buffer.from(originalEnvelope.pages[0].response_base64, 'base64').toString('utf8'));
  const target = firstPage.features.find((feature) => feature.attributes.ABCA_NUMBER === 'ABCA-133578');
  assert.ok(target, 'the hostile fixture must contain the exact licensed retailer');
  target.attributes.STATUS = 'Inactive';
  const pageBytes = Buffer.from(JSON.stringify(firstPage));
  const changed = buildSnapshotArtifacts({
    metadataBytes,
    pageParts: [{ offset: 0, bytes: pageBytes }],
    fetchedAt: new Date('2026-08-10T05:00:00.000Z'),
  });
  const changedDirectory = path.join(BASE, 'reality-contradiction-fixture');
  fs.mkdirSync(changedDirectory);
  fs.writeFileSync(path.join(changedDirectory, 'snapshot.json'), changed.snapshotBytes);
  fs.writeFileSync(path.join(changedDirectory, 'manifest.json'), changed.manifestBytes);

  const second = await compileOfficialMarketSnapshot(p, {
    snapshotDirectory: changedDirectory,
    tenant: 'orderweeddc.com',
  });
  assert.ok(second.contradictions > 0);
  const rows = await p.marketClaimContradiction.findMany({
    where: { tenant: 'orderweeddc.com' },
  });
  assert.ok(rows.length > 0);
  const storedObservationIds = new Set((await p.marketObservation.findMany({ select: { id: true } })).map(({ id }) => id));
  for (const row of rows) {
    const earlier = JSON.parse(row.earlierObservationIdsJson);
    const later = JSON.parse(row.laterObservationIdsJson);
    assert.equal(earlier.length > 0 && earlier.every((id) => storedObservationIds.has(id)), true);
    assert.equal(later.length > 0 && later.every((id) => storedObservationIds.has(id)), true);
  }

  const denied = await verifyOfficialMarketSnapshot(p, {
    tenant: 'orderweeddc.com',
    asOf: new Date('2026-06-08T00:00:00.000Z'),
  });
  assert.equal(denied.public_cohorts, 0);
  const retailer = await p.retailer.findUniqueOrThrow({ where: { id: 'reality-contradiction-retailer' } });
  assert.equal(retailer.dataStatus, 'DISPUTED');
  assert.equal(await p.geoClaim.count({
    where: { geoEntityId: geo.id, decisionEligible: true },
  }), 0);
});

test('readiness is HONEST on a fresh postgres deploy: ready once migrated, and the WAL check is ABSENT', async () => {
  // The SQLite readiness lane (a persistent journal_mode=WAL pragma) is RETIRED
  // with the substrate: PostgreSQL has no journal_mode, so a WAL check on it
  // would be a sqlite pragma cargo-culted onto a database that has never heard
  // of it. Readiness on the postgres lane must therefore NOT emit that check —
  // asserting its absence is the honest replacement for the old "not ready
  // until WAL, ready after" dance. What DOES matter (connectable, migration
  // bookkeeping present, none failed, none pending) is asserted below.
  const url = createDatabase('readiness');
  deploy(url);
  const p = await client(url);
  const ready = await databaseReadiness(p, { provider: 'postgresql' });
  assert.equal(ready.checks.some((c) => c.name === 'sqlite_journal_mode_wal'), false,
    'postgres readiness must NOT include the retired sqlite WAL check');
  assert.ok(ready.checks.some((c) => c.name === 'database_connectable' && c.pass));
  assert.ok(ready.checks.some((c) => c.name === 'migrations_table_present' && c.pass));
  assert.ok(ready.checks.some((c) => c.name === 'no_failed_migrations' && c.pass));
  assert.ok(ready.checks.some((c) => c.name === 'no_pending_migrations' && c.pass));
  assert.equal(ready.ready, true, JSON.stringify(ready.checks));

  // initializeDatabaseConfig on the postgres lane is a deliberate, successful
  // no-op (connection tuning lives in the managed service, not per-process
  // pragmas) — proven here so a caller can still assert ok:true unconditionally.
  const init = await initializeDatabaseConfig(p, { databaseUrl: url });
  assert.equal(init.ok, true, JSON.stringify(init));
  assert.equal(init.provider, 'postgresql');
  assert.deepEqual(init.applied, [], 'no pragmas are applied on postgres');
  await p.$disconnect();
});

test('health check answers with latency on a live database and failure on a dead one', async () => {
  const url = createDatabase('health');
  deploy(url);
  const live = await client(url);
  const h = await databaseHealth(live);
  assert.equal(h.healthy, true);
  assert.equal(typeof h.latencyMs, 'number');
  await live.$disconnect();

  // A database that does not exist on the server: connecting and running
  // SELECT 1 must fail and be reported with its error, not a bare false.
  const dead = await client(`${PG_HOST}/court_nonexistent_${randomBytes(6).toString('hex')}`);
  const d = await databaseHealth(dead);
  assert.equal(d.healthy, false);
  assert.ok(d.error, 'a dead database must be reported with its error, not a bare false');
});

/* ─────────── 2. OLDER SCHEMA, POPULATED → FORWARD MIGRATION ─────────────── */

let popUrl, popSnapBefore;

test('a POPULATED database on the OLDER schema migrates forward without losing anything', async () => {
  popUrl = createDatabase('populated');
  const older = stage('older', [BASELINE_MIGRATION_NAME]); // schema version N-1, genuinely deployed
  deploy(popUrl, older.schema);

  const p = await client(popUrl);
  assert.equal(await indexExists(p, NEW_INDEX), false, 'older schema must NOT have the new index yet');
  await populate(p);
  popSnapBefore = await snapshot(p);
  assert.equal(popSnapBefore.chainAValid, true);
  await p.$disconnect();

  // The restore fixture: a logical backup taken BEFORE migrating. A byte-copy
  // of a file is meaningless on a server database; the postgres equivalent is a
  deploy(popUrl); // full migration set — forward migration of an older, populated database
  const q = await client(popUrl);
  assert.equal(await indexExists(q, NEW_INDEX), true, 'forward migration must add the index');
  const after = await snapshot(q);
  assert.deepEqual(after, popSnapBefore, 'logical content must be byte-for-byte preserved by the migration');
});

test('TRUTH-STATUS preservation: migration re-grades nothing', async () => {
  const p = await client(popUrl);
  assert.equal(popSnapBefore.demoStatus, 'DEMONSTRATION_ONLY');
  assert.equal(popSnapBefore.realStatus, 'VERIFIED_CURRENT');
  assert.equal((await p.retailer.findFirst({ where: { isDemonstration: true } })).dataStatus, 'DEMONSTRATION_ONLY');
  assert.equal((await p.retailer.findFirst({ where: { isDemonstration: false } })).dataStatus, 'VERIFIED_CURRENT');
  // Migration introduced no demonstration rows and promoted none.
  assert.equal(await p.retailer.count({ where: { isDemonstration: true } }), popSnapBefore.demoRows);
  assert.equal(await p.retailer.count({ where: { isDemonstration: false } }), popSnapBefore.realRows);
});

test('LEDGER CHAIN integrity is preserved: every entry re-hashes to its recorded digest after migration', async () => {
  const p = await client(popUrl);
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
  const p = await client(popUrl);
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
  // this is portable — now PROVEN on the canonical postgres substrate, argued
  // from documented semantics for the others.
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
  const p = await client(popUrl);
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
  const p = await client(popUrl);
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
  const p = await client(popUrl);
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
  const expectedMigrations = migrationsOnDisk(MIGRATIONS).length;
  const script = `
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient({ datasources: { db: { url: '${popUrl}' } } });
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
  assert.equal(r.migrations, expectedMigrations);
});

/* ──────────────── 3. IDEMPOTENT INIT, ADOPTION, LOCKING ─────────────────── */

test('ensureDatabaseMigrated is idempotent: FRESH applies, MIGRATED no-ops', async () => {
  const url = createDatabase('ensure');
  const expected = migrationsOnDisk(MIGRATIONS).length;
  const first = await withDirectUrl(url, () => ensureDatabaseMigrated({ databaseUrl: url }));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.state, 'FRESH');
  const second = await withDirectUrl(url, () => ensureDatabaseMigrated({ databaseUrl: url }));
  assert.equal(second.ok, true);
  assert.equal(second.state, 'MIGRATED');
  const p = await client(url);
  assert.equal((await readMigrationRows(p)).length, expected, 'running init twice must not duplicate history');
});

test('a DB-PUSH-ERA database (schema, no migration history) is ADOPTED: baselined then migrated forward', async () => {
  // This is the exact state of every existing database in this project: the
  // BASELINE schema is present (that is precisely what db push produced in the
  // pre-migration era), but there is no `_prisma_migrations` bookkeeping.
  // Recreated by executing the baseline DDL directly — same tables, no history.
  const url = createDatabase('dbpush');
  prisma_(['db', 'execute', '--file', path.join(MIGRATIONS, BASELINE_MIGRATION_NAME, 'migration.sql'), '--url', url]);
  const p0 = await client(url);
  await p0.organization.create({ data: { name: 'pre-adoption data' } });
  assert.equal(await readMigrationRows(p0), null, 'db push must leave no migration history — that is the gap');
  await p0.$disconnect();

  const r = await withDirectUrl(url, () => ensureDatabaseMigrated({ databaseUrl: url }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, 'DB_PUSH_ERA');
  const p = await client(url);
  const rows = await readMigrationRows(p);
  assert.deepEqual(rows.map((x) => x.migration_name).sort(), migrationsOnDisk(MIGRATIONS));
  assert.equal(await p.organization.count(), 1, 'adoption must not touch data');
  assert.ok(await indexExists(p, NEW_INDEX), 'newer migration applied on top of the baseline');
});

test('MIGRATION LOCK: concurrent critical sections are strictly serialised', async () => {
  const url = createDatabase('lock');
  const log = path.join(BASE, 'lock-log.txt');
  const worker = (tag) => `
    import('${path.join(WEB, 'src/lib/db-config.mjs')}').then(async (m) => {
      const fs = await import('node:fs');
      await m.withMigrationLock('${url}', async () => {
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
  const url = createDatabase('concinit');
  const worker = `
    import('${path.join(WEB, 'src/lib/db-config.mjs')}').then(async (m) => {
      const r = await m.ensureDatabaseMigrated({ databaseUrl: '${url}' });
      if (!r.ok) { console.error(JSON.stringify(r)); process.exit(2); }
    }).catch((e) => { console.error(e); process.exit(1); });
  `;
  const run = () => new Promise((resolve, reject) => {
    // DIRECT_URL must be the disposable DB in the child too: db-config's
    // runPrisma forwards process.env and overrides only DATABASE_URL, and
    // `migrate` on postgres reads DIRECT_URL.
    const c = spawn(process.execPath, ['--input-type=module', '-e', worker], {
      cwd: WEB, stdio: 'pipe', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err || `exit ${code}`))));
  });
  await Promise.all([run(), run()]);
  const p = await client(url);
  const rows = await readMigrationRows(p);
  const names = rows.map((r) => r.migration_name).sort();
  assert.deepEqual(names, migrationsOnDisk(MIGRATIONS),
    `each migration must appear EXACTLY once, got ${JSON.stringify(names)}`);
});

/* ─────────────── 4. INTERRUPTION, ROLLBACK AND RESTORE ──────────────────── */

test('INTERRUPTED migration: deploy refuses to continue, readiness says why, and the documented recovery works', async () => {
  const url = createDatabase('interrupted');
  const older = stage('interrupted', [BASELINE_MIGRATION_NAME]);
  deploy(url, older.schema);
  const p = await client(url);
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
  try { deploy(url); } catch (e) { refusal = e; }
  assert.ok(refusal, 'deploy must throw while a failed migration is recorded');
  const refusalText = `${refusal.message ?? ''}${refusal.stdout ?? ''}${refusal.stderr ?? ''}`;
  assert.match(refusalText, /P3009|failed migrations|not finished/i, `unexpected refusal: ${refusalText.slice(0, 400)}`);

  // 2. readiness must name the failure, not just say no.
  const ready = await databaseReadiness(p, { provider: 'postgresql' });
  assert.equal(ready.ready, false);
  const failedCheck = ready.checks.find((c) => c.name === 'no_failed_migrations');
  assert.equal(failedCheck.pass, false);
  assert.match(failedCheck.detail, new RegExp(SECOND_MIGRATION));

  // 3. ensureDatabaseMigrated must fail CLOSED with the recovery steps, and
  //    must not "repair" anything itself.
  const ensure = await withDirectUrl(url, () => ensureDatabaseMigrated({ databaseUrl: url }));
  assert.equal(ensure.ok, false);
  assert.equal(ensure.state, 'FAILED_MIGRATION_PRESENT');
  assert.deepEqual(ensure.failed, [SECOND_MIGRATION]);
  assert.ok(ensure.recovery.some((s) => s.includes('--rolled-back')), 'recovery steps must be stated');

  // 4. The documented recovery, executed: mark rolled back, redeploy.
  prisma_(['migrate', 'resolve', '--rolled-back', SECOND_MIGRATION, '--schema', SCHEMA], { DATABASE_URL: url, DIRECT_URL: url });
  deploy(url);
  assert.ok(await indexExists(p, NEW_INDEX), 'after recovery the migration is genuinely applied');
  assert.equal(await p.organization.count(), 1, 'data survived interruption and recovery');
  const readyAfter = await databaseReadiness(p, { provider: 'postgresql' });
  assert.equal(readyAfter.checks.find((c) => c.name === 'no_failed_migrations').pass, true);
});

test('ROLLBACK: the known inverse DDL reverses the index migration with data intact, and forward re-applies', async () => {
  // The checked-in rollback artifact is the sole inverse procedure. The court
  // executes those exact bytes so operator instructions cannot drift from the
  // rollback that was actually proven. (`migrate resolve --rolled-back` is only
  // for migrations in a FAILED state — exercised in INTERRUPTED above.)
  const url = createDatabase('rollback');
  const rollbackStage = stage('rollback', [BASELINE_MIGRATION_NAME, SECOND_MIGRATION]);
  deploy(url, rollbackStage.schema);
  const p = await client(url);
  await populate(p);
  const before = await snapshot(p);
  assert.ok(await indexExists(p, NEW_INDEX));

  const downSql = fs.readFileSync(SECOND_MIGRATION_DOWN, 'utf8');
  assert.match(downSql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(downSql, /pg_advisory_xact_lock\(72707369\)/);
  await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(72707369)');
    let lockRefusal = null;
    try { prisma_(['db', 'execute', '--url', url, '--stdin'], {}, downSql); } catch (error) { lockRefusal = error; }
    assert.ok(lockRefusal, 'manual reversal must refuse while Prisma migration advisory lock is held');
    assert.match(`${lockRefusal.stderr ?? ''}${lockRefusal.message ?? ''}`, /lock timeout|canceling statement/i);
  }, { timeout: 15_000 });
  assert.ok(await indexExists(p, NEW_INDEX), 'lock refusal must leave the index intact');

  prisma_(['db', 'execute', '--url', url, '--stdin'], {}, downSql);

  assert.equal(await indexExists(p, NEW_INDEX), false, 'the inverse DDL must remove what the migration added');
  assert.deepEqual(await snapshot(p), before, 'rollback of a schema-only migration must not touch data');

  deploy(url, rollbackStage.schema); // roll forward again
  assert.ok(await indexExists(p, NEW_INDEX), 'the rolled-back migration re-applies cleanly');
  assert.deepEqual(await snapshot(p), before);
});

test('ROLLBACK: the manual inverse refuses after a later successful migration', async () => {
  const url = createDatabase('rollback_later');
  deploy(url);
  const p = await client(url);
  const ledgerBefore = await p.$queryRawUnsafe(
    'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name',
  );
  const continuationTablesBefore = await p.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('ContinuationMission','ContinuationTrigger','ContinuationReceipt','Opportunity','AskIntentSignal') ORDER BY tablename`,
  );
  assert.equal(continuationTablesBefore.length, 5, 'the later continuation schema must exist before reversal is attempted');
  const downSql = fs.readFileSync(SECOND_MIGRATION_DOWN, 'utf8');
  let refusal = null;
  try { prisma_(['db', 'execute', '--url', url, '--stdin'], {}, downSql); } catch (error) { refusal = error; }
  assert.ok(refusal, 'manual reversal must refuse when the geo migration is already applied');
  assert.match(`${refusal.stderr ?? ''}${refusal.message ?? ''}`, /later successful migration is applied/);
  assert.ok(await indexExists(p, NEW_INDEX), 'later-migration refusal must roll back the index drop');
  const ledgerAfter = await p.$queryRawUnsafe(
    'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name',
  );
  assert.deepEqual(ledgerAfter, ledgerBefore, 'refusal must not partially mutate Prisma migration bookkeeping');
  assert.deepEqual(
    ledgerAfter.filter((row) => row.finished_at != null && row.rolled_back_at == null).map((row) => row.migration_name),
    CANONICAL_MIGRATIONS,
    'every canonical migration must remain successfully applied after refusal',
  );
  const continuationTablesAfter = await p.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('ContinuationMission','ContinuationTrigger','ContinuationReceipt','Opportunity','AskIntentSignal') ORDER BY tablename`,
  );
  assert.deepEqual(continuationTablesAfter, continuationTablesBefore, 'continuation schema must remain intact after refusal');
});

test('ASK WORK: one observation is atomic, deduplicated and leaves no partial state on failure', async () => {
  const url = createDatabase('ask_work');
  deploy(url);
  const p = await client(url);
  const now = new Date('2026-08-09T18:00:00Z');
  const intent = {
    raw_query: 'flower in dupont',
    unknown_dimensions: [],
    dimensions: { location: { status: 'KNOWN', value: 'dupont circle' } },
  };
  const answerabilityFrontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.localhost', intent, claimDecisions: [], asOf: now,
  });
  const answer = {
    verified_candidate_count: 0,
    zero_verified_result: true,
    zero_result_reason: 'NO_VERIFIED_CURRENT_MATCH',
    unsupported_known_dimensions: [],
    answerability_frontier: answerabilityFrontier,
    opportunitySpec: {
      tenant: 'orderweeddc.localhost',
      kind: 'MARKET_GAP',
      retailerId: null,
      evidence: JSON.stringify({ verified_candidates: 0 }),
      observedState: JSON.stringify({ location: 'dupont circle', verified_candidate_count: 0 }),
      signal: intent.raw_query,
      hypothesizedValue: null,
      confidence: null,
      recommendedAction: 'Verify merchant coverage from canonical evidence.',
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only',
      rollback: 'Dismiss the opportunity',
      measurementPlan: 'A registered consumer re-checks decision-eligible verified candidates.',
    },
  };
  const input = {
    answer, domain: 'orderweeddc.localhost', intent, now,
  };

  const first = await recordAskWork(p, input);
  assert.equal(first.state, 'RECORDED');
  assert.equal(first.opportunityRecorded, true);
  assert.equal(first.continuationArmed, true);
  const counts = async () => ({
    reservations: await p.publicSubmissionEvent.count(),
    opportunities: await p.opportunity.count(),
    missions: await p.continuationMission.count(),
    triggers: await p.continuationTrigger.count(),
    signals: await p.askIntentSignal.count(),
  });
  assert.deepEqual(await counts(), { reservations: 1, opportunities: 1, missions: 1, triggers: 1, signals: 1 });
  const [storedSignal] = await p.askIntentSignal.findMany();
  const [storedOpportunity] = await p.opportunity.findMany();
  assert.match(storedSignal.rawQuery, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(storedSignal.intentIr, /flower in dupont/);
  assert.doesNotMatch(storedOpportunity.signal, /flower in dupont/);
  assert.doesNotMatch(storedOpportunity.evidence, /flower in dupont/);
  assert.equal(JSON.parse(storedOpportunity.evidence).answerability_frontier.frontier_key, answerabilityFrontier.frontier_key);
  assert.equal(JSON.parse(storedOpportunity.observedState).demand_priority.components.admitted_signal_count, 1);

  const duplicate = await recordAskWork(p, input);
  assert.equal(duplicate.state, 'RECORDED');
  assert.equal(duplicate.opportunity.id, first.opportunity.id);
  assert.deepEqual(await counts(), { reservations: 1, opportunities: 1, missions: 1, triggers: 1, signals: 2 });

  const semanticReplay = await recordAskWork(p, {
    ...input,
    intent: { ...intent, raw_query: 'dupont flower please' },
    now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
  });
  assert.equal(semanticReplay.state, 'RECORDED');
  assert.equal(semanticReplay.opportunity.id, first.opportunity.id);
  assert.deepEqual(await counts(), { reservations: 1, opportunities: 1, missions: 1, triggers: 1, signals: 3 });
  assert.equal(
    JSON.parse((await p.opportunity.findUnique({ where: { id: first.opportunity.id } })).observedState)
      .demand_priority.components.admitted_signal_count,
    3,
  );

  await p.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION refuse_ask_signal() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected ask signal failure';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await p.$executeRawUnsafe(`
    CREATE TRIGGER ask_signal_failure BEFORE INSERT ON "AskIntentSignal"
    FOR EACH ROW EXECUTE FUNCTION refuse_ask_signal();
  `);
  try {
    const failedIntent = {
      ...intent,
      raw_query: 'failure in shaw',
      dimensions: {
        ...intent.dimensions,
        location: { status: 'KNOWN', value: 'shaw' },
      },
    };
    const failed = await recordAskWork(p, {
      ...input,
      intent: failedIntent,
      answer: {
        ...answer,
        opportunitySpec: { ...answer.opportunitySpec, signal: failedIntent.raw_query },
      },
    });
    assert.equal(failed.state, 'FAILED');
    assert.deepEqual(await counts(), { reservations: 1, opportunities: 1, missions: 1, triggers: 1, signals: 3 });
  } finally {
    await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS ask_signal_failure ON "AskIntentSignal";');
    await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS refuse_ask_signal();');
  }

  await p.askIntentSignal.createMany({
    data: Array.from({ length: 97 }, () => ({
      tenant: storedSignal.tenant,
      rawQuery: storedSignal.rawQuery,
      intentIr: storedSignal.intentIr,
      answerSummary: storedSignal.answerSummary,
      candidateCount: storedSignal.candidateCount,
      opportunityId: first.opportunity.id,
    })),
  });
  assert.equal(await p.askIntentSignal.count(), 100);
  const boundedDuplicate = await recordAskWork(p, input);
  assert.equal(boundedDuplicate.state, 'RATE_LIMITED');
  assert.equal(boundedDuplicate.signalRecorded, false);
  assert.equal(await p.askIntentSignal.count(), 100, 'duplicate demand storage must remain bounded');
});

test('ASK FRONTIER: ten concurrent equivalent demands create ten signals and one durable work unit', async () => {
  const url = createDatabase('ask_frontier_concurrent');
  deploy(url);
  const p = await client(url);
  const now = new Date('2026-08-10T12:00:00.000Z');
  const intent = {
    raw_query: 'licensed retailer in dupont',
    unknown_dimensions: ['category', 'price_max_usd', 'fulfillment', 'open_now'],
    dimensions: { location: { status: 'KNOWN', value: 'dupont circle' } },
  };
  const answerabilityFrontier = buildAnswerabilityFrontier({
    tenant: 'orderweeddc.localhost', intent, claimDecisions: [], asOf: now,
  });
  const answer = {
    verified_candidate_count: 0,
    zero_verified_result: true,
    zero_result_reason: 'NO_VERIFIED_CURRENT_MATCH',
    unsupported_known_dimensions: [],
    answerability_frontier: answerabilityFrontier,
    opportunitySpec: {
      tenant: 'orderweeddc.localhost',
      kind: 'MARKET_GAP',
      retailerId: null,
      evidence: '{}',
      observedState: '{}',
      signal: 'MINIMIZED_INTENT_IR',
      hypothesizedValue: null,
      confidence: null,
      recommendedAction: 'Verify current source-authoritative evidence.',
      requiredAuthority: 'PROPOSE_ONLY',
      risk: 'LOW — proposal only',
      rollback: 'Dismiss the opportunity',
      measurementPlan: 'Close only when the exact frontier is answerable.',
    },
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => recordAskWork(p, {
    answer,
    domain: 'orderweeddc.localhost',
    intent,
    now,
  })));
  assert.equal(results.filter((result) => result.state === 'RECORDED').length, 10);
  assert.equal(results.filter((result) => result.state === 'DUPLICATE').length, 0);
  assert.equal(await p.publicSubmissionEvent.count(), 1);
  assert.equal(await p.askIntentSignal.count(), 10, 'each admitted ask remains countable demand evidence');
  assert.equal(await p.opportunity.count(), 1);
  assert.equal(await p.continuationMission.count(), 1);
  assert.equal(await p.continuationTrigger.count(), 1);
  const trigger = await p.continuationTrigger.findFirst();
  const requirement = JSON.parse(trigger.evidenceRequirements);
  assert.equal(requirement.frontierKey, answerabilityFrontier.frontier_key);
  assert.equal(requirement.frontierEvidenceDigest, answerabilityFrontier.evidence_digest);
  assert.equal(requirement.loopMode, 'REFLECTION_ONLY');
  assert.equal(trigger.authorityCeiling, 'OBSERVE_ONLY');
  assert.equal(
    JSON.parse((await p.opportunity.findFirst()).observedState)
      .demand_priority.components.admitted_signal_count,
    10,
  );
});

test('RESTORE: a logical pre-migration backup is a working database with a verifying chain', async () => {
  // The SQLite restore-is-a-file-copy proof is retired with the substrate. The
  // postgres equivalent (a dump taken before `migrate deploy`, restored into a
  // fresh database) is reproduced LOGICALLY here: stage the OLDER (baseline)
  // schema into a fresh disposable database and re-populate it to the exact
  // pre-migration snapshot, then show it is a working database that still
  // migrates forward. The physical `pg_dump | pg_restore` path is ARGUED, not
  // proven (no pg client is installed), exactly as the MariaDB path always was.
  const url = createDatabase('restored');
  const older = stage('restored', [BASELINE_MIGRATION_NAME]);
  deploy(url, older.schema);
  const p = await client(url);
  assert.equal(await indexExists(p, NEW_INDEX), false, 'the backup predates the second migration');
  await populate(p);
  const snap = await snapshot(p);
  assert.equal(snap.chainAValid, true, 'the restored ledger chain verifies');
  assert.equal(snap.ledger, popSnapBefore.ledger, 'restored ledger has the pre-migration entry count');
  assert.equal(snap.realRows, popSnapBefore.realRows);
  // And the restored database can be migrated forward again.
  deploy(url);
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
  const p = await client(popUrl);
  const before = await snapshot(p);
  const r = await runSeed({ DATABASE_URL: popUrl, DIRECT_URL: popUrl });
  assert.notEqual(r.code, 0, 'the seed must exit non-zero against a database holding real rows');
  assert.match(r.err, /SEED REFUSED/);
  assert.match(r.err, /R4_/, 'the refusal must cite the data-level rule');
  assert.deepEqual(await snapshot(p), before, 'a refused seed must not have modified ONE row');
});

test('SEED REFUSAL: NODE_ENV=production is refused before anything is touched', async () => {
  const url = createDatabase('prodenv');
  deploy(url);
  const r = await runSeed({ DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'production' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /R1_PRODUCTION_NODE_ENV/);
  const p = await client(url);
  assert.equal(await p.organization.count(), 0, 'nothing may be written on a refused seed');
});

test('SEED REFUSAL: a NON-LOOPBACK server database URL (MariaDB / remote Postgres) is refused WITHOUT connecting', async () => {
  // The hostname does not resolve; if the guard tried to connect first, this
  // would fail with a network error instead of the refusal — so the assertion
  // on R3 also proves the check happens before any connection. This is the
  // production-protection property that MUST survive the loopback amendment:
  // a real hostname is still a server database and still refused.
  const r = await runSeed({ DATABASE_URL: 'mysql://app:secret@db.internal.example:3306/orderweeddc' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /R3_SERVER_DATABASE_REFUSED/);
  assert.doesNotMatch(r.err, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/, 'refusal must precede any connection attempt');

  // A REMOTE postgres (real hostname) is refused just like MariaDB — the
  // loopback amendment widened by exactly one substrate and not one host more.
  const r2 = await runSeed({ DATABASE_URL: 'postgresql://app:secret@db.internal.example:5432/orderweeddc' });
  assert.notEqual(r2.code, 0);
  assert.match(r2.err, /R3_SERVER_DATABASE_REFUSED/);
  assert.doesNotMatch(r2.err, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/, 'remote postgres refusal must also precede any connection');

  const r3 = await runSeed({ DATABASE_URL: '' });
  assert.notEqual(r3.code, 0, 'a missing DATABASE_URL must refuse, never seed a default');
  assert.match(r3.err, /R2_DATABASE_URL_REQUIRED/);
});

test('SEED HAPPY PATH: a fresh migrated LOOPBACK postgres database seeds, and a re-seed of pure demonstration data is allowed', async () => {
  // The happy path is now a LOOPBACK PostgreSQL database (docs/adr/0001), not a
  // file: URL — file: remains allowed by R3 but is no longer the substrate the
  // application runs on, so the proof that legitimate seeding still works is on
  // the canonical substrate.
  const url = createDatabase('seedok');
  deploy(url);
  const r = await runSeed({ DATABASE_URL: url, DIRECT_URL: url });
  assert.equal(r.code, 0, `legitimate loopback seeding must work: ${r.err.slice(0, 400)}`);
  const p = await client(url);
  assert.ok(await p.retailer.count() > 0);
  assert.equal(await p.retailer.count({ where: { isDemonstration: false } }), 0,
    'the seed itself must introduce ONLY demonstration rows');
  // Re-seed: a database holding only demonstration data is a legitimate target.
  const r2 = await runSeed({ DATABASE_URL: url, DIRECT_URL: url });
  assert.equal(r2.code, 0, `re-seeding a demonstration database must work: ${r2.err.slice(0, 400)}`);
});

test('SEED REFUSAL: a client-forged custom GUC cannot impersonate a disposable PostgreSQL cluster', async () => {
  const url = createDatabase('forged_identity');
  deploy(url);
  const forgedGuc = 'a'.repeat(64);
  const forgedUrl = `${url}?options=${encodeURIComponent(`-c cana.disposable_attestation=${forgedGuc}`)}`;
  const r = await runSeed({
    DATABASE_URL: forgedUrl,
    DIRECT_URL: forgedUrl,
    CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER: '9999999999999999999',
  });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /R3_DISPOSABLE_SYSTEM_ID_MISMATCH/);
  const p = await client(url);
  assert.equal(await p.retailer.count(), 0, 'identity refusal must precede destructive or seed writes');
});

test('the refusal rules themselves are visible and testable as data', async () => {
  // file: is still a SAFE substrate (R3 allows it) — no environment refusal.
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'file:./x.db', nodeEnv: 'test' }).length, 0);
  // A LOOPBACK postgres URL is the new SAFE substrate — also no refusal.
  const systemIdentifier = process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER;
  assert.match(systemIdentifier ?? '', /^\d{10,}$/);
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'postgresql://postgres@127.0.0.1:5432/court_x', nodeEnv: 'test', disposableSystemIdentifier: systemIdentifier }).length, 0);
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'postgresql://postgres@localhost:5432/court_x', nodeEnv: 'test', disposableSystemIdentifier: systemIdentifier }).length, 0);
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'postgresql://postgres@127.0.0.1:5432/court_x', nodeEnv: 'test' })[0].rule, 'R3_DISPOSABLE_SYSTEM_ID_REQUIRED');
  // Production is refused whatever the URL.
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'file:./x.db', nodeEnv: 'production' })[0].rule, 'R1_PRODUCTION_NODE_ENV');
  // A REMOTE postgres (real hostname) is a server database — still R3.
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'postgresql://app:secret@db.internal.example:5432/x', nodeEnv: 'test' })[0].rule, 'R3_SERVER_DATABASE_REFUSED');
  assert.equal(environmentRefusalsForSeed({ databaseUrl: 'mysql://h/db', nodeEnv: 'test' })[0].rule, 'R3_SERVER_DATABASE_REFUSED');
  assert.equal(environmentRefusalsForSeed({ databaseUrl: '', nodeEnv: 'test' })[0].rule, 'R2_DATABASE_URL_REQUIRED');
  // Data rules run against the populated court database and find every category.
  const p = await client(popUrl);
  const refusals = await dataRefusalsForSeed(p);
  const rules = new Set(refusals.map((r) => r.rule));
  assert.ok(rules.has('R4_REAL_DATA_PRESENT'));
  assert.ok(rules.has('R4_LEDGER_PRESENT'));
  assert.ok(rules.has('R4_LEAD_EVENTS_PRESENT'));
  assert.ok(rules.has('R4_REAL_USERS_PRESENT'));
});

/* ─────────────────────────── 6. BOOKKEEPING ─────────────────────────────── */

test('provider classification fails closed and the reviewed migration manifest exactly matches disk', () => {
  assert.equal(databaseProviderOf('file:./dev.db'), 'sqlite');
  assert.equal(databaseProviderOf('mysql://h/db'), 'mysql');
  assert.equal(databaseProviderOf('mariadb://h/db'), 'mysql');
  assert.equal(databaseProviderOf('postgresql://h/db'), 'postgresql');
  assert.equal(databaseProviderOf('postgres://h/db'), 'postgresql');
  assert.equal(databaseProviderOf('mongodb://h/db'), 'unknown');
  assert.equal(databaseProviderOf(undefined), 'unknown');
  // Approval is explicit rather than derived from arbitrary directories. The
  // stored down.sql is operator-invoked only; its guarded inverse is exercised above.
  const verified = validateCanonicalMigrationUniverse({
    migrationsDir: MIGRATIONS,
    manifest: loadCanonicalMigrationManifest(),
  });
  assert.deepEqual(
    verified.migrations.map((entry) => entry.name),
    [
      BASELINE_MIGRATION_NAME,
      SECOND_MIGRATION,
      GEO_MIGRATION,
      CONTINUATION_MIGRATION,
      REALITY_MIGRATION,
      LIVE_REALITY_MIGRATION,
      CANA_EVIDENCE_BRIDGE_MIGRATION,
    ],
  );
});
