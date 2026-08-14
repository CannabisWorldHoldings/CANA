import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSET_CONTEXTS,
  ASSET_KINDS,
  ASSET_RIGHTS,
  assertRegisteredImage,
  getAsset,
  getAssetByPath,
  listAssets,
  mayRepresentRealEntity,
  resolveAssetUse,
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
    assert.ok(ASSET_RIGHTS.includes(record.rights), `unknown rights state: ${record.rights}`);
    assert.ok(Array.isArray(record.aspect) && record.aspect.length === 2);
    assert.ok(typeof record.altGuidance === 'string' && record.altGuidance.length > 0);
    assert.ok(Array.isArray(record.contexts) && record.contexts.length > 0);
    assert.ok(record.contexts.every((context) => ASSET_CONTEXTS.includes(context)));
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
      assert.throws(
        () => resolveAssetUse(record.id, record.contexts[0], {
          allowPendingRights: true,
          representsRealEntity: true,
        }),
        /may not represent a real entity/,
      );
    }
  }
});

test('render authorization enforces context and pending rights', () => {
  assert.equal(
    resolveAssetUse('brand.wordmark.light', 'chrome')?.path,
    '/brand/orderweeddc-on-light.png',
  );
  assert.equal(
    resolveAssetUse('home.category.flower', 'category-navigation'),
    null,
  );
  assert.equal(
    resolveAssetUse('home.category.flower', 'category-navigation', {
      allowPendingRights: true,
    })?.path,
    '/art/cat-flower.jpg',
  );
  assert.throws(
    () => resolveAssetUse('home.category.flower', 'hero-ambience', {
      allowPendingRights: true,
    }),
    /not authorized for context/,
  );
  assert.throws(
    () => resolveAssetUse('missing.asset', 'styleguide'),
    /unknown registered asset/,
  );
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
