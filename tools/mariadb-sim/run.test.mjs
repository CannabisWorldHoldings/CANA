import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = path.join(ROOT, 'tools', 'mariadb-sim', 'schema.prisma');

test('the MariaDB candidate is provider-specific and annotates every approved long field', () => {
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  assert.match(schema, /provider\s*=\s*"mysql"/);
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
});

test('the MariaDB runner exposes the exact 11.4 execution surface', async () => {
  const module = await import('./run.mjs');
  assert.equal(typeof module.runMariaSimulation, 'function');
  assert.equal(
    module.MARIA_IMAGE,
    'mariadb@sha256:54ac814d243128263e18cf818f7abb611bf43a7a95ce8aa102d18f527b1516d1',
  );
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
