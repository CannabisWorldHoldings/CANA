import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  inspectArchive,
  inspectBundle,
  reconstructSourceHistory,
} from './reconstruct-source-history.mjs';

const MODULE_PATH = fileURLToPath(new URL('./reconstruct-source-history.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), '..', '..');
let outputSequence = 0;

function repoOutputDir(t, label) {
  const dir = path.join(REPO_ROOT, '.omo', `zenith-source-output-${process.pid}-${label}-${outputSequence += 1}`);
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options }).trim();

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zenith-source-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const candidate = path.join(root, 'candidate');
  const mirror = path.join(root, 'mirror.git');
  mkdirSync(source);
  git(['init', '-q'], { cwd: source });
  git(['config', 'user.name', 'Court'], { cwd: source });
  git(['config', 'user.email', 'court@example.invalid'], { cwd: source });
  writeFileSync(path.join(source, 'truth.txt'), 'one\n');
  git(['add', 'truth.txt'], { cwd: source });
  git(['commit', '-qm', 'one'], { cwd: source });
  const first = git(['rev-parse', 'HEAD'], { cwd: source });
  writeFileSync(path.join(source, 'truth.txt'), 'two\n');
  git(['commit', '-qam', 'two'], { cwd: source });
  const second = git(['rev-parse', 'HEAD'], { cwd: source });
  const bundle = path.join(root, 'history.bundle');
  git(['bundle', 'create', bundle, 'HEAD'], { cwd: source });
  git(['clone', '-q', source, candidate]);
  git(['clone', '--mirror', '-q', source, mirror]);
  return { root, source, candidate, mirror, bundle, first, second };
}

function candidateCustody(repo) {
  return {
    head: git(['rev-parse', 'HEAD'], { cwd: repo }),
    tree: git(['rev-parse', 'HEAD^{tree}'], { cwd: repo }),
    refs: git(['show-ref'], { cwd: repo }),
    objects: git(['count-objects', '-v'], { cwd: repo }),
  };
}

test('bundle inspection distinguishes a non-advertised contained ancestor from an absent object', (t) => {
  const f = fixture(t);
  const before = candidateCustody(f.mirror);
  const result = inspectBundle(f.bundle, {
    label: 'fixtures/history.bundle',
    wantedShas: [f.first, f.second],
  });

  assert.equal(result.verification_status, 'VERIFIED');
  assert.deepEqual(result.advertised_heads.map((head) => head.sha), [f.second]);
  assert.deepEqual(result.matched_advertised_donors, [f.second]);
  assert.deepEqual(result.contained_wanted_shas, [f.first, f.second].sort());
  assert.deepEqual(result.contained_non_advertised_wanted_shas, [f.first]);
  assert.deepEqual(result.non_contained_wanted_shas, []);
  assert.equal(result.object_inspection_status, 'COMPLETE');
  assert.deepEqual(result.donor_dispositions, [
    { sha: f.first, admission: 'EXACT_CONTAINED_NON_ADVERTISED' },
    { sha: f.second, admission: 'EXACT_ADVERTISED' },
  ].sort((a, b) => a.sha.localeCompare(b.sha)));
  assert.deepEqual(candidateCustody(f.mirror), before);
  assert.equal(JSON.stringify(result).includes(f.root), false);
});

test('parent traversal is rejected in one nested container while a safe sibling bundle still scans', (t) => {
  const f = fixture(t);
  const nestedZip = path.join(f.root, 'nested-unsafe.zip');
  const unsafeZip = path.join(f.root, 'unsafe.zip');
  execFileSync('python3', ['-c', [
    'import sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1], "w") as z: z.writestr("../escape.bundle", b"not a bundle")',
  ].join('\n'), nestedZip]);
  const python = [
    'import sys, zipfile',
    'z=zipfile.ZipFile(sys.argv[1], "w")',
    'z.write(sys.argv[2], "safe/history.bundle")',
    'z.write(sys.argv[3], "unsafe/nested.zip")',
    'z.close()',
  ].join(';');
  execFileSync('python3', ['-c', python, unsafeZip, f.bundle, nestedZip]);

  const result = inspectArchive(unsafeZip, {
    label: 'fixtures/unsafe.zip',
    wantedShas: [f.second],
  });

  assert.equal(result.archive_safety, 'SAFE_LISTING');
  assert.equal(result.bundle_members.length, 1);
  assert.deepEqual(result.matched_advertised_donors, [f.second]);
  assert.equal(result.nested_containers.length, 1);
  assert.equal(result.nested_containers[0].archive_safety, 'SAFE_WITH_REJECTIONS');
  assert.equal(result.nested_containers[0].rejected_members.some((member) => member.name === '../escape.bundle' && member.reason === 'PARENT_TRAVERSAL'), true);
  assert.equal(JSON.stringify(result).includes(f.root), false);
});

