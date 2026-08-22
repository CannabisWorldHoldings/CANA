/**
 * Byte-identical ES-0003 replay support for the ES-0004 bridge.
 *
 * The helper clones the local mirror and checks out the exact pre-PR59-custody commit, then runs
 * both sealed V3 courts there. It edits no frozen artifact, creates no ref, and uses no network.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARCHIVE_SHA = '99efaa937d137b7d3502e9ecbe08d92d615d1e1d';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const FROZEN_FILES = Object.freeze({
  'tools/promotion-gate/es-0003.mjs': '1c807acbccc707b8b871d86ed1b3aa2e4441c6ef270d8964550863e1cf2edcf2',
  'tools/promotion-gate/es-0003.court.test.mjs': 'acd1bcaaac2520df8d478014502d9707970093fccd61af255b97876e810f7438',
  'tools/promotion-gate/es-0003.holdout.court.test.mjs': '94210fb1626ed651fc32245185aa6f46208a4eed6993ac501cf3a4f7bc3edda8',
  'tools/promotion-gate/es-0002-frozen-replay.mjs': '8d7c52ccae6c65b81af29651431cb7e96de0036309fdabc0d791f2c37f1b33a0',
  'tools/promotion-gate/fixtures/es-0003-positive.json': 'bdaa56e45e14a8e7e0cd9e08c1c831c95181a2c90e7e77a601b0a0b2c2118152',
  'tools/promotion-gate/fixtures/es-0003-adversarial-corpus.mjs': 'ec3e93974a29d77d1854898dc1379dc32e0c77f3fc58f6a32f9dc257139dc22b',
  'tools/promotion-gate/fixtures/es-0003-freeze.mjs': 'd020e24f758cae9de6ff22a57df9696c65a0ba017a1b54d7b4b140b1e779d949',
  'tools/promotion-gate/fixtures/es-0003-succession-case.json': '1d21be50bf3da9ced2dc67eecc5c17e3fc118c4dbb553d96c6e28cf511a7c31b',
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

function summary(output) {
  const value = (name) => Number(new RegExp(`^(?:#|ℹ) ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? -1);
  return { tests: value('tests'), pass: value('pass'), fail: value('fail'), skipped: value('skipped') };
}

function replayEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function verifyFrozenFiles(archiveRoot) {
  const evidence = [];
  for (const [relative, expected] of Object.entries(FROZEN_FILES)) {
    const current = path.join(ROOT, relative);
    const archived = path.join(archiveRoot, relative);
    if (!fs.existsSync(current) || !fs.existsSync(archived)) {
      return { ok: false, evidence: [...evidence, `${relative} is absent`] };
    }
    const currentSha = sha256(fs.readFileSync(current));
    const archiveSha = sha256(fs.readFileSync(archived));
    const exact = currentSha === expected && archiveSha === expected;
    evidence.push(`${relative}: current=${currentSha} archive=${archiveSha} expected=${expected} exact=${exact}`);
    if (!exact) return { ok: false, evidence };
  }
  return { ok: true, evidence };
}

export function replayFrozenEs0003({ mirror = ROOT } = {}) {
  delete process.env.NODE_TEST_CONTEXT;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-es0003-frozen-'));
  const archiveRoot = path.join(work, 'archive');
  fs.mkdirSync(archiveRoot, { mode: 0o700 });
  const evidence = [];
  try {
    const cloned = spawnSync('git', ['clone', '--quiet', '--no-checkout', mirror, archiveRoot], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (cloned.status !== 0 || cloned.error) {
      return { classification: 'ENVIRONMENT_MISSING', evidence: [`could not clone the ES-0003 mirror: ${cloned.stderr ?? ''}`] };
    }
    const checkedOut = spawnSync('git', ['checkout', '--quiet', '--detach', ARCHIVE_SHA], {
      cwd: archiveRoot,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (checkedOut.status !== 0 || checkedOut.error) {
      return { classification: 'ENVIRONMENT_MISSING', evidence: [`could not check out the ES-0003 archive: ${checkedOut.stderr ?? ''}`] };
    }
    const frozen = verifyFrozenFiles(archiveRoot);
    evidence.push(...frozen.evidence);
    if (!frozen.ok) return { classification: 'REAL_REGRESSION', evidence };

    const publicRun = run(process.execPath, ['--test', 'tools/promotion-gate/es-0003.court.test.mjs'], {
      cwd: archiveRoot,
      timeout: 900_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const publicCourt = summary(publicRun.combined);
    evidence.push(`ES0003 archive court: exit=${publicRun.status} ${JSON.stringify(publicCourt)}`);
    if (!publicRun.ok || publicCourt.tests !== 9 || publicCourt.pass !== 9 || publicCourt.fail !== 0 || publicCourt.skipped !== 0) {
      return { classification: 'REAL_REGRESSION', evidence: [...evidence, publicRun.combined.slice(-4000)], public_court: publicCourt };
    }

    const holdoutRun = run(process.execPath, ['--test', 'tools/promotion-gate/es-0003.holdout.court.test.mjs'], {
      cwd: archiveRoot,
      timeout: 900_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const holdoutCourt = summary(holdoutRun.combined);
    evidence.push(`ES0003 holdout court: exit=${holdoutRun.status} ${JSON.stringify(holdoutCourt)}`);
    if (!holdoutRun.ok || holdoutCourt.tests !== 18 || holdoutCourt.pass !== 18 || holdoutCourt.fail !== 0 || holdoutCourt.skipped !== 0) {
      return { classification: 'REAL_REGRESSION', evidence: [...evidence, holdoutRun.combined.slice(-4000)], public_court: publicCourt, holdout_court: holdoutCourt };
    }
    return {
      classification: 'VERIFIED',
      archive_sha: ARCHIVE_SHA,
      evidence,
      public_court: publicCourt,
      holdout_court: holdoutCourt,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = replayFrozenEs0003({ mirror: process.env.CANA_SOURCE_MIRROR ?? ROOT });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.classification === 'VERIFIED' ? 0 : 1;
}
