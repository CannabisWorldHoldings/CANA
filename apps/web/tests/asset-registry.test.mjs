import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSET_KINDS,
  assertRegisteredImage,
  getAsset,
  getAssetByPath,
  listAssets,
  mayRepresentRealEntity,
  SUBJECT_TRUTH,
} from '../src/lib/asset-registry.mjs';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('every registered record is complete, unique, and lawful', () => {
  const records = listAssets();
  assert.ok(records.length >= 15);
  const ids = new Set();
  const paths = new Set();
  for (const record of records) {
    assert.ok(record.id && !ids.has(record.id), `duplicate or missing id: ${record.id}`);
    assert.ok(record.path && !paths.has(record.path), `duplicate or missing path: ${record.path}`);
    ids.add(record.id);
    paths.add(record.path);
    assert.ok(ASSET_KINDS.includes(record.kind), `unknown kind: ${record.kind}`);
    assert.ok(SUBJECT_TRUTH.includes(record.subject), `unknown subject class: ${record.subject}`);
    assert.ok(typeof record.rights === 'string' && record.rights.length > 0);
    assert.ok(Array.isArray(record.aspect) && record.aspect.length === 2);
    assert.ok(typeof record.altGuidance === 'string' && record.altGuidance.length > 0);
    assert.ok(Array.isArray(record.contexts) && record.contexts.length > 0);
  }
});

test('every registered path points at a file that actually exists', () => {
  for (const record of listAssets()) {
    assert.ok(
      existsSync(path.join(PUBLIC_DIR, record.path)),
      `registered asset missing on disk: ${record.path}`,
    );
  }
});

test('generic illustrative assets may never represent a real entity', () => {
  for (const record of listAssets()) {
    if (record.subject === 'GENERIC_ILLUSTRATIVE') {
      assert.equal(mayRepresentRealEntity(record.id), false);
      assert.ok(
        record.contexts.every((context) => ['demonstration', 'styleguide', 'hero-ambience'].includes(context)),
        `illustrative asset with an unlawful context: ${record.id}`,
      );
    }
  }
});

test('the registry gate throws for unregistered consumer imagery', () => {
  assert.equal(assertRegisteredImage('/brand/orderweeddc-on-light.png'), true);
  assert.equal(assertRegisteredImage('/uploads/attested/merchant-123/storefront.avif'), true);
  assert.throws(() => assertRegisteredImage('/random/unvetted.png'), /unregistered image/);
  assert.throws(() => assertRegisteredImage(''), /required/);
});

test('lookups resolve by id and by path', () => {
  const byId = getAsset('brand.wordmark.light');
  assert.equal(byId?.path, '/brand/orderweeddc-on-light.png');
  const byPath = getAssetByPath('/marketplace/hero-marketplace-v2.webp');
  assert.equal(byPath?.id, 'marketplace.hero.v2');
  assert.equal(getAsset('nonexistent.asset'), null);
});
