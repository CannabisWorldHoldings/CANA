import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { hashBody } from '../../apps/web/src/lib/demand-credits.mjs';
import {
  receiptDirectory,
  sha256Bytes,
  sha256File,
  writeReceipt,
} from '../test-runner/receipt.mjs';
import { generateCandidate } from './generate-schema.mjs';

export const MARIA_IMAGE =
  'mariadb@sha256:54ac814d243128263e18cf818f7abb611bf43a7a95ce8aa102d18f527b1516d1';
const APPROVED_NODE_IMAGE =
  'node@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';
const NODE_IMAGE = process.env.CANA_VERIFY_IMAGE ?? APPROVED_NODE_IMAGE;
const BASE_COMMIT = 'c953ebcd25c46ef33af0700d7913a899d839bce8';

function command(commandName, args, {
  cwd,
  input,
  timeout = 60_000,
  allowFailure = false,
  maxBuffer = 64 * 1024 * 1024,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    input,
    timeout,
    encoding: 'utf8',
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`${commandName} failed to start: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${commandName} ${args.slice(0, 3).join(' ')} exited ${result.status}: ${
        result.stderr || result.stdout
      }`,
    );
  }
  return result;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function ensureImage(image) {
  let result = command(
    'docker',
    ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'],
    { allowFailure: true, timeout: 30_000 },
  );
  if (result.status !== 0) {
    command('docker', ['pull', image], { timeout: 8 * 60_000 });
    result = command(
      'docker',
      ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'],
      { timeout: 30_000 },
    );
  }
  return result.stdout.trim();
}

function hex(value) {
  return `0x${Buffer.from(value, 'utf8').toString('hex')}`;
}

function exactJson(size) {
  const fixed = JSON.stringify({ value: '' }).length;
  if (size < fixed) throw new Error(`JSON size ${size} is below the fixed envelope`);
  const value = JSON.stringify({ value: 'x'.repeat(size - fixed) });
  if (Buffer.byteLength(value) !== size) throw new Error(`failed to build ${size}-byte JSON`);
  return value;
}

function chain64() {
  return JSON.stringify(
    Array.from({ length: 64 }, (_, index) => ({
      step: `step-${index + 1}`,
      ref: `ref-${index + 1}-${'x'.repeat(700)}`,
    })),
  );
}

function markdownReport(body) {
  const rows = body.checks
    .map((entry) => `| ${entry.pass ? 'PASS' : 'FAIL'} | ${entry.name} | ${entry.evidence} |`)
    .join('\n');
  return `# MariaDB 11.4 candidate execution report

- Commit: \`${body.source.commit}\`
- Tree: \`${body.source.tree}\`
- Image: \`${body.substrate.image}\`
- Image digest: \`${body.substrate.digest}\`
- Overall: **${body.overall}**
- Live Prisma schema changed: **NO**
- Provider flip merged: **NO**

| Result | Scenario | Executed evidence |
| --- | --- | --- |
${rows}

## Evidence boundary

The application approves at most 64 evidence links but does not bound the serialized byte length of each link. The executed matrix therefore proves 405-byte, 1 KiB, representative 64-link, and MariaDB TEXT-boundary chains. A finite business-approved maximum remains unproven and is not inferred from the database limit.

## Cleanup

Database container removed: ${body.cleanup.databaseContainerRemoved}. Client container removed: ${body.cleanup.clientContainerRemoved}. Dependency container removed: ${body.cleanup.dependencyContainerRemoved}. Dependency volume removed: ${body.cleanup.dependencyVolumeRemoved}. Network removed: ${body.cleanup.networkRemoved}.
`;
}

function tail(value, limit = 8_000) {
  return value.length <= limit ? value : value.slice(-limit);
}

function git(repoRoot, args) {
  return command('git', args, { cwd: repoRoot }).stdout.trim();
}

function sqlClientArgs(container, password, database = 'cana', user = 'root') {
  const args = [
    'exec',
    '-i',
    container,
    'mariadb',
    '--batch',
    '--skip-column-names',
    '--raw',
    '--default-character-set=utf8mb4',
    `-u${user}`,
    `-p${password}`,
  ];
  if (database) args.push(database);
  return args;
}

function sql(container, password, statement, {
  database = 'cana',
  user = 'root',
  allowFailure = false,
  timeout = 60_000,
} = {}) {
  return command('docker', sqlClientArgs(container, password, database, user), {
    input: `${statement}\n`,
    allowFailure,
    timeout,
  });
}

function sqlAsync(container, password, statement, {
  database = 'cana',
  user = 'root',
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', sqlClientArgs(container, password, database, user), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(`${statement}\n`);
  });
}

function waitForMaria(container) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = command(
      'docker',
      ['exec', container, 'healthcheck.sh', '--connect', '--innodb_initialized'],
      { allowFailure: true, timeout: 5_000 },
    );
    if (result.status === 0) return;
    sleep(1_000);
  }
  throw new Error('MariaDB did not become healthy within 90 seconds');
}

function waitForContainerRemoval(container) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (command('docker', ['inspect', container], { allowFailure: true }).status !== 0) {
      return true;
    }
    sleep(100);
  }
  return false;
}

