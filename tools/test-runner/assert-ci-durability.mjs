import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function receiptFiles(root) {
  return fs.readdirSync(root, { recursive: true })
    .filter((name) => String(name).endsWith('.json'))
    .map((name) => path.join(root, String(name)));
}

function exactReceipt(files, kind) {
  const matches = files
    .map((file) => ({ file, body: JSON.parse(fs.readFileSync(file, 'utf8')) }))
    .filter(({ body }) => body.kind === kind);
  assert.equal(matches.length, 1, `expected exactly one fresh ${kind} receipt`);
  assert.equal(matches[0].body.overall, 'PASS', `${kind} did not pass`);
  return matches[0];
}

const [receiptRoot, restoreTarget] = process.argv.slice(2);
assert.ok(receiptRoot && restoreTarget, 'usage: assert-ci-durability.mjs <receipt-root> <restore-target>');

const repository = process.cwd();
const expected = {
  commit: git(repository, 'rev-parse', 'HEAD'),
  tree: git(repository, 'rev-parse', 'HEAD^{tree}'),
};
const files = receiptFiles(path.resolve(receiptRoot));
const build = exactReceipt(files, 'durability-build');
const verify = exactReceipt(files, 'durability-verify');
const restore = exactReceipt(files, 'durability-restore');

for (const receipt of [build, verify]) {
  assert.equal(receipt.body.source.commit, expected.commit);
  assert.equal(receipt.body.source.tree, expected.tree);
}
assert.equal(restore.body.restored.commit, expected.commit);
assert.equal(restore.body.restored.tree, expected.tree);
assert.equal(restore.body.restored.status, '');
assert.equal(build.body.artifact, verify.body.artifact);
assert.equal(build.body.artifact, restore.body.artifact);
assert.equal(verify.body.bundle, 'PASS');
assert.equal(verify.body.gitFsck, 'PASS');
assert.equal(verify.body.bundleReconstructionTree, expected.tree);
assert.equal(verify.body.binaryPatchReconstructionTree, expected.tree);
assert.equal(verify.body.focusedExecution.status, 'PASS');
assert.equal(git(path.resolve(restoreTarget), 'status', '--porcelain'), '');

process.stdout.write(`${JSON.stringify({
  overall: 'PASS',
  source: expected,
  receipts: [build.file, verify.file, restore.file],
  restoreTarget: path.resolve(restoreTarget),
}, null, 2)}\n`);
