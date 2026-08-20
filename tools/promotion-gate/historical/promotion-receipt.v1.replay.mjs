import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the root dispatcher exposes promotion identity and readiness', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'cana'), 'promotion', 'status'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.kind, 'CANA technical promotion status');
  assert.equal(status.branch, 'integration/cana-technical-promotion-de4a497b');
  assert.equal(status.protected.commit, 'c953ebcd25c46ef33af0700d7913a899d839bce8');
  assert.equal(status.candidate.commit, 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318');
  assert.equal(status.history.candidateIsAncestor, true);
  assert.equal(status.history.integrationMergeIsAncestor, true);
});
