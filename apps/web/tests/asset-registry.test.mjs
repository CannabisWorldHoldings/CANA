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
  issuePendingRightsCapability,
  isPendingAssetPath,
  listAssets,
  mayRepresentRealEntity,
  mayServePendingAssetPath,
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

test('every local illustrative file is registered for fail-closed HTTP delivery', () => {
  const illustrativeFiles = [
    '/art/cat-accessories.jpg',
    '/art/cat-concentrates.jpg',
    '/art/cat-edibles.jpg',
    '/art/cat-flower.jpg',
    '/art/cat-pre-rolls.jpg',
    '/art/cat-topicals.jpg',
    '/art/cat-vapes.jpg',
    '/art/hero-dc.jpg',
    '/art/hero-dc.webp',
    '/art/retailer-delivery.jpg',
    '/art/retailer-storefront.jpg',
    '/marketplace/hero-marketplace-v2.webp',
    '/marketplace/product-0.webp',
    '/marketplace/product-1.webp',
    '/marketplace/product-2.webp',
    '/marketplace/product-3.webp',
    '/marketplace/retailer-0.webp',
    '/marketplace/retailer-1.webp',
    '/marketplace/retailer-2.webp',
    '/marketplace/retailer-3.webp',
  ];
  for (const assetPath of illustrativeFiles) {
    assert.ok(getAssetByPath(assetPath), assetPath);
    assert.equal(isPendingAssetPath(assetPath), true, assetPath);
  }
});

test('generic illustrative assets may never represent a real entity', () => {
  const capability = issuePendingRightsCapability('orderweeddc.localhost');
  for (const record of listAssets()) {
    if (record.subject === 'GENERIC_ILLUSTRATIVE') {
      assert.equal(mayRepresentRealEntity(record.id), false);
      assert.throws(
        () => resolveAssetUse(record.id, record.contexts[0], {
          pendingRightsCapability: capability,
          representsRealEntity: true,
        }),
        /may not represent a real entity/,
      );
    }
  }
});

test('render authorization enforces context and pending rights', () => {
  const capability = issuePendingRightsCapability('orderweeddc.localhost');
  assert.ok(capability);
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
      pendingRightsCapability: capability,
    })?.path,
    '/art/cat-flower.jpg',
  );
  assert.throws(
    () => resolveAssetUse('home.category.flower', 'hero-ambience', {
      pendingRightsCapability: capability,
    }),
    /not authorized for context/,
  );
  assert.throws(
    () => resolveAssetUse('missing.asset', 'styleguide'),
    /unknown registered asset/,
  );
});

test('pending-rights capability is local, non-production, and unforgeable', () => {
  const localCapability = issuePendingRightsCapability('orderweeddc.localhost');
  assert.ok(localCapability);
  assert.equal(issuePendingRightsCapability('orderweeddc.com'), null);
  assert.equal(issuePendingRightsCapability('localhost'), null);
  assert.equal(
    resolveAssetUse('home.category.flower', 'category-navigation', {
      pendingRightsCapability: {},
    }),
    null,
  );

  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(issuePendingRightsCapability('orderweeddc.localhost'), null);
    assert.equal(
      resolveAssetUse('home.category.flower', 'category-navigation', {
        pendingRightsCapability: localCapability,
      }),
      null,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('pending file delivery is restricted to local non-production hosts', () => {
  const pendingPath = '/marketplace/hero-marketplace-v2.webp';
  const nestedPendingPath = (depth) => {
    let value = '/%61rt/cat-flower.jpg';
    for (let index = 1; index < depth; index += 1) {
      value = value.replaceAll('%', '%25');
    }
    return value;
  };
  assert.equal(mayServePendingAssetPath(pendingPath, 'orderweeddc.localhost'), true);
  assert.equal(mayServePendingAssetPath(pendingPath, 'orderweeddc.com'), false);
  assert.equal(mayServePendingAssetPath(pendingPath, 'localhost'), false);
  assert.equal(mayServePendingAssetPath('/brand/orderweeddc-on-light.png', 'orderweeddc.com'), true);
  for (const encodedPath of [
    '/art/%63at-flower.jpg',
    '/art/cat-flower%2Ejpg',
    '/%61rt/cat-flower.jpg',
    '/%2561rt/cat-flower.jpg',
    '/%2Fart%2Fcat-flower.jpg',
    '/%5Cart%5Ccat-flower.jpg',
    '/safe/%2e%2e/art/cat-flower.jpg',
    '/marketplace%2Fhero-marketplace-v2.webp',
    nestedPendingPath(8),
    nestedPendingPath(32),
  ]) {
    assert.equal(isPendingAssetPath(encodedPath), true, encodedPath);
    assert.equal(mayServePendingAssetPath(encodedPath, 'orderweeddc.com'), false, encodedPath);
  }

  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(mayServePendingAssetPath(pendingPath, 'orderweeddc.localhost'), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('registry records and nested policy fields are immutable', () => {
  const records = listAssets();
  const record = getAsset('home.category.flower');
  assert.ok(Object.isFrozen(records));
  assert.ok(record);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.aspect));
  assert.ok(Object.isFrozen(record.contexts));
  assert.throws(() => { record.rights = 'OWNED'; }, TypeError);
  assert.throws(() => { record.contexts.push('hero-ambience'); }, TypeError);
  assert.equal(record.rights, 'OWNED_PROVENANCE_REVIEW_PENDING');
  assert.equal(record.contexts.includes('hero-ambience'), false);
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