test('AppleDouble quarantine does not abort recursively scanned safe nested archives', (t) => {
  const f = fixture(t);
  const nested = path.join(f.root, 'nested.zip');
  const outer = path.join(f.root, 'outer.zip');
  execFileSync('python3', ['-c', [
    'import sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1], "w") as z: z.write(sys.argv[2], "history.bundle")',
  ].join('\n'), nested, f.bundle]);
  execFileSync('python3', ['-c', [
    'import sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1], "w") as z:',
    ' z.writestr("__MACOSX/._nested.zip", b"metadata")',
    ' z.write(sys.argv[2], "safe/nested.zip")',
  ].join('\n'), outer, nested]);

  const result = inspectArchive(outer, { label: 'fixtures/outer.zip', wantedShas: [f.second] });
  assert.equal(result.archive_safety, 'SAFE_WITH_QUARANTINE');
  assert.equal(result.quarantined_members.some((row) => row.reason === 'APPLEDOUBLE'), true);
  assert.deepEqual(result.matched_advertised_donors, [f.second]);
  assert.equal(result.nested_containers.length, 1);
  assert.equal(result.nested_containers[0].bundle_members.length, 1);
});

test('artifact-root resolution rejects symlinks and escape paths', (t) => {
  const f = fixture(t);
  const link = path.join(f.root, 'linked.bundle');
  symlinkSync(f.bundle, link);
  const base = {
    schema_version: 'zenith-donor-scan-inputs/v1',
    observed_at: '2026-08-23T00:00:00.000Z',
    main_sha: f.second,
    known_commits: [{ sha: f.first, expected_relation: 'ANCESTOR' }],
    non_ancestor_commits: [],
    wanted_donors: ['f'.repeat(40)],
    scan_budget: { max_depth: 4, max_containers: 20, max_members: 200, max_total_uncompressed_bytes: 10000000, max_member_bytes: 5000000, max_text_member_bytes: 100000, max_total_text_bytes: 1000000 },
    authority_effect: 'NONE',
    external_effects: { network: false, canonical_ref_writes: false, archive_code_execution: false },
  };
  assert.throws(() => reconstructSourceHistory({ repo: f.mirror, artifactRoot: f.root, manifest: { ...base, containers: [{ logical_path: '../escape.bundle', kind: 'BUNDLE' }] } }), /PATH_NOT_ROOT_RELATIVE/);
  assert.throws(() => reconstructSourceHistory({ repo: f.mirror, artifactRoot: f.root, manifest: { ...base, containers: [{ logical_path: 'linked.bundle', kind: 'BUNDLE' }] } }), /CONTAINER_SYMLINK_FORBIDDEN/);
});

test('reconstruction is deterministic, validates ancestry, and preserves absent donor truth', (t) => {
  const f = fixture(t);
  const manifest = {
    schema_version: 'zenith-donor-scan-inputs/v1',
    observed_at: '2026-08-23T00:00:00.000Z',
    main_sha: f.second,
    known_commits: [
      { sha: f.first, expected_relation: 'ANCESTOR' },
      { sha: f.second, expected_relation: 'ANCESTOR' },
    ],
    non_ancestor_commits: [],
    wanted_donors: ['f'.repeat(40)],
    scan_budget: { max_depth: 4, max_containers: 20, max_members: 200, max_total_uncompressed_bytes: 10000000, max_member_bytes: 5000000, max_text_member_bytes: 100000, max_total_text_bytes: 1000000 },
    authority_effect: 'NONE',
    external_effects: { network: false, canonical_ref_writes: false, archive_code_execution: false },
    containers: [{ logical_path: 'history.bundle', kind: 'BUNDLE' }],
  };
  const before = candidateCustody(f.mirror);
  const first = reconstructSourceHistory({ repo: f.mirror, artifactRoot: f.root, manifest });
  const second = reconstructSourceHistory({ repo: f.mirror, artifactRoot: f.root, manifest });

  assert.deepEqual(first, second);
  assert.equal(first.sourceHistory.main_sha, f.second);
  assert.equal(first.sourceHistory.relations.every((row) => row.observed_relation === 'ANCESTOR'), true);
  assert.deepEqual(first.dispositions.donors, [{
    sha: 'f'.repeat(40),
    disposition: 'ABSENT',
    advertised_by: [],
    contained_by: [],
    text_exact_sha_hits: [],
    epistemic_state: 'UNKNOWN',
  }]);
  assert.equal(first.inspection.scan_complete, true);
  assert.equal(first.sourceHistory.nodes.every((node) => node.owner === 'UNKNOWN'), true);
  assert.equal(first.sourceHistory.observed_at, manifest.observed_at);
  assert.equal(first.dispositions.external_effects.network, false);
  assert.equal(JSON.stringify(first).includes(f.root), false);
  assert.deepEqual(candidateCustody(f.mirror), before);
});