function applyPrismaCandidate({
  repoRoot,
  runRoot,
  network,
  databaseContainer,
  clientContainer,
  dependencyContainer,
  dependencyVolume,
  password,
  commit,
}) {
  const bundle = path.join(runRoot, 'candidate.bundle');
  const packageFiles = [
    'package.json',
    'package-lock.json',
    'apps/web/package.json',
    'packages/ad-creative/package.json',
    'packages/ai/package.json',
  ];
  command('git', ['bundle', 'create', bundle, 'HEAD'], {
    cwd: repoRoot,
    timeout: 120_000,
  });
  command('docker', ['volume', 'create', dependencyVolume], { timeout: 30_000 });
  command('docker', [
    'create',
    '--name',
    dependencyContainer,
    '-w',
    '/workspace',
    '--mount',
    `type=volume,source=${dependencyVolume},target=/workspace/node_modules`,
    NODE_IMAGE,
    'bash',
    '-lc',
    'sleep infinity',
  ]);
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
      ['cp', path.join(repoRoot, file), `${dependencyContainer}:/workspace/${file}`],
      { timeout: 30_000 },
    );
  }
  const install = command('docker', [
    'exec',
    dependencyContainer,
    'npm',
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], {
    allowFailure: true,
    timeout: 12 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (install.status !== 0) {
    throw new Error(`provider-specific Prisma dependency install failed:\n${tail(install.stdout + install.stderr)}`);
  }
  const candidateAbsentDuringFetch = command(
    'docker',
    [
      'exec',
      dependencyContainer,
      'bash',
      '-lc',
      'test ! -e /candidate.bundle && test ! -e /workspace/tools && test ! -e /workspace/.git',
    ],
    { allowFailure: true, timeout: 30_000 },
  ).status === 0;
  if (!candidateAbsentDuringFetch) {
    throw new Error('candidate source became visible during dependency fetch');
  }
  command('docker', ['rm', '-f', dependencyContainer], { timeout: 30_000 });
  const dependencyRemovedBeforeExecution = waitForContainerRemoval(dependencyContainer);
  if (!dependencyRemovedBeforeExecution) {
    throw new Error('dependency fetch container survived into candidate execution');
  }
  command('docker', [
    'create',
    '--name',
    clientContainer,
    '--network',
    network,
    '-w',
    '/workspace',
    '--mount',
    `type=volume,source=${dependencyVolume},target=/workspace/node_modules`,
    NODE_IMAGE,
    'bash',
    '-lc',
    'sleep infinity',
  ]);
  command('docker', ['cp', bundle, `${clientContainer}:/candidate.bundle`], {
    timeout: 120_000,
  });
  command('docker', ['start', clientContainer]);
  command('docker', [
    'exec',
    clientContainer,
    'bash',
    '-lc',
    `git clone --quiet /candidate.bundle /clone && git -C /clone checkout --quiet ${commit} && cp -a /clone/. /workspace/`,
  ], { timeout: 120_000 });
  const networkIsInternal =
    command('docker', ['network', 'inspect', network, '--format', '{{.Internal}}']).stdout.trim() ===
    'true';
  const bridgeAttached =
    command(
      'docker',
      ['inspect', clientContainer, '--format', '{{if index .NetworkSettings.Networks "bridge"}}true{{else}}false{{end}}'],
    ).stdout.trim() === 'true';
  if (!networkIsInternal || bridgeAttached) {
    throw new Error(
      `candidate execution network is not isolated: internal=${networkIsInternal} bridge=${bridgeAttached}`,
    );
  }
  const databaseUrl = `mysql://root:${password}@maria:3306/cana`;
  const result = command('docker', [
    'exec',
    '-e',
    `DATABASE_URL=${databaseUrl}`,
    clientContainer,
    'bash',
    '-lc',
    'cd /workspace/apps/web && npx prisma validate --schema ../../tools/mariadb-sim/schema.prisma && npx prisma db push --schema ../../tools/mariadb-sim/schema.prisma --skip-generate',
  ], {
    allowFailure: true,
    timeout: 12 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const databaseLogs = command('docker', ['logs', databaseContainer], {
      allowFailure: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    throw new Error(
      `provider-specific Prisma candidate failed:\n${tail(result.stdout + result.stderr)}\nMariaDB:\n${tail(databaseLogs.stdout + databaseLogs.stderr)}`,
    );
  }
  return {
    outputSha256: sha256Bytes(result.stdout + result.stderr),
    outputTail: tail(result.stdout + result.stderr, 2_000),
    networkPolicy: {
      dependencyFetchSourceMounted: false,
      dependencyFetchLifecycleScriptsEnabled: false,
      dependencyRemovedBeforeExecution,
      candidateExecutionInternalOnly: networkIsInternal,
      candidateExecutionBridgeAttached: bridgeAttached,
    },
  };
}

async function runDbConfigInformationSchemaProbe({
  repoRoot,
  runRoot,
  databaseContainer,
  password,
}) {
  const sourceFile = path.join(repoRoot, 'apps', 'web', 'src', 'lib', 'db-config.mjs');
  const instrumented = path.join(runRoot, 'db-config-probe.mjs');
  fs.writeFileSync(
    instrumented,
    `${fs.readFileSync(sourceFile, 'utf8')}\nexport { probeApplicationTables as __canaProbeApplicationTables };\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  const queries = [];
  const prisma = {
    async $queryRawUnsafe(statement) {
      queries.push(statement);
      return sql(databaseContainer, password, statement).stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((table_name) => ({ table_name }));
    },
  };
  const module = await import(
    `${pathToFileURL(instrumented).href}?run=${crypto.randomBytes(8).toString('hex')}`
  );
  const found = await module.__canaProbeApplicationTables(prisma, 'mysql');
  return {
    found,
    query: queries.at(-1) ?? '',
    sourceSha256: sha256File(sourceFile),
  };
}

function check(checks, name, pass, evidence) {
  const entry = { name, pass: Boolean(pass), evidence: String(evidence).replaceAll('|', '\\|') };
  checks.push(entry);
  if (!entry.pass) throw new Error(`${name} failed: ${evidence}`);
}

function createDemandInsert({
  seq,
  merchant,
  entryHash,
  eventIdentity,
  evidenceChain,
  digest,
  observedAt = '2026-07-27 01:23:45.987654',
  kind = 'ATTRIBUTION',
}) {
  const identity = eventIdentity === null ? 'NULL' : hex(eventIdentity);
  const chain = evidenceChain === null ? 'NULL' : hex(evidenceChain);
  const chainDigest = digest === null ? 'NULL' : hex(digest);
  return `INSERT INTO DemandCreditEntry
    (seq,id,merchantId,kind,amount,prevHash,entryHash,eventIdentity,evidenceChain,evidenceChainSha256,observedAt)
    VALUES (${seq},${hex(`id-${entryHash}`)},${hex(merchant)},${hex(kind)},0,${hex('0'.repeat(64))},${hex(entryHash)},${identity},${chain},${chainDigest},'${observedAt}')`;
}

export async function runMariaSimulation({ repoRoot }) {
  const startedAt = new Date().toISOString();
  const source = {
    commit: git(repoRoot, ['rev-parse', 'HEAD']),
    tree: git(repoRoot, ['rev-parse', 'HEAD^{tree}']),
    branch: git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    status: git(repoRoot, ['status', '--porcelain']),
  };
  if (source.status) {
    throw new Error(`MariaDB verification refuses a dirty source:\n${source.status}`);
  }
  if (NODE_IMAGE !== APPROVED_NODE_IMAGE) {
    throw new Error(
      `CANA_VERIFY_IMAGE is not approved; expected immutable ${APPROVED_NODE_IMAGE}`,
    );
  }
  command('docker', ['info'], { timeout: 30_000 });
  const mariaDigest = ensureImage(MARIA_IMAGE);
  ensureImage(NODE_IMAGE);

  const sourceSchema = path.join(repoRoot, 'apps', 'web', 'prisma', 'schema.prisma');
  const candidateSchema = path.join(repoRoot, 'tools', 'mariadb-sim', 'schema.prisma');
  const generated = generateCandidate(fs.readFileSync(sourceSchema, 'utf8'));
  if (generated !== fs.readFileSync(candidateSchema, 'utf8')) {
    throw new Error('MariaDB candidate schema is stale; regenerate it before verification');
  }

  const suffix = crypto.randomBytes(6).toString('hex');
  const databaseContainer = `cana-maria-db-${suffix}`;
  const clientContainer = `cana-maria-client-${suffix}`;
  const dependencyContainer = `cana-maria-deps-${suffix}`;
  const dependencyVolume = `cana-maria-deps-${suffix}`;
  const network = `cana-maria-net-${suffix}`;
  const password = crypto.randomBytes(24).toString('hex');
  const appPassword = crypto.randomBytes(24).toString('hex');
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-maria-'));
  const checks = [];
  let failure = null;
  let prisma = null;
  let databaseCreated = false;
  let clientCreated = false;
  let networkCreated = false;
  let dumpSha256 = null;
  let dumpBytes = null;

  try {
    command('docker', ['network', 'create', '--internal', network]);
    networkCreated = true;
    command('docker', [
      'create',
      '--name',
      databaseContainer,
      '--network',
      network,
      '--network-alias',
      'maria',
      '--tmpfs',
      '/var/lib/mysql:rw,noexec,nosuid,size=768m',
      '-e',
      `MARIADB_ROOT_PASSWORD=${password}`,
      '-e',
      'MARIADB_DATABASE=cana',
      MARIA_IMAGE,
    ]);
    databaseCreated = true;
    command('docker', ['start', databaseContainer]);
    waitForMaria(databaseContainer);

    prisma = applyPrismaCandidate({
      repoRoot,
      runRoot,
      network,
      databaseContainer,
      clientContainer,
      dependencyContainer,
      dependencyVolume,
      password,
      commit: source.commit,
    });
    clientCreated = true;
    check(
      checks,
      'provider-specific Prisma candidate',
      prisma.outputTail.includes('Your database is now in sync') &&
        prisma.networkPolicy.dependencyFetchSourceMounted === false &&
        prisma.networkPolicy.dependencyFetchLifecycleScriptsEnabled === false &&
        prisma.networkPolicy.dependencyRemovedBeforeExecution === true &&
        prisma.networkPolicy.candidateExecutionInternalOnly === true &&
        prisma.networkPolicy.candidateExecutionBridgeAttached === false,
      `mysql candidate validated and pushed after manifest-only, ignore-scripts dependency fetch; candidate execution internal-only; output sha256 ${prisma.outputSha256}`,
    );

    const dbConfigProbe = await runDbConfigInformationSchemaProbe({
      repoRoot,
      runRoot,
      databaseContainer,
      password,
    });
    check(
      checks,
      'db-config information_schema provider branch',
      dbConfigProbe.found &&
        /information_schema\.tables/i.test(dbConfigProbe.query) &&
        !/sqlite_master/i.test(dbConfigProbe.query),
      `unchanged db-config ${dbConfigProbe.sourceSha256} executed its MariaDB branch and found Organization`,
    );

    const cutoverSql = fs.readFileSync(
      path.join(repoRoot, 'tools', 'mariadb-sim', 'candidate-cutover.sql'),
      'utf8',
    );
    sql(databaseContainer, password, cutoverSql);

    const liveDiff = command(
      'git',
      ['diff', '--quiet', BASE_COMMIT, '--', 'apps/web/prisma/schema.prisma'],
      { cwd: repoRoot, allowFailure: true },
    );
    check(
      checks,
      'live provider remains unchanged',
      liveDiff.status === 0 && /provider\s*=\s*"sqlite"/.test(fs.readFileSync(sourceSchema, 'utf8')),
      `live schema sha256 ${sha256File(sourceSchema)}; candidate sha256 ${sha256File(candidateSchema)}`,
    );

    const expectedTextColumns = [
      'Article.content',
      'AuditLog.details',
      'Brand.description',
      'Deal.description',
      'DemandCreditEntry.evidenceChain',
      'Dispute.newValue',
      'Dispute.oldValue',
      'LicenseEvidence.notes',
      'LoyaltyTransaction.description',
      'Product.description',
      'SiteObservation.evidence',
      'SiteObservation.preparedAction',
      'SiteObservation.summary',
      'SiteObservation.uncertainty',
      'StagingABCARetailer.rawJson',
    ];
    const textRows = sql(
      databaseContainer,
      password,
      `SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME,':',DATA_TYPE)
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA='cana' AND DATA_TYPE='text'
       ORDER BY TABLE_NAME,COLUMN_NAME`,
    ).stdout.trim().split('\n');
    check(
      checks,
      'atomic long-column cutover',
      expectedTextColumns.every((column) => textRows.includes(`${column}:text`)),
      `${expectedTextColumns.length}/${expectedTextColumns.length} required columns are TEXT`,
    );

    const sizes = [
      ['chain-405', exactJson(405)],
      ['chain-1024', exactJson(1024)],
      ['chain-64-links', chain64()],
      ['chain-text-boundary', exactJson(65_535)],
    ];
    for (const [name, value] of sizes) {
      const digest = crypto.createHash('sha256').update(value).digest('hex');
      sql(
        databaseContainer,
        password,
        `${createDemandInsert({
          seq: sizes.findIndex(([candidate]) => candidate === name) + 1,
          merchant: 'merchant-chain',
          entryHash: crypto.createHash('sha256').update(name).digest('hex'),
          eventIdentity: name,
          evidenceChain: value,
          digest,
        })};`,
      );
      const row = sql(
        databaseContainer,
        password,
        `SELECT OCTET_LENGTH(evidenceChain),evidenceChainSha256,JSON_VALID(evidenceChain),SHA2(evidenceChain,256)
         FROM DemandCreditEntry WHERE eventIdentity=${hex(name)}`,
      ).stdout.trim().split('\t');
      check(
        checks,
        `evidence round-trip ${name}`,
        Number(row[0]) === Buffer.byteLength(value) && row[1] === digest && row[2] === '1' && row[3] === digest,
        `${row[0]} bytes; JSON valid; host and database digest ${digest}`,
      );
    }

    sql(
      databaseContainer,
      password,
      'CREATE TABLE ModeProbe (id INT PRIMARY KEY, value VARCHAR(191))',
    );
    const strict = sql(
      databaseContainer,
      password,
      `SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
       INSERT INTO ModeProbe VALUES (1,${hex('x'.repeat(405))})`,
      { allowFailure: true },
    );
    check(
      checks,
      'strict SQL mode',
      strict.status !== 0 && /Data too long|1406/i.test(strict.stderr),
      'VARCHAR(191) rejects a 405-byte control while @db.Text chains preserve larger values',
    );
    const nonStrict = sql(
      databaseContainer,
      password,
      `SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION';
       INSERT INTO ModeProbe VALUES (2,${hex('x'.repeat(405))});
       SELECT OCTET_LENGTH(value) FROM ModeProbe WHERE id=2`,
    ).stdout.trim().split('\n').at(-1);
    check(
      checks,
      'non-strict SQL mode',
      nonStrict === '191',
      'the control truncates to 191 bytes, proving why all long fields require @db.Text',
    );

    const overflow = exactJson(65_536);
    const overflowDigest = crypto.createHash('sha256').update(overflow).digest('hex');
    const strictOverflow = sql(
      databaseContainer,
      password,
      `SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
       ${createDemandInsert({
         seq: 5,
         merchant: 'merchant-chain',
         entryHash: crypto.createHash('sha256').update('strict-overflow').digest('hex'),
         eventIdentity: 'strict-overflow',
         evidenceChain: overflow,
         digest: overflowDigest,
       })}`,
      { allowFailure: true },
    );
    check(
      checks,
      'TEXT strict overflow',
      strictOverflow.status !== 0 && /Data too long|1406/i.test(strictOverflow.stderr),
      '65,536-byte chain is rejected at the MariaDB TEXT boundary',
    );
    const nonStrictOverflow = sql(
      databaseContainer,
      password,
      `SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION';
       ${createDemandInsert({
         seq: 6,
         merchant: 'merchant-chain',
         entryHash: crypto.createHash('sha256').update('nonstrict-overflow').digest('hex'),
         eventIdentity: 'nonstrict-overflow',
         evidenceChain: overflow,
         digest: overflowDigest,
       })};
       SELECT OCTET_LENGTH(evidenceChain),JSON_VALID(evidenceChain),SHA2(evidenceChain,256)=evidenceChainSha256
       FROM DemandCreditEntry WHERE eventIdentity=${hex('nonstrict-overflow')}`,
    ).stdout.trim().split('\n').at(-1).split('\t');
    check(
      checks,
      'TEXT non-strict overflow falsification',
      nonStrictOverflow[0] === '65535' && nonStrictOverflow[1] === '0' && nonStrictOverflow[2] === '0',
      'non-strict mode truncates overflow and invalidates both JSON and digest equality',
    );

    const datetimeType = sql(
      databaseContainer,
      password,
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA='cana' AND TABLE_NAME='DemandCreditEntry' AND COLUMN_NAME='observedAt'`,
    ).stdout.trim();
    const datetimeDraft = {
      merchantId: 'merchant-chain',
      kind: 'ATTRIBUTION',
      amount: 0,
      seq: 7,
      observedAt: new Date('2026-07-27T01:23:45.987Z'),
    };
    const datetimeEntryHash = hashBody(datetimeDraft, '0'.repeat(64));
    sql(
      databaseContainer,
      password,
      `${createDemandInsert({
        seq: datetimeDraft.seq,
        merchant: datetimeDraft.merchantId,
        entryHash: datetimeEntryHash,
        eventIdentity: 'datetime-entry-hash',
        evidenceChain: null,
        digest: null,
        observedAt: '2026-07-27 01:23:45.987654',
      })}`,
    );
    const datetimeRow = sql(
      databaseContainer,
      password,
      `SELECT entryHash,DATE_FORMAT(observedAt,'%Y-%m-%dT%H:%i:%s.%fZ')
       FROM DemandCreditEntry WHERE eventIdentity=${hex('datetime-entry-hash')}`,
    ).stdout.trim().split('\t');
    const databaseObservedAt = new Date(
      datetimeRow[1].replace(/(\.\d{3})\d{3}Z$/, '$1Z'),
    );
    const recomputedEntryHash = hashBody(
      { ...datetimeDraft, observedAt: databaseObservedAt },
      '0'.repeat(64),
    );
    check(
      checks,
      'DATETIME(3) ledger entryHash round-trip',
      datetimeType === 'datetime(3)' &&
        datetimeRow[1].endsWith('.987000Z') &&
        datetimeRow[0] === datetimeEntryHash &&
        recomputedEntryHash === datetimeEntryHash,
      `${datetimeType}; .987654 stored as .987000; persisted and recomputed entryHash ${datetimeEntryHash}`,
    );

    sql(
      databaseContainer,
      password,
      `INSERT INTO Organization (id,name,createdAt,updatedAt)
       VALUES ('org-collation','Collation Org',NOW(3),NOW(3));
       INSERT INTO Brand (id,name,domain,organizationId,createdAt,updatedAt)
       VALUES ('brand-collation-1','Brand One','Case.Example.test','org-collation',NOW(3),NOW(3));
       INSERT INTO \`User\` (id,email,password,createdAt,updatedAt)
       VALUES ('user-collation-1','Case@Example.test','not-a-real-password',NOW(3),NOW(3))`,
    );
    const brandCollision = sql(
      databaseContainer,
      password,
      `INSERT INTO Brand (id,name,domain,organizationId,createdAt,updatedAt)
       VALUES ('brand-collation-2','Brand Two','case.example.test','org-collation',NOW(3),NOW(3))`,
      { allowFailure: true },
    );
    check(
      checks,
      'Brand.domain utf8mb4 collation collision',
      brandCollision.status !== 0 && /Duplicate entry|1062/i.test(brandCollision.stderr),
      'case-only Brand.domain variants collide on the generated model unique constraint',
    );
    const userCollision = sql(
      databaseContainer,
      password,
      `INSERT INTO \`User\` (id,email,password,createdAt,updatedAt)
       VALUES ('user-collation-2','case@example.test','not-a-real-password',NOW(3),NOW(3))`,
      { allowFailure: true },
    );
    check(
      checks,
      'User.email utf8mb4 collation collision',
      userCollision.status !== 0 && /Duplicate entry|1062/i.test(userCollision.stderr),
      'case-only User.email variants collide on the generated model unique constraint',
    );

    const duplicate = sql(
      databaseContainer,
      password,
      `${createDemandInsert({
        seq: 7,
        merchant: 'merchant-chain',
        entryHash: crypto.createHash('sha256').update('duplicate').digest('hex'),
        eventIdentity: 'chain-405',
        evidenceChain: null,
        digest: null,
      })}`,
      { allowFailure: true },
    );
    check(
      checks,
      'duplicate event identity',
      duplicate.status !== 0 && /Duplicate entry|1062/i.test(duplicate.stderr),
      'database unique constraint rejects the second merchant/event identity',
    );

    const nullAttribution = sql(
      databaseContainer,
      password,
      `${createDemandInsert({
        seq: 8,
        merchant: 'merchant-chain',
        entryHash: crypto.createHash('sha256').update('null-attribution').digest('hex'),
        eventIdentity: null,
        evidenceChain: null,
        digest: null,
      })}`,
      { allowFailure: true },
    );
    const nullMoney = sql(
      databaseContainer,
      password,
      `${createDemandInsert({
        seq: 1,
        merchant: 'merchant-money',
        entryHash: crypto.createHash('sha256').update('null-money').digest('hex'),
        eventIdentity: null,
        evidenceChain: null,
        digest: null,
        kind: 'ISSUE',
      })}`,
      { allowFailure: true },
    );
    const secondNullMoney = sql(
      databaseContainer,
      password,
      `${createDemandInsert({
        seq: 2,
        merchant: 'merchant-money',
        entryHash: crypto.createHash('sha256').update('null-money-second').digest('hex'),
        eventIdentity: null,
        evidenceChain: null,
        digest: null,
        kind: 'ISSUE',
      })}`,
      { allowFailure: true },
    );
    const nullMoneyCount = sql(
      databaseContainer,
      password,
      "SELECT COUNT(*) FROM DemandCreditEntry WHERE merchantId='merchant-money' AND eventIdentity IS NULL",
    ).stdout.trim();
    check(
      checks,
      'NULL-distinct unique index and attribution fail closed',
      nullAttribution.status !== 0 &&
        /CONSTRAINT|4025/i.test(nullAttribution.stderr) &&
        nullMoney.status === 0 &&
        secondNullMoney.status === 0 &&
        nullMoneyCount === '2',
      'two same-merchant money rows with NULL identity coexist while ATTRIBUTION NULL is rejected',
    );

    sql(
      databaseContainer,
      password,
      'CREATE TABLE SequenceProbe (merchantId VARCHAR(191), seq INT, UNIQUE KEY uq_sequence (merchantId,seq))',
    );
    const sequenceStatements = `START TRANSACTION;
      INSERT INTO SequenceProbe VALUES ('merchant-race',1);
      DO SLEEP(1);
      COMMIT`;
    const sequenceResults = await Promise.all([
      sqlAsync(databaseContainer, password, sequenceStatements),
      sqlAsync(databaseContainer, password, sequenceStatements),
    ]);
    const sequenceCount = sql(
      databaseContainer,
      password,
      "SELECT COUNT(*) FROM SequenceProbe WHERE merchantId='merchant-race' AND seq=1",
    ).stdout.trim();
    check(
      checks,
      'sequence contention',
      sequenceResults.filter((result) => result.status === 0).length === 1 &&
        sequenceResults.filter((result) => /Duplicate entry|1062/i.test(result.stderr)).length === 1 &&
        sequenceCount === '1',
      'two concurrent inserts produce exactly one committed sequence position',
    );

    sql(
      databaseContainer,
      password,
      'CREATE TABLE DeadlockProbe (id INT PRIMARY KEY, value INT); INSERT INTO DeadlockProbe VALUES (1,0),(2,0)',
    );
    const deadlockResults = await Promise.all([
      sqlAsync(
        databaseContainer,
        password,
        'START TRANSACTION; UPDATE DeadlockProbe SET value=value+1 WHERE id=1; DO SLEEP(1); UPDATE DeadlockProbe SET value=value+1 WHERE id=2; COMMIT',
      ),
      sqlAsync(
        databaseContainer,
        password,
        'START TRANSACTION; UPDATE DeadlockProbe SET value=value+1 WHERE id=2; DO SLEEP(1); UPDATE DeadlockProbe SET value=value+1 WHERE id=1; COMMIT',
      ),
    ]);
    const deadlockLoser = deadlockResults.find((result) => result.status !== 0);
    const retry = sql(
      databaseContainer,
      password,
      'START TRANSACTION; UPDATE DeadlockProbe SET value=value+1 WHERE id IN (1,2) ORDER BY id; COMMIT',
      { allowFailure: true },
    );
    check(
      checks,
      'deadlock and ordered retry',
      deadlockResults.filter((result) => result.status === 0).length === 1 &&
        /Deadlock found|1213/i.test(deadlockLoser?.stderr ?? '') &&
        retry.status === 0,
      'opposite lock order produces one deadlock; deterministic-order retry commits',
    );

    sql(
      databaseContainer,
      password,
      `CREATE USER 'simapp'@'localhost' IDENTIFIED BY '${appPassword}' WITH MAX_USER_CONNECTIONS 2;
       GRANT SELECT ON cana.* TO 'simapp'@'localhost'`,
    );
    const sleepers = [
      sqlAsync(databaseContainer, appPassword, 'SELECT SLEEP(3)', { user: 'simapp' }),
      sqlAsync(databaseContainer, appPassword, 'SELECT SLEEP(3)', { user: 'simapp' }),
    ];
    let activeConnections = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      activeConnections = Number(
        sql(
          databaseContainer,
          password,
          "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='simapp'",
        ).stdout.trim(),
      );
      if (activeConnections === 2) break;
      sleep(100);
    }
    const exhausted = sql(
      databaseContainer,
      appPassword,
      'SELECT 1',
      { user: 'simapp', allowFailure: true },
    );
    await Promise.all(sleepers);
    const recovered = sql(
      databaseContainer,
      appPassword,
      'SELECT 1',
      { user: 'simapp', allowFailure: true },
    );
    sql(databaseContainer, password, "DROP USER 'simapp'@'localhost'");
    check(
      checks,
      'connection exhaustion and recovery',
      activeConnections === 2 &&
        exhausted.status !== 0 &&
        /max_user_connections|Too many connections|1203/i.test(exhausted.stderr) &&
        recovered.status === 0,
      'third app connection is refused at limit 2; a new connection succeeds after release',
    );

    sql(
      databaseContainer,
      password,
      `CREATE TABLE MigrationPopulated (
         id INT PRIMARY KEY,
         evidenceChain VARCHAR(191),
         recordedAt DATETIME
       );
       INSERT INTO MigrationPopulated VALUES (1,${hex('p'.repeat(191))},'2026-07-27 01:02:03');
       ALTER TABLE MigrationPopulated MODIFY evidenceChain TEXT, MODIFY recordedAt DATETIME(3);
       CREATE TABLE OldSchemaProbe (id INT PRIMARY KEY, payload VARCHAR(191));
       INSERT INTO OldSchemaProbe VALUES (1,'old');
       ALTER TABLE OldSchemaProbe ADD payloadSha256 CHAR(64) NULL`,
    );
    const migrationEvidence = sql(
      databaseContainer,
      password,
      `SELECT
         (SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='cana' AND TABLE_NAME='MigrationPopulated' AND COLUMN_NAME='evidenceChain'),
         (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='cana' AND TABLE_NAME='MigrationPopulated' AND COLUMN_NAME='recordedAt'),
         (SELECT payload FROM OldSchemaProbe WHERE id=1),
         (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='cana' AND TABLE_NAME='OldSchemaProbe' AND COLUMN_NAME='payloadSha256')`,
    ).stdout.trim().split('\t');
    check(
      checks,
      'empty populated and old-schema migration',
      migrationEvidence.join('|') === 'text|datetime(3)|old|1',
      `${migrationEvidence.join(', ')}; original populated rows preserved`,
    );

    sql(
      databaseContainer,
      password,
      `CREATE TABLE InterruptedLedger (id INT PRIMARY KEY, kind VARCHAR(32), eventIdentity VARCHAR(191) NULL);
       INSERT INTO InterruptedLedger VALUES (1,'ATTRIBUTION',NULL)`,
    );
    const interrupted = sql(
      databaseContainer,
      password,
      `ALTER TABLE InterruptedLedger
       ADD CONSTRAINT ck_interrupted_identity
       CHECK (kind <> 'ATTRIBUTION' OR eventIdentity IS NOT NULL)`,
      { allowFailure: true },
    );
    const preserved = sql(
      databaseContainer,
      password,
      'SELECT COUNT(*) FROM InterruptedLedger WHERE eventIdentity IS NULL',
    ).stdout.trim();
    sql(
      databaseContainer,
      password,
      `DELETE FROM InterruptedLedger WHERE eventIdentity IS NULL;
       ALTER TABLE InterruptedLedger
       ADD CONSTRAINT ck_interrupted_identity
       CHECK (kind <> 'ATTRIBUTION' OR eventIdentity IS NOT NULL)`,
    );
    check(
      checks,
      'interrupted migration fail closed',
      interrupted.status !== 0 && /CONSTRAINT|4025/i.test(interrupted.stderr) && preserved === '1',
      'invalid legacy row blocks DDL without destroying the row; corrected retry applies',
    );

    const lockHolder = sqlAsync(
      databaseContainer,
      password,
      "SELECT GET_LOCK('cana-candidate-migration',0); DO SLEEP(2); SELECT RELEASE_LOCK('cana-candidate-migration')",
    );
    sleep(300);
    const concurrentLock = sql(
      databaseContainer,
      password,
      "SELECT GET_LOCK('cana-candidate-migration',0)",
    ).stdout.trim();
    const lockHolderResult = await lockHolder;
    const postLock = sql(
      databaseContainer,
      password,
      "SELECT GET_LOCK('cana-candidate-migration',0); SELECT RELEASE_LOCK('cana-candidate-migration')",
    ).stdout.trim().split('\n');
    check(
      checks,
      'concurrent migration serialization',
      concurrentLock === '0' &&
        lockHolderResult.status === 0 &&
        postLock.at(-2) === '1' &&
        postLock.at(-1) === '1',
      'advisory lock refuses the concurrent migrator and succeeds after release',
    );

    const dump = command(
      'docker',
      [
        'exec',
        databaseContainer,
        'mariadb-dump',
        `-uroot`,
        `-p${password}`,
        '--databases',
        'cana',
        '--single-transaction',
        '--skip-comments',
      ],
      { timeout: 120_000, maxBuffer: 128 * 1024 * 1024 },
    ).stdout;
    dumpSha256 = sha256Bytes(dump);
    dumpBytes = Buffer.byteLength(dump);
    const chainCountBefore = sql(
      databaseContainer,
      password,
      "SELECT COUNT(*) FROM DemandCreditEntry WHERE merchantId='merchant-chain'",
    ).stdout.trim();
    sql(databaseContainer, password, 'DROP DATABASE cana', { database: null });
    sql(databaseContainer, password, dump, { database: null, timeout: 120_000 });
    const chainCountAfter = sql(
      databaseContainer,
      password,
      "SELECT COUNT(*) FROM DemandCreditEntry WHERE merchantId='merchant-chain'",
    ).stdout.trim();
    check(
      checks,
      'backup and restore',
      dumpBytes > 0 && chainCountBefore === chainCountAfter,
      `${dumpBytes} byte logical backup sha256 ${dumpSha256}; ${chainCountAfter} chain rows restored`,
    );

    const originalDigest = sql(
      databaseContainer,
      password,
      `SELECT evidenceChainSha256 FROM DemandCreditEntry WHERE eventIdentity=${hex('chain-405')}`,
    ).stdout.trim();
    sql(
      databaseContainer,
      password,
      `START TRANSACTION;
       UPDATE DemandCreditEntry SET evidenceChainSha256=${hex('rollback-probe')}
       WHERE eventIdentity=${hex('chain-405')};
       ROLLBACK`,
    );
    const rolledBackDigest = sql(
      databaseContainer,
      password,
      `SELECT evidenceChainSha256 FROM DemandCreditEntry WHERE eventIdentity=${hex('chain-405')}`,
    ).stdout.trim();
    check(
      checks,
      'transaction rollback',
      originalDigest === rolledBackDigest,
      `digest remains ${rolledBackDigest}`,
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (
      command('docker', ['inspect', dependencyContainer], { allowFailure: true }).status === 0
    ) {
      command('docker', ['rm', '-f', dependencyContainer], {
        allowFailure: true,
        timeout: 30_000,
      });
    }
    if (clientCreated || command('docker', ['inspect', clientContainer], { allowFailure: true }).status === 0) {
      command('docker', ['rm', '-f', clientContainer], { allowFailure: true, timeout: 30_000 });
    }
    if (databaseCreated) {
      command('docker', ['rm', '-f', databaseContainer], { allowFailure: true, timeout: 30_000 });
    }
    if (networkCreated) {
      command('docker', ['network', 'rm', network], { allowFailure: true, timeout: 30_000 });
    }
    command('docker', ['volume', 'rm', dependencyVolume], {
      allowFailure: true,
      timeout: 30_000,
    });
    fs.rmSync(runRoot, { recursive: true, force: true });
  }

  const cleanup = {
    dependencyContainerRemoved:
      command('docker', ['inspect', dependencyContainer], { allowFailure: true }).status !== 0,
    clientContainerRemoved:
      command('docker', ['inspect', clientContainer], { allowFailure: true }).status !== 0,
    databaseContainerRemoved:
      command('docker', ['inspect', databaseContainer], { allowFailure: true }).status !== 0,
    dependencyVolumeRemoved:
      command('docker', ['volume', 'inspect', dependencyVolume], { allowFailure: true }).status !==
      0,
    networkRemoved:
      command('docker', ['network', 'inspect', network], { allowFailure: true }).status !== 0,
  };
  const overall =
    !failure &&
    checks.length === 25 &&
    checks.every((entry) => entry.pass) &&
    Object.values(cleanup).every(Boolean)
      ? 'PASS'
      : 'FAIL';
  const reportBody = {
    overall,
    startedAt,
    finishedAt: new Date().toISOString(),
    source,
    substrate: {
      image: MARIA_IMAGE,
      digest: mariaDigest,
      network: 'internal Docker network; no host port published',
      dependencyFetch:
        'package manifests only; npm lifecycle scripts disabled; fetch container removed before source execution',
      candidateExecutionNetwork:
        'internal database network only; no bridge attachment or external egress',
      data: 'container tmpfs; removed after run',
    },
    candidate: {
      schema: 'tools/mariadb-sim/schema.prisma',
      schemaSha256: sha256File(candidateSchema),
      sourceSchemaSha256: sha256File(sourceSchema),
      providerFlipMerged: false,
      failClosedSql: 'tools/mariadb-sim/candidate-cutover.sql',
    },
    checks,
    backup: {
      bytes: dumpBytes,
      sha256: dumpSha256,
      retained: false,
    },
    cleanup,
    remainingUnprovenClaims: [
      'No finite maximum approved evidence-chain byte length exists because per-link bytes are unbounded in the prohibited business-semantics implementation.',
      'This is a local MariaDB execution substrate, not a hosted production database or production migration.',
    ],
    failure,
  };
  const reportFile = path.join(
    receiptDirectory(),
    `maria-execution-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.md`,
  );
  fs.writeFileSync(reportFile, markdownReport(reportBody), { encoding: 'utf8', mode: 0o600 });
  const receipt = writeReceipt('verify-maria', {
    ...reportBody,
    report: {
      file: reportFile,
      sha256: sha256File(reportFile),
    },
  });
  console.log(`report: ${reportFile}`);
  console.log(`receipt: ${receipt.file}`);
  console.log(`receipt sha256: ${receipt.sha256}`);
  if (overall !== 'PASS') {
    process.stderr.write(`${failure ?? 'MariaDB scenario or cleanup failed'}\n`);
    process.exitCode = 1;
  } else {
    console.log(`PASS verify maria at ${source.commit}`);
  }
  return receipt.body;
}
