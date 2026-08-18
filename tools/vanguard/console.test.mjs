// CANA CONSOLE courts — the mouth must compile deterministically, refuse
// owner gates by name, admit ignorance instead of guessing, and receipt
// every command on a chain.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { compile, execute } from './console.mjs';
import { verifyFlywheelFile } from '../alive-loop/flywheel.mjs';

test('intent grammar compiles the owner\'s natural phrasings deterministically', () => {
  assert.equal(compile('what should we do next').id, 'next');
  assert.equal(compile('give me the status').id, 'status');
  assert.equal(compile("how are we").id, 'status');
  assert.equal(compile('run a cycle').id, 'pulse');
  assert.equal(compile('verify the ledgers').id, 'sweep');
  assert.equal(compile('how fast do we learn').id, 'ttrl');
  assert.equal(compile('show me the queue').id, 'queue');
  assert.equal(compile('help').id, 'help');
});

test('OWNER GATES refuse by name — the console can never take gated actions', () => {
  const dep = compile('deploy this to production');
  assert.equal(dep.kind, 'REFUSED_OWNER_GATE');
  assert.match(dep.gate, /KEY 2/);
  assert.equal(compile('push the branch and open a PR').kind, 'REFUSED_OWNER_GATE');
  assert.equal(compile('email the merchant the preview').kind, 'REFUSED_OWNER_GATE');
  assert.match(compile('email the merchant the preview').gate, /KEY 3/);
  assert.equal(compile('buy some ads').kind, 'REFUSED_OWNER_GATE');
});

test('unknown utterances return UNKNOWN with suggestions — never best-effort execution', () => {
  const u = compile('flurb the wombat sideways');
  assert.equal(u.kind, 'UNKNOWN');
  assert.ok(u.suggestions.length >= 1);
});

test('every command is a chained receipt; the chain verifies strict', async () => {
  const r1 = await execute('help');
  assert.equal(r1.compiled.id, 'help');
  assert.ok(Array.isArray(r1.result.commands));
  const r2 = await execute('deploy to production');
  assert.equal(r2.compiled.kind, 'REFUSED_OWNER_GATE');
  const file = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', '..', '.cana-local', 'flywheel', 'console.jsonl');
  assert.ok(fs.existsSync(file), 'console receipts exist');
  const v = verifyFlywheelFile(file);
  assert.equal(v.valid, true, 'console receipt chain verifies strict');
  assert.ok(v.count >= 2);
});
