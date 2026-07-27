import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the canonical import preparer is an offline callable surface', async () => {
  const module = await import('./prepare.mjs');
  assert.equal(typeof module.prepareGithubImport, 'function');
  assert.equal(module.CANONICAL_REPOSITORY, 'CannabisWorldHoldings/CANA');
});

test('protected main requires every candidate verification lane', () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'github-import', 'protected-main-policy.json')),
  );
  assert.equal(policy.enforce_admins, true);
  for (const context of [
    'candidate-unit',
    'focused-verifier',
    'maria-verifier',
    'cpanel-verifier',
    'durability-proof',
    'github-import-offline',
  ]) {
    assert.ok(policy.required_status_checks.contexts.includes(context), context);
  }
});

test('integration pull requests preserve evidence and owner gates', () => {
  const template = fs.readFileSync(
    path.join(ROOT, 'tools', 'github-import', 'PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.match(template, /exact commit and tree/i);
  assert.match(template, /owner-gated/i);
  assert.match(template, /provider flip.*not merged/i);
  assert.match(template, /rollback/i);
});

test('workflow leaves runtime equality unproven until an executed receipt is supplied', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify.yml'),
    'utf8',
  );
  assert.match(workflow, /run: \.\/cana github prepare\s*$/m);
  assert.doesNotMatch(workflow, /github prepare --runtime-sha/);
});
