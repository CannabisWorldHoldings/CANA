import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PrConsumptionIdentityError,
  buildNormalizedCapture,
  buildPrConsumptionLedger,
  normalizedCaptureBytes,
  verifyPrConsumptionLedger,
} from './reconstruct-pr-consumption.mjs';

const PR_NUMBERS = [11, 21, 22, 23, 24, 25, 26, 27];
const modulePath = fileURLToPath(new URL('./reconstruct-pr-consumption.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(modulePath), '..', '..');
let outputSequence = 0;

async function repoOutputDir(t, label) {
  const dir = path.join(REPO_ROOT, '.omo', `zenith-pr-output-${process.pid}-${label}-${outputSequence += 1}`);
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cana-pr-ledger-'));
  t.after(() => spawnSync('rm', ['-rf', root]));
  const work = path.join(root, 'work');
  const bare = path.join(root, 'objects.git');
  runGit(root, ['init', '-b', 'main', work]);
  runGit(work, ['config', 'user.name', 'PR Ledger Test']);
  runGit(work, ['config', 'user.email', 'pr-ledger@example.invalid']);
  await writeFile(path.join(work, 'base.txt'), 'base\n');
  runGit(work, ['add', 'base.txt']);
  runGit(work, ['commit', '-m', 'base']);
  const capturedBaseSha = runGit(work, ['rev-parse', 'HEAD']);

  const openPrs = [];
  for (const number of PR_NUMBERS) {
    const branch = `fixture/pr-${number}`;
    runGit(work, ['checkout', '-b', branch, capturedBaseSha]);
    await writeFile(path.join(work, `pr-${number}.txt`), `exact content ${number}\n`);
    runGit(work, ['add', `pr-${number}.txt`]);
    runGit(work, ['commit', '-m', `PR ${number}`]);
    const headSha = runGit(work, ['rev-parse', 'HEAD']);
    openPrs.push({
      number,
      base: 'main',
      base_sha: capturedBaseSha,
      head: branch,
      head_sha: headSha,
      head_tree: runGit(work, ['show', '-s', '--format=%T', headSha]),
      draft: number % 2 === 1,
      merge_state: number === 21 ? 'DIRTY' : 'CLEAN',
    });
  }

  runGit(work, ['checkout', 'main']);
  await mkdir(path.join(work, 'canonical'));
  await writeFile(path.join(work, 'canonical', 'z-consumed.txt'), 'exact content 11\n');
  await writeFile(path.join(work, 'canonical', 'a-consumed.txt'), 'exact content 11\n');
  runGit(work, ['add', 'canonical']);
  runGit(work, ['commit', '-m', 'consume PR 11 blob exactly']);
  runGit(work, ['merge', '--no-ff', 'fixture/pr-22', '-m', 'merge PR 22']);
  await writeFile(path.join(work, 'pr-22.txt'), 'superseding content\n');
  runGit(work, ['add', 'pr-22.txt']);
  runGit(work, ['commit', '-m', 'supersede PR 22 content']);

  runGit(root, ['clone', '--bare', work, bare]);
  for (const pr of openPrs) runGit(root, [`--git-dir=${bare}`, 'update-ref', `refs/pull/${pr.number}/head`, pr.head_sha]);
  const capture = {
    schema_version: 'zenith-current-state-receipt/v1',
    captured_at: '2026-08-23T04:35:43Z',
    repository: {
      name_with_owner: 'CannabisWorldHoldings/CANA',
      remote_origin: 'https://github.com/CannabisWorldHoldings/CANA.git',
    },
    open_prs: openPrs,
  };
  return { root, work, bare, capture };
}

test('RED/GREEN court proves exact consumption, supersession, dirty review, stable capture bytes, and no ref mutation', async (t) => {
  const { bare, capture } = await fixture(t);
  const beforeRefs = runGit('/', [`--git-dir=${bare}`, 'show-ref']);
  const normalized = buildNormalizedCapture({ capture, repo: bare });
  const captureBytes = normalizedCaptureBytes(normalized);
  const first = buildPrConsumptionLedger({ capture: normalized, captureBytes, repo: bare });
  const second = buildPrConsumptionLedger({ capture: structuredClone(normalized), captureBytes, repo: bare });
  const afterRefs = runGit('/', [`--git-dir=${bare}`, 'show-ref']);

  assert.deepEqual(first, second);
  assert.equal(beforeRefs, afterRefs);
  assert.equal(normalized.authority_effect, 'NONE');
  assert.deepEqual(normalized.external_effects, []);
  assert.equal(first.capture.normalized_capture_sha256, first.pr_consumptions[0].source_digest);
  assert.ok(first.pr_consumptions.every((row) => row.source_path === 'docs/zenith/CURRENT_STATE_PR_CAPTURE.json'));
  assert.ok(first.pr_consumptions.every((row) => row.evidence_refs.some((ref) => ref.ref === row.source_path && ref.digest === row.source_digest)));

  const consumed = first.pr_consumptions.find((row) => row.pr_number === 11 && row.changed_path === 'pr-11.txt');
  assert.equal(consumed.disposition, 'CONSUMED_EXACT');
  assert.equal(consumed.consuming_commit, first.capture.main_sha);
  assert.equal(consumed.consuming_path, 'canonical/a-consumed.txt');

  const superseded = first.pr_consumptions.find((row) => row.pr_number === 22 && row.changed_path === 'pr-22.txt');
  assert.equal(superseded.disposition, 'SUPERSEDED');
  assert.equal(superseded.consuming_commit, undefined);
  assert.match(first.disposition_reasons.find((reason) => reason.id === superseded.id).reason, /ancestor of current main/);

  const dirty = first.pr_consumptions.find((row) => row.pr_number === 21 && row.changed_path === 'pr-21.txt');
  assert.equal(dirty.disposition, 'PENDING_REVIEW');
  assert.match(first.disposition_reasons.find((reason) => reason.id === dirty.id).reason, /DIRTY/);
});

test('forged capture bytes, capture identities, ledger source/head/tree/blob/content/consumer identities all fail closed', async (t) => {
  const { bare, capture } = await fixture(t);
  const normalized = buildNormalizedCapture({ capture, repo: bare });
  const captureBytes = normalizedCaptureBytes(normalized);
  const ledger = buildPrConsumptionLedger({ capture: normalized, captureBytes, repo: bare });

  assert.throws(
    () => buildPrConsumptionLedger({ capture: normalized, captureBytes: Buffer.concat([captureBytes, Buffer.from(' ')]), repo: bare }),
    (error) => error instanceof PrConsumptionIdentityError && error.code === 'PR_CONSUMPTION_IDENTITY_MISMATCH',
  );

  for (const field of ['base_sha', 'head_sha', 'head_tree']) {
    const forgedCapture = structuredClone(normalized);
    forgedCapture.open_prs[0][field] = 'f'.repeat(40);
    assert.throws(
      () => buildPrConsumptionLedger({ capture: forgedCapture, captureBytes: normalizedCaptureBytes(forgedCapture), repo: bare }),
      (error) => error instanceof PrConsumptionIdentityError && error.code === 'PR_CONSUMPTION_IDENTITY_MISMATCH',
      field,
    );
  }

  const consumedIndex = ledger.pr_consumptions.findIndex((row) => row.disposition === 'CONSUMED_EXACT');
  for (const [field, value] of [
    ['source_digest', 'f'.repeat(64)],
    ['pr_head_sha', 'f'.repeat(40)],
    ['pr_head_tree', 'f'.repeat(40)],
    ['head_blob_sha', 'f'.repeat(40)],
    ['content_digest', 'f'.repeat(64)],
    ['consuming_commit', 'f'.repeat(40)],
    ['consuming_path', 'forged/path.txt'],
  ]) {
    const forged = structuredClone(ledger);
    forged.pr_consumptions[consumedIndex][field] = value;
    assert.throws(
      () => verifyPrConsumptionLedger({ capture: normalized, captureBytes, repo: bare, ledger: forged }),
      (error) => error instanceof PrConsumptionIdentityError && error.code === 'PR_CONSUMPTION_IDENTITY_MISMATCH',
      field,
    );
  }
});

test('CLI requires a bare store and repeats normalized capture and ledger byte-identically', async (t) => {
  const { root, work, bare, capture } = await fixture(t);
  const inputPath = path.join(root, 'receipt.json');
  const outputRoot = await repoOutputDir(t, 'cli');
  const firstDir = path.join(outputRoot, 'first');
  const secondDir = path.join(outputRoot, 'second');
  await mkdir(firstDir);
  await mkdir(secondDir);
  await writeFile(inputPath, JSON.stringify(capture));

  for (const output of [path.join(firstDir, 'ledger.json'), path.join(secondDir, 'ledger.json')]) {
    const result = spawnSync(process.execPath, [modulePath, '--capture', inputPath, '--repo', bare, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CONSUMED_EXACT=1/);
    assert.match(result.stdout, /SUPERSEDED=1/);
    assert.match(result.stdout, /PENDING_REVIEW=6/);
  }
  assert.equal(await readFile(path.join(firstDir, 'ledger.json'), 'utf8'), await readFile(path.join(secondDir, 'ledger.json'), 'utf8'));
  assert.equal(
    await readFile(path.join(firstDir, 'CURRENT_STATE_PR_CAPTURE.json'), 'utf8'),
    await readFile(path.join(secondDir, 'CURRENT_STATE_PR_CAPTURE.json'), 'utf8'),
  );

  const rejected = spawnSync(process.execPath, [modulePath, '--capture', inputPath, '--repo', work, '--output', path.join(firstDir, 'ledger.json')], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /PR_CONSUMPTION_IDENTITY_MISMATCH/);
});

test('CLI output custody rejects outside-root paths, symlink components/finals, and overwrite', async (t) => {
  const { root, bare, capture } = await fixture(t);
  const inputPath = path.join(root, 'receipt.json');
  await writeFile(inputPath, JSON.stringify(capture));
  const outputRoot = await repoOutputDir(t, 'custody');
  const invoke = (output) => spawnSync(process.execPath, [modulePath, '--capture', inputPath, '--repo', bare, '--output', output], { encoding: 'utf8' });

  const outside = path.join(root, 'outside-ledger.json');
  const outsideResult = invoke(outside);
  assert.equal(outsideResult.status, 1);
  assert.match(outsideResult.stderr, /OUTPUT_PATH_ESCAPES_ROOT/);

  const componentLink = path.join(outputRoot, 'component-link');
  await symlink(root, componentLink);
  const componentResult = invoke(path.join(componentLink, 'ledger.json'));
  assert.equal(componentResult.status, 1);
  assert.match(componentResult.stderr, /OUTPUT_SYMLINK_FORBIDDEN/);

  const finalLink = path.join(outputRoot, 'final-ledger.json');
  await symlink(inputPath, finalLink);
  const finalResult = invoke(finalLink);
  assert.equal(finalResult.status, 1);
  assert.match(finalResult.stderr, /OUTPUT_SYMLINK_FORBIDDEN/);

  const existing = path.join(outputRoot, 'existing-ledger.json');
  await writeFile(existing, 'pre-existing bytes\n');
  const overwrite = invoke(existing);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /OUTPUT_ALREADY_EXISTS/);
  assert.equal(await readFile(existing, 'utf8'), 'pre-existing bytes\n');
});
