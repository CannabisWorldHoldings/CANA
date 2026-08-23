/**
 * Byte-identical ES-0004 replay support for the ES-0005 bridge.
 *
 * The helper clones the local mirror and checks out the exact pre-ZENITH ownership commit, then
 * runs both sealed V4 courts there. It edits no frozen artifact, creates no ref, and uses no
 * network.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARCHIVE_SHA = '21b9bd61c2d7dcb8f8fad91cfc7a380a20564693';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const FROZEN_FILES = Object.freeze({
  'tools/promotion-gate/es-0004.mjs': '35e171cc4f18a0a1a46c6c16e234ba9fb18909b3ba58d194b91f6b5a1e92b755',
  'tools/promotion-gate/es-0004.court.test.mjs': '13b237970f0a818e6d2cb70fa98a24f9aca71d623f2ff6aec37285c275e7108a',
  'tools/promotion-gate/es-0004.holdout.court.test.mjs': 'e0d8dc3dded1290f8902ea4e99a5f274767758e3cde91f6bf763921ff83546a9',
  'tools/promotion-gate/es-0003-frozen-replay.mjs': 'efe560a0f43972637a037271565ebed6200ce4d5049091bd38c1c2a02a5548a3',
  'tools/promotion-gate/fixtures/es-0004-positive.json': '192bbcd95b052223f3bb8524887875fa1d8ee5c6f0626ea3688f149054b50856',
  'tools/promotion-gate/fixtures/es-0004-adversarial-corpus.mjs': '99d784a5bc7f70cb1d4a210b6a49f4906d321f884106f98590b937cd0df43c10',
  'tools/promotion-gate/fixtures/es-0004-freeze.mjs': '799c873481f34551f8f504cd1ecd0c166107db092f18bca11b51480b2c23b2c8',
  'tools/promotion-gate/fixtures/es-0004-succession-case.json': '4fa1f9d43513eea8103e6931a6969119fbadc9bbad434153f37a4fd0fe6dc487',
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

export function replayFrozenEs0004({ mirror = ROOT } = {}) {
  delete process.env.NODE_TEST_CONTEXT;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-es0004-frozen-'));
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
      return { classification: 'ENVIRONMENT_MISSING', evidence: [`could not clone the ES-0004 mirror: ${cloned.stderr ?? ''}`] };
    }
    const checkedOut = spawnSync('git', ['checkout', '--quiet', '--detach', ARCHIVE_SHA], {
      cwd: archiveRoot,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (checkedOut.status !== 0 || checkedOut.error) {
      return { classification: 'ENVIRONMENT_MISSING', evidence: [`could not check out the ES-0004 archive: ${checkedOut.stderr ?? ''}`] };
    }
    const frozen = verifyFrozenFiles(archiveRoot);
    evidence.push(...frozen.evidence);
    if (!frozen.ok) return { classification: 'REAL_REGRESSION', evidence };

    const publicRun = run(process.execPath, ['--test', 'tools/promotion-gate/es-0004.court.test.mjs'], {
      cwd: archiveRoot,
      timeout: 900_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const publicCourt = summary(publicRun.combined);
    evidence.push(`ES0004 archive court: exit=${publicRun.status} ${JSON.stringify(publicCourt)}`);
    if (!publicRun.ok || publicCourt.tests !== 8 || publicCourt.pass !== 8 || publicCourt.fail !== 0 || publicCourt.skipped !== 0) {
      return { classification: 'REAL_REGRESSION', evidence: [...evidence, publicRun.combined.slice(-4000)], public_court: publicCourt };
    }

    const holdoutRun = run(process.execPath, ['--test', 'tools/promotion-gate/es-0004.holdout.court.test.mjs'], {
      cwd: archiveRoot,
      timeout: 900_000,
      env: replayEnvironment({ CANA_SOURCE_MIRROR: mirror }),
    });
    const holdoutCourt = summary(holdoutRun.combined);
    evidence.push(`ES0004 holdout court: exit=${holdoutRun.status} ${JSON.stringify(holdoutCourt)}`);
    if (!holdoutRun.ok || holdoutCourt.tests !== 15 || holdoutCourt.pass !== 15 || holdoutCourt.fail !== 0 || holdoutCourt.skipped !== 0) {
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
  const result = replayFrozenEs0004({ mirror: process.env.CANA_SOURCE_MIRROR ?? ROOT });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.classification === 'VERIFIED' ? 0 : 1;
}