test('an exhausted scan budget keeps an unadvertised donor UNRESOLVED instead of asserting ABSENT', (t) => {
  const f = fixture(t);
  const zip = path.join(f.root, 'budget.zip');
  execFileSync('python3', ['-c', [
    'import sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1], "w") as z:',
    ' z.writestr("a.txt", "one")',
    ' z.writestr("b.txt", "two")',
  ].join('\n'), zip]);
  const manifest = {
    schema_version: 'zenith-donor-scan-inputs/v1',
    observed_at: '2026-08-23T00:00:00.000Z',
    main_sha: f.second,
    known_commits: [],
    non_ancestor_commits: [],
    wanted_donors: ['e'.repeat(40)],
    scan_budget: { max_depth: 1, max_containers: 2, max_members: 1, max_total_uncompressed_bytes: 100, max_member_bytes: 100, max_text_member_bytes: 100, max_total_text_bytes: 100 },
    authority_effect: 'NONE',
    external_effects: { network: false, canonical_ref_writes: false, archive_code_execution: false },
    containers: [{ logical_path: 'budget.zip', kind: 'ZIP_ARCHIVE' }],
  };
  const result = reconstructSourceHistory({ repo: f.mirror, artifactRoot: f.root, manifest });
  assert.equal(result.inspection.scan_complete, false);
  assert.equal(result.dispositions.donors[0].disposition, 'UNRESOLVED');
});

test('CLI output custody rejects outside-root directories, symlink components/finals, and overwrite', (t) => {
  const f = fixture(t);
  const manifest = {
    schema_version: 'zenith-donor-scan-inputs/v1', observed_at: '2026-08-23T00:00:00.000Z', main_sha: f.second,
    known_commits: [{ sha: f.first, expected_relation: 'ANCESTOR' }], non_ancestor_commits: [], wanted_donors: ['f'.repeat(40)],
    scan_budget: { max_depth: 4, max_containers: 20, max_members: 200, max_total_uncompressed_bytes: 10000000, max_member_bytes: 5000000, max_text_member_bytes: 100000, max_total_text_bytes: 1000000 },
    authority_effect: 'NONE', external_effects: { network: false, canonical_ref_writes: false, archive_code_execution: false },
    containers: [{ logical_path: 'history.bundle', kind: 'BUNDLE' }],
  };
  const inputPath = path.join(f.root, 'scan-inputs.json');
  writeFileSync(inputPath, JSON.stringify(manifest));
  const outputRoot = repoOutputDir(t, 'custody');
  const invoke = (outputDir) => execFileSync(process.execPath, [MODULE_PATH, '--repo', f.mirror, '--artifact-root', f.root, '--scan-inputs', inputPath, '--output-dir', outputDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const invokeResult = (outputDir) => {
    try { return { status: 0, stdout: invoke(outputDir), stderr: '' }; }
    catch (error) { return { status: error.status, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? '' }; }
  };

  const greenDir = path.join(outputRoot, 'green');
  mkdirSync(greenDir);
  const green = invokeResult(greenDir);
  assert.equal(green.status, 0, green.stderr);
  assert.equal(readFileSync(path.join(greenDir, 'SOURCE_HISTORY_PROJECTION.json'), 'utf8').includes('zenith-source-history-projection/v1'), true);

  const outside = path.join(f.root, 'outside-output');
  const outsideResult = invokeResult(outside);
  assert.equal(outsideResult.status, 1);
  assert.match(outsideResult.stderr, /OUTPUT_PATH_ESCAPES_ROOT/);

  const componentLink = path.join(outputRoot, 'component-link');
  symlinkSync(f.root, componentLink);
  const componentResult = invokeResult(path.join(componentLink, 'child'));
  assert.equal(componentResult.status, 1);
  assert.match(componentResult.stderr, /OUTPUT_SYMLINK_FORBIDDEN/);

  const finalLink = path.join(outputRoot, 'final-link');
  symlinkSync(f.root, finalLink);
  const finalResult = invokeResult(finalLink);
  assert.equal(finalResult.status, 1);
  assert.match(finalResult.stderr, /OUTPUT_SYMLINK_FORBIDDEN/);

  const existingDir = path.join(outputRoot, 'existing');
  mkdirSync(existingDir);
  const existing = path.join(existingDir, 'SOURCE_HISTORY_PROJECTION.json');
  writeFileSync(existing, 'pre-existing bytes\n');
  const overwrite = invokeResult(existingDir);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /OUTPUT_ALREADY_EXISTS/);
  assert.equal(readFileSync(existing, 'utf8'), 'pre-existing bytes\n');
});
