import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = path.join(ROOT, 'tools', 'mariadb-sim', 'schema.prisma');
const codeOnly = (source) => source
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

test('the MariaDB candidate is provider-specific and annotates every approved long field', () => {
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  const code = codeOnly(schema);
  assert.match(schema, /provider\s*=\s*"mysql"/);
  assert.doesNotMatch(code, /\bdirectUrl\b|extensions\s*=\s*\[postgis\]|postgresqlExtensions/);
  assert.match(schema, /geom\s+Unsupported\("geometry"\)\?/);
  for (const field of [
    'description',
    'notes',
    'details',
    'summary',
    'evidence',
    'uncertainty',
    'preparedAction',
    'content',
    'oldValue',
    'newValue',
    'rawJson',
    'evidenceChain',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\s+String\\??\\s+@db\\.Text\\b`));
  }
  for (const model of ['ContinuationReceipt', 'Opportunity']) {
    const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    assert.match(block, /\bevidence\s+String\??\s+@db\.Text\b/,
      `${model}.evidence must be widened independently on the MariaDB candidate`);
  }
});

test('the candidate is generated from canonical PostgreSQL without changing that source', async () => {
  const sourcePath = path.join(ROOT, 'apps', 'web', 'prisma', 'schema.prisma');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const { generateCandidate } = await import('./generate-schema.mjs');
  const candidate = generateCandidate(source);
  assert.match(source, /provider\s*=\s*"postgresql"/);
  assert.match(candidate, /provider\s*=\s*"mysql"/);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), source);
  assert.doesNotMatch(codeOnly(candidate), /\bdirectUrl\b|extensions\s*=\s*\[postgis\]|postgresqlExtensions/);
});

test('the MariaDB runner exposes the exact 11.4 execution surface', async () => {
  const module = await import('./run.mjs');
  assert.equal(typeof module.runMariaSimulation, 'function');
  assert.equal(
    module.MARIA_IMAGE,
    'mariadb@sha256:54ac814d243128263e18cf818f7abb611bf43a7a95ce8aa102d18f527b1516d1',
  );
});

test('candidate execution requires a manifest-only dependency fetch and internal network', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'tools', 'mariadb-sim', 'run.mjs'),
    'utf8',
  );
  assert.match(source, /npm[\s\S]*ci[\s\S]*--ignore-scripts/);
  assert.match(source, /candidate source became visible during dependency fetch/);
  assert.match(source, /candidate execution network is not isolated/);
});

test('the candidate SQL fails closed for ATTRIBUTION rows without event identity', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'tools', 'mariadb-sim', 'candidate-cutover.sql'),
    'utf8',
  );
  assert.match(
    sql,
    /`?kind`?\s*<>\s*'ATTRIBUTION'\s+OR\s+`?eventIdentity`?\s+IS\s+NOT\s+NULL/i,
  );
});
