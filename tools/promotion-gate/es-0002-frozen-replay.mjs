/**
 * Byte-identical ES-0002 replay support for the V3 bridge.
 *
 * The helper extracts the exact e03 archive into a disposable directory and runs the frozen
 * court there, where its historical ownership-manifest pin is still true. It never edits an
 * ES-0002 artifact, creates no repository ref and performs no network operation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARCHIVE_SHA = 'e03acd96ccfed958b0a21c76e32c2075038a4e34';
const FROZEN_SHA = '4c6c2a5693d7bc7d99b1fedaa7f51493328f2165edd140428e9def89e74c5894';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const FROZEN_FILES = Object.freeze({
  '_mission/evolution/ES-0002-promotion-identity.json': '64cc18a97923efa4b71e1487b4844481d4c3898d560ea252ff7d1f0574da144a',
  'tools/promotion-gate/es-0002.mjs': '1e6e5c2303c210c8bff137b351fe23de7cd502cc782f1190f2ac5263dd79bcd1',
  'tools/promotion-gate/es-0002.court.test.mjs': '58a161fab1fe8e15bda82b05f2e68636d2c36be104b1a95446b92d37732435ba',
  'tools/promotion-gate/fixtures/es-0002-positive.json': '1addeb2fd63e1eed5a845a9dde15de7b1e623331cb1025b971d8835b4d0c9f2c',
  'tools/promotion-gate/fixtures/es-0002-adversarial-corpus.mjs': 'edefd64754583e4b7b867ed99b45e9f99a30f9143b6ed9d1a393ade7b4c7e29f',
  'tools/promotion-gate/fixtures/es-0002-freeze.mjs': '54705b0c1c6101c8c876d25a0a49f5f0082bd124b114ad20a9c92dffdd9ab6ce',
  'tools/promotion-gate/historical/historical-replay.court.test.mjs': 'f5de13ef13bd1d45b79e699b6ee52dcc7ba7ee529b027453a6b083b780e90a68',
  'tools/promotion-gate/historical/promotion-receipt.v1.replay.mjs': 'ab0096009b6b6f77bf603da67585b6db303e52e521520dacd4ec82ccbda78240',
  'tools/promotion-gate/historical/replay-v1.mjs': 'ea792f3219510903e8e844b4da1e2e40e3aaf0ba7a1d027df70952913d615e43',
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    combined: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function testSummary(output) {
  const value = (name) => Number(new RegExp(`^(?:#|ℹ) ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? -1);
  return { tests: value('tests'), pass: value('pass'), fail: value('fail'), skipped: value('skipped') };
}

function replayEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  // A nested `node --test` must be a fresh runner, not a child shard of the parent court.
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function verifyFrozenFiles(archive) {
  const evidence = [];
  for (const [relative, expected] of Object.entries(FROZEN_FILES)) {
    const current = path.join(ROOT, relative);
    const archived = path.join(archive, relative);
    if (!fs.existsSync(current) || !fs.existsSync(archived)) {
      return { ok: false, evidence: [...evidence, `${relative} is absent`] };
    }
    const currentSha = sha256(fs.readFileSync(current));
    const archiveSha = sha256(fs.readFileSync(archived));
    const ok = currentSha === expected && archiveSha === expected;
    evidence.push(`${relative}: current=${currentSha} archive=${archiveSha} expected=${expected} exact=${ok}`);
    if (!ok) return { ok: false, evidence };
  }
  return { ok: true, evidence };
}

export function replayFrozenEs0002({ mirror = ROOT } = {}) {
  // The next frozen court test also launches its own historical replay subprocess. Remove the
  // parent-runner shard marker once this explicit replay lane takes responsibility for nesting.
  delete process.env.NODE_TEST_CONTEXT;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-es0002-frozen-'));
  const archiveRoot = path.join(work, 'archive');
  fs.mkdirSync(archiveRoot, { mode: 0o700 });
  const evidence = [];
  try {
    const archive = spawnSync('git', ['archive', '--format=tar', ARCHIVE_SHA], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (archive.status !== 0 || archive.error) {
      return { classification: 'ENVIRONMENT_MISSING', evidence: ['could not read the e03 archive'] };
    }
    const extracted = spawnSync('tar', ['-xf', '-', '-C', archiveRoot], {
      input: archive.stdout,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (extracted.status !== 0 || extracted.error) {
      return { classification: 'ENVIRONMENT_MISSING', evidence: [`could not extract the e03 archive: ${extracted.stderr ?? ''}`] };
    }

    const frozen = verifyFrozenFiles(archiveRoot);
    evidence.push(...frozen.evidence);
    if (!frozen.ok) return { classification: 'REAL_REGRESSION', evidence };

    const courtRun = run(process.execPath, ['--test', 'tools/promotion-gate/es-0002.court.test.mjs'], {
      cwd: archiveRoot,
      timeout: 600_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const court = testSummary(courtRun.combined);
    evidence.push(`ES0002 archive court: exit=${courtRun.status} tests=${court.tests} pass=${court.pass} fail=${court.fail} skipped=${court.skipped}`);
    if (!courtRun.ok || court.tests !== 8 || court.pass !== 8 || court.fail !== 0 || court.skipped !== 0) {
      return { classification: 'REAL_REGRESSION', evidence: [...evidence, courtRun.combined.slice(-3000)], court };
    }

    const bridgeScript = `
      import fs from 'node:fs';
      import { evaluatePromotionIdentity } from './tools/promotion-gate/es-0002.mjs';
      import { ADVERSARIAL_CORPUS } from './tools/promotion-gate/fixtures/es-0002-adversarial-corpus.mjs';
      let pass = 0;
      for (const testCase of ADVERSARIAL_CORPUS) {
        const result = evaluatePromotionIdentity(testCase.candidate, { mirror: process.env.CANA_SOURCE_MIRROR });
        if (!result.accepted && result.failed_checks.includes(testCase.expect_reject_check)) pass += 1;
      }
      process.stdout.write(JSON.stringify({ tests: ADVERSARIAL_CORPUS.length, pass, fail: ADVERSARIAL_CORPUS.length - pass }));
    `;
    const bridgeRun = run(process.execPath, ['--input-type=module', '-e', bridgeScript], {
      cwd: archiveRoot,
      timeout: 600_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const adversarialBridge = bridgeRun.ok ? JSON.parse(bridgeRun.stdout) : { tests: -1, pass: -1, fail: -1 };
    evidence.push(`ES0002 adversarial bridge: ${JSON.stringify(adversarialBridge)}`);
    if (!bridgeRun.ok || adversarialBridge.tests !== 22 || adversarialBridge.pass !== 22 || adversarialBridge.fail !== 0) {
      return { classification: 'REAL_REGRESSION', evidence, court, adversarial_bridge: adversarialBridge };
    }

    return {
      classification: 'VERIFIED',
      evidence,
      archive_sha: ARCHIVE_SHA,
      freeze_sha256: FROZEN_SHA,
      court,
      adversarial_bridge: adversarialBridge,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = replayFrozenEs0002({ mirror: process.env.CANA_SOURCE_MIRROR ?? ROOT });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.classification === 'VERIFIED' ? 0 : 1;
}
