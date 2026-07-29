import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertBuildOutputClean,
  buildOutputDiagnostics,
} from './build-output.mjs';
import { sha256File } from './receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const MIGRATION_COURT = path.join(WEB, 'tests', 'migration-court.test.mjs');

function cana(...args) {
  const env = {
    ...process.env,
    CANA_RECEIPT_DIR: path.join(ROOT, '.test-receipts-never-created'),
  };
  delete env.CANA_RECEIPT_SESSION;
  return spawnSync(path.join(ROOT, 'cana'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

test('the root dispatcher refuses an unknown verification profile', () => {
  const result = cana('verify', 'not-a-profile');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown verification profile/i);
});

test('receipts bind to the active session and cannot override envelope fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-receipt-test-'));
  const directory = path.join(root, 'receipts');
  const sessionFile = path.join(root, 'session.json');
  fs.mkdirSync(directory, { mode: 0o700 });
  const nonce = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(sessionFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'cana-final-receipt-session',
    sessionId: crypto.randomUUID(),
    nonce,
    startedAt: new Date().toISOString(),
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    receiptDirectory: directory,
    trustedAttestation: false,
  }), { mode: 0o600 });
  const previousSession = process.env.CANA_RECEIPT_SESSION;
  const previousDirectory = process.env.CANA_RECEIPT_DIR;
  try {
    process.env.CANA_RECEIPT_SESSION = sessionFile;
    process.env.CANA_RECEIPT_DIR = directory;
    const { writeReceipt } = await import('./receipt.mjs');
    const receipt = writeReceipt('session-test', {
      overall: 'PASS',
      kind: 'forged-kind',
      receiptSession: { sessionId: 'forged-session' },
    });
    assert.equal(receipt.body.kind, 'session-test');
    assert.equal(receipt.body.receiptSession.sessionId, JSON.parse(fs.readFileSync(sessionFile)).sessionId);
    assert.equal(
      receipt.body.receiptSession.nonceSha256,
      crypto.createHash('sha256').update(nonce).digest('hex'),
    );
    assert.equal(receipt.body.receiptSession.trustedAttestation, false);
  } finally {
    if (previousSession === undefined) delete process.env.CANA_RECEIPT_SESSION;
    else process.env.CANA_RECEIPT_SESSION = previousSession;
    if (previousDirectory === undefined) delete process.env.CANA_RECEIPT_DIR;
    else process.env.CANA_RECEIPT_DIR = previousDirectory;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the root dispatcher refuses an unknown command', () => {
  const result = cana('owner-gated-production-deploy');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: \.\/cana/i);
});

test('help names every required verification and durability surface', () => {
  const result = cana('--help');
  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    'verify focused',
    'verify full',
    'verify clean-clone',
    'verify release',
    'verify maria',
    'verify cpanel',
    'durability status',
    'durability build',
    'durability verify',
    'durability restore',
    'durability upload',
    'durability readback',
  ]) {
    assert.match(result.stdout, new RegExp(command.replaceAll('-', '\\-')));
  }
});

test('the migration court resolves apps/web from both supported working directories', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const cwd of [ROOT, WEB]) {
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern=^PORTABILITY CANARY:',
        MIGRATION_COURT,
      ],
      {
        cwd,
        encoding: 'utf8',
        env,
        timeout: 120_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `migration court failed from ${cwd}\n${result.stderr || result.stdout}`,
    );
    assert.match(result.stdout, /pass 1\b/);
  }
});

test('the full-suite entropy adapter is reproducible and still yields distinct values', () => {
  const preload = path.join(ROOT, 'tools', 'test-runner', 'deterministic-crypto.cjs');
  const evaluate = () => spawnSync(
    process.execPath,
    [
      '--require',
      preload,
      '-e',
      'const c=require("node:crypto");process.stdout.write(`${c.randomBytes(12).toString("hex")}\\n${c.randomBytes(12).toString("hex")}\\n`)',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CANA_DETERMINISTIC_TEST_RANDOM: '1',
        CANA_DETERMINISTIC_TEST_SEED: 'fixed-verifier-seed',
      },
    },
  );
  const first = evaluate();
  const second = evaluate();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const [left, right] = first.stdout.trim().split('\n');
  assert.match(left, /^[0-9a-f]{24}$/);
  assert.match(right, /^[0-9a-f]{24}$/);
  assert.notEqual(left, right);
});

test('the verifier rejects successful Next builds that contain compilation diagnostics', () => {
  const attemptedImport = [
    '⚠ Compiled with warnings in 5.4s',
    '',
    'Attempted import error: collectSiteIntelligenceSnapshot is not exported.',
  ].join('\n');
  assert.deepEqual(buildOutputDiagnostics('✓ Compiled successfully'), []);
  assert.deepEqual(buildOutputDiagnostics(attemptedImport), [
    'NEXT_COMPILED_WITH_WARNINGS',
    'NEXT_ATTEMPTED_IMPORT_ERROR',
  ]);
  assert.throws(
    () => assertBuildOutputClean(attemptedImport),
    /NEXT_COMPILED_WITH_WARNINGS.*NEXT_ATTEMPTED_IMPORT_ERROR/s,
  );
});

test('receipt file hashing streams across multiple bounded chunks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-hash-test-'));
  const file = path.join(root, 'multi-chunk.bin');
  const content = Buffer.alloc((2 * 1024 * 1024) + 3, 0x5a);
  try {
    fs.writeFileSync(file, content);
    assert.equal(
      sha256File(file),
      crypto.createHash('sha256').update(content).digest('hex'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
