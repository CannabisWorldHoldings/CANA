#!/usr/bin/env node
// P1 CUTOVER PRE-FLIGHT — bounded, READ-ONLY machine check.
// Answers CUTOVER_READY or CUTOVER_REFUSED with machine-readable reasons.
// Mutates NOTHING: no writes, no migrations, no prisma db push — diagnosis only.
//
// Usage:
//   DATABASE_URL=... DIRECT_URL=... [OWD_EXPECTED_SHA=<40-hex>] \
//     node apps/web/scripts/cutover-preflight.mjs
import { execFileSync } from 'node:child_process';

const checks = [];
const check = (id, ok, detail) => { checks.push({ id, ok: Boolean(ok), detail }); return Boolean(ok); };
const DB_PROBE_IDS = [
  'db.reachable',
  'db.extension.postgis',
  'db.extension.h3',
  'db.extension.h3_postgis',
  'db.migrations.ledger',
  'db.store.operational',
];

function url(name) {
  try {
    const value = new URL(process.env[name] ?? '');
    return value;
  } catch {
    return null;
  }
}

function git(...args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return null; }
}

const dbUrl = url('DATABASE_URL');
const directUrl = url('DIRECT_URL');

// DATABASE — protocol + strict TLS law (ADR-0001: PostgreSQL only, no interim store).
check('db.protocol.postgres', dbUrl && ['postgres:', 'postgresql:'].includes(dbUrl.protocol),
  dbUrl ? dbUrl.protocol : 'DATABASE_URL missing/invalid');
check('db.direct.protocol.postgres', directUrl && ['postgres:', 'postgresql:'].includes(directUrl.protocol),
  directUrl ? directUrl.protocol : 'DIRECT_URL missing/invalid');
const loopback = dbUrl && ['127.0.0.1', 'localhost', '::1'].includes(dbUrl.hostname);
check('db.tls.strict', loopback
  || (dbUrl?.searchParams.get('sslmode') === 'require' && dbUrl?.searchParams.get('sslaccept') === 'strict'),
  loopback ? 'loopback (verifier cluster) — TLS law waived' : dbUrl?.search ?? 'no TLS params');

let prisma = null;
let engineLoadable = false;
try {
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  engineLoadable = true;
} catch (error) {
  check('prisma.engine.loadable', false, String(error?.message ?? error).slice(0, 200));
}
if (engineLoadable) check('prisma.engine.loadable', true, 'client constructed');

let dbProbeRefusal = 'not probed — configuration or engine refusal';
if (prisma && checks.every((c) => c.id.startsWith('db.') ? c.ok : true)) {
  try {
    const [identity] = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS database, version() AS version',
    );
    check('db.reachable', true, `${identity.database} — ${String(identity.version).slice(0, 40)}`);
    const extensions = (await prisma.$queryRawUnsafe('SELECT extname FROM pg_extension')).map((r) => r.extname);
    check('db.extension.postgis', extensions.includes('postgis'), extensions.join(','));
    check('db.extension.h3', extensions.includes('h3'), 'required on production target (ADR-0002)');
    check('db.extension.h3_postgis', extensions.includes('h3_postgis'), 'required on production target (ADR-0002)');
    // Migration compatibility — READ the ledger, never apply.
    try {
      const migrations = await prisma.$queryRawUnsafe(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at',
      );
      const unfinished = migrations.filter((m) => !m.finished_at || m.rolled_back_at);
      check('db.migrations.ledger', unfinished.length === 0,
        `${migrations.length} applied, ${unfinished.length} unfinished/rolled-back`);
    } catch {
      check('db.migrations.ledger', false, '_prisma_migrations absent — fresh DB requires the committed migration chain first');
    }
    // Transaction store operational — read-only probe of the durable models.
    try {
      const events = await prisma.marketSourceAcquisitionEvent.count();
      const artifacts = await prisma.marketSourceContentArtifact.count();
      check('db.store.operational', true, `acquisition_events=${events} content_artifacts=${artifacts}`);
    } catch (error) {
      check('db.store.operational', false, String(error?.message ?? error).slice(0, 160));
    }
  } catch (error) {
    dbProbeRefusal = String(error?.message ?? error).slice(0, 200);
    if (!checks.some((c) => c.id === 'db.reachable')) check('db.reachable', false, dbProbeRefusal);
  }
}
for (const id of DB_PROBE_IDS) {
  if (!checks.some((c) => c.id === id)) check(id, false, dbProbeRefusal);
}
if (prisma) await prisma.$disconnect().catch(() => {});

// APPLICATION — canonical SHA expectation.
const head = git('rev-parse', 'HEAD');
const expected = process.env.OWD_EXPECTED_SHA ?? null;
check('app.repository.head', Boolean(head), head ?? 'not a git checkout');
check('app.expected.sha', !expected || expected === head,
  expected ? `expected ${expected} — head ${head}` : 'OWD_EXPECTED_SHA not set (informational)');
check('app.clean.head', git('status', '--porcelain') === '', 'working tree must be clean for a release build');

// DATA — backup receipt presence (path supplied by operator).
const backupReceipt = process.env.CANA_PRE_MIGRATION_BACKUP_RECEIPT ?? null;
check('data.backup.receipt.present', Boolean(backupReceipt), backupReceipt
  ? 'non-empty value present — presence only; provider/operator verification and authorization remain external'
  : 'CANA_PRE_MIGRATION_BACKUP_RECEIPT not set — required before migrate.sh');

const refusals = checks.filter((c) => !c.ok);
const verdict = refusals.length === 0 ? 'CUTOVER_READY' : 'CUTOVER_REFUSED';
console.log(JSON.stringify({
  schema_version: 'cana-cutover-preflight/v1',
  verdict,
  checked_at: new Date().toISOString(),
  repository_head: head,
  checks,
  refusal_reasons: refusals.map((c) => c.id),
  mutations: 0,
}, null, 2));
process.exitCode = verdict === 'CUTOVER_READY' ? 0 : 1;
