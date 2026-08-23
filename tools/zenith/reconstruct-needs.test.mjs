import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateNeedLedger } from './reconstruct-needs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INPUTS = path.join(ROOT, 'docs/zenith/NEED_ITEM_INPUTS.json');
const INPUT_DIR = path.join(ROOT, 'docs/zenith/inputs');

const withTempOutput = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-needs-'));
  try {
    return fn(path.join(dir, 'NEED_ITEM_LEDGER.json'), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('NeedItem generator emits the named gates with deterministic canonical bytes', () => withTempOutput((output) => {
  const first = generateNeedLedger({ inputsPath: INPUTS, outputPath: output });
  const firstBytes = fs.readFileSync(output);
  const second = generateNeedLedger({ inputsPath: INPUTS, outputPath: output });
  const secondBytes = fs.readFileSync(output);

  assert.equal(first.digest, second.digest);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(first.observed_at, '2026-08-23T04:35:43.000Z');
  assert.equal(first.authority_effect, 'NONE');
  assert.deepEqual(first.external_effects, {
    credential_reads: 0,
    deployments: 0,
    dns_writes: 0,
    production_mutations: 0,
    public_mutations: 0,
    spend_cents: 0,
  });
  assert.equal(first.need_items.length, 12);
  assert.deepEqual(first.need_items.map((item) => item.id), [...first.need_items.map((item) => item.id)].sort());
  for (const item of first.need_items) {
    assert.ok(['SATISFIED', 'OPEN', 'BLOCKED_EXTERNAL', 'INPUT_REQUIRED', 'UNKNOWN'].includes(item.need_state));
    assert.equal(item.decision_eligible, item.need_state === 'SATISFIED');
    assert.ok(item.next_gate);
    assert.ok(item.gate_kind);
    assert.ok(item.owner);
    assert.ok(item.evidence_refs.length > 0);
  }
  assert.deepEqual(first.need_items.map((item) => item.need_kind), [
    'BACKUP_ROLLBACK_PROOF',
    'CLOUDFLARE_OPENNEXT_LOCAL_COMPATIBILITY',
    'HYPERDRIVE_NEON_TRANSPORT_DECISION',
    'MANAGED_H3_PROVIDER_PROOF',
    'MANAGED_POSTGRES_OWNER_CREDENTIALS',
    'NEXT_STABLE_SECURITY_PATCH_RECOURT',
    'OWNER_CLOUDFLARE_CREDENTIALS',
    'OWNER_DRAFT_REVIEW_PROMOTION_AUTHORITY',
    'PUBLIC_MARKET_EMPTY_LIVE_ACQUISITION_FRONTIER',
    'REAL_CUSTOMER_OUTCOMES',
    'REAL_MERCHANT_OUTCOMES',
    'SOURCE_INPUT_COMPLETENESS',
  ]);
  console.log(`need_ledger_sha256=${first.digest}`);
}));

test('unknown ownership preserves an evidence-bound need state, while missing evidence demotes it', () => withTempOutput((output, dir) => {
  const fixture = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  fixture.needs[0].owner = 'UNKNOWN';
  const preservedPath = path.join(dir, 'preserved-inputs.json');
  fs.writeFileSync(preservedPath, `${JSON.stringify(fixture, null, 2)}\n`);
  const preserved = generateNeedLedger({ inputsPath: preservedPath, outputPath: output });
  const preservedItem = preserved.need_items.find((candidate) => candidate.id === fixture.needs[0].id);
  assert.equal(preservedItem.need_state, 'BLOCKED_EXTERNAL');
  assert.equal(preservedItem.owner, 'UNKNOWN');

  fixture.needs[0].evidence_logical_paths = ['docs/zenith/not-present.json'];
  const fixturePath = path.join(dir, 'unknown-inputs.json');
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

  const result = generateNeedLedger({ inputsPath: fixturePath, outputPath: output });
  const item = result.need_items.find((candidate) => candidate.id === fixture.needs[0].id);
  assert.equal(item.need_state, 'UNKNOWN');
  assert.equal(item.decision_eligible, false);
  assert.equal(item.owner, 'UNKNOWN');
  assert.equal(item.epistemic_state, 'UNKNOWN');
}));

test('generator refuses absolute input paths', () => withTempOutput((output, dir) => {
  const fixture = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  fixture.inputs[0].logical_path = '/private/input.json';
  const fixturePath = path.join(dir, 'invalid-inputs.json');
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  assert.throws(() => generateNeedLedger({ inputsPath: fixturePath, outputPath: output }), /PATH_NOT_REPOSITORY_RELATIVE/);
}));

test('generator refuses a one-byte input mutation after a green digest court', () => withTempOutput((output, dir) => {
  const basename = `.need-ledger-mutation-${process.pid}.json`;
  const logicalPath = `docs/zenith/inputs/${basename}`;
  const inputPath = path.join(INPUT_DIR, basename);
  const bytes = Buffer.from('{"value":"original"}\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fixture = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  fixture.inputs = [{ logical_path: logicalPath, sha256, source_kind: 'RECEIPT' }];
  fixture.needs = [{
    id: 'need_mutation_fixture', need_kind: 'INPUT_MUTATION', need_state: 'OPEN',
    next_gate: 'REPAIR_INPUT', gate_kind: 'INPUT', owner: 'UNKNOWN', epistemic_state: 'OBSERVED',
    source_logical_path: logicalPath, evidence_logical_paths: [logicalPath],
  }];
  const fixturePath = path.join(dir, 'mutation-inputs.json');
  try {
    fs.writeFileSync(inputPath, bytes);
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    assert.equal(generateNeedLedger({ inputsPath: fixturePath, outputPath: output }).need_items[0].need_state, 'OPEN');
    fs.writeFileSync(inputPath, Buffer.from('{"value":"ariginal"}\n'));
    assert.throws(() => generateNeedLedger({ inputsPath: fixturePath, outputPath: output }), /INPUT_DIGEST_MISMATCH/);
  } finally {
    fs.rmSync(inputPath, { force: true });
  }
}));

test('generator refuses symlink inputs and fabricated capability owners', () => withTempOutput((output, dir) => {
  const basename = `.need-ledger-symlink-${process.pid}.json`;
  const logicalPath = `docs/zenith/inputs/${basename}`;
  const linkPath = path.join(INPUT_DIR, basename);
  const fixture = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  fixture.inputs = [{ logical_path: logicalPath, sha256: fixture.inputs[0].sha256, source_kind: 'RECEIPT' }];
  fixture.needs = [{
    id: 'need_symlink_fixture', need_kind: 'SYMLINK_INPUT', need_state: 'OPEN',
    next_gate: 'REPAIR_INPUT', gate_kind: 'INPUT', owner: 'UNKNOWN', epistemic_state: 'OBSERVED',
    source_logical_path: logicalPath, evidence_logical_paths: [logicalPath],
  }];
  const fixturePath = path.join(dir, 'symlink-inputs.json');
  try {
    fs.symlinkSync('CURRENT_STATE_RECEIPT.json', linkPath);
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    assert.throws(() => generateNeedLedger({ inputsPath: fixturePath, outputPath: output }), /INPUT_SYMLINK_FORBIDDEN/);
  } finally {
    fs.rmSync(linkPath, { force: true });
  }

  const ownerFixture = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  ownerFixture.needs[0].owner = 'CANA_OWNER';
  fs.writeFileSync(fixturePath, `${JSON.stringify(ownerFixture, null, 2)}\n`);
  assert.throws(() => generateNeedLedger({ inputsPath: fixturePath, outputPath: output }), /OWNER_NOT_REGISTERED/);
}));
