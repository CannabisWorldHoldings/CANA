import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  daypartForLocalHour,
  nextThemeMode,
  resolveDaypart,
} from '../src/lib/daypart-theme.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('automatic daypart changes at the documented local-time boundaries', () => {
  assert.equal(daypartForLocalHour(5), 'night');
  assert.equal(daypartForLocalHour(6), 'day');
  assert.equal(daypartForLocalHour(18), 'day');
  assert.equal(daypartForLocalHour(19), 'night');
  assert.throws(() => daypartForLocalHour(24), RangeError);
});

test('manual modes override time and cycle back to automatic', () => {
  const midday = new Date(2026, 6, 24, 12, 0, 0);
  const midnight = new Date(2026, 6, 24, 0, 0, 0);

  assert.equal(resolveDaypart('auto', midday), 'day');
  assert.equal(resolveDaypart('auto', midnight), 'night');
  assert.equal(resolveDaypart('night', midday), 'night');
  assert.equal(resolveDaypart('day', midnight), 'day');
  assert.equal(nextThemeMode('auto'), 'day');
  assert.equal(nextThemeMode('day'), 'night');
  assert.equal(nextThemeMode('night'), 'auto');
});

test('the selected brand and application artwork ship with the web workspace', () => {
  for (const relativePath of [
    'public/brand/orderweeddc-on-light.png',
    'public/brand/orderweeddc-on-dark.png',
    'public/brand/orderweeddc-glossy-ow-source.png',
    'public/art/hero-dc.webp',
    'public/icon-192.png',
    'public/icon-512.png',
    'public/apple-touch-icon.png',
  ]) {
    const file = path.join(webRoot, relativePath);
    assert.equal(fs.existsSync(file), true, `${relativePath} must exist`);
    assert.ok(fs.statSync(file).size > 5_000, `${relativePath} is too small`);
  }
});

test('the restorable favicon payload matches the approved tracked icon bytes', () => {
  const payload = JSON.parse(
    fs.readFileSync(path.join(webRoot, 'scripts/brand-assets.b64.json'), 'utf8'),
  );
  const approvedHashes = new Map([
    [
      'public/favicon-16x16.png',
      '0b5b717f78384405420cd862ce1a3ee53763ad0d588c48726270df0635f40118',
    ],
    [
      'public/favicon-32x32.png',
      '457c92951207734ec459ec71271e299eb8d0638764091934d2dab9df2ea6de8e',
    ],
    [
      'public/favicon-48x48.png',
      '92f8a52fae2ae89f671b0511a5719cab74735085daccf5d2611fa1ea87bba398',
    ],
    [
      'public/apple-touch-icon.png',
      'd8d2311ffb90545793506efb178586fba7d962d7617ef1a1c709150b4bfdf055',
    ],
    [
      'public/icon-192.png',
      '013788fc5c5731c8ffb9cce69ff338d2938a9da651ae63918eecc15b6c2fb205',
    ],
    [
      'public/icon-512.png',
      'e369a0149f7c3bdf19a4187e4a9da95ca9ae1691b2f0ae783b74fa337e0c98b6',
    ],
  ]);

  for (const [relativePath, expectedHash] of approvedHashes) {
    const trackedBytes = fs.readFileSync(path.join(webRoot, relativePath));
    const payloadKey = `apps/web/${relativePath}`;
    const restoredBytes = Buffer.from(payload[payloadKey], 'base64');
    const trackedHash = crypto.createHash('sha256').update(trackedBytes).digest('hex');
    const restoredHash = crypto.createHash('sha256').update(restoredBytes).digest('hex');

    assert.equal(trackedHash, expectedHash, `${relativePath} must retain the approved hash`);
    assert.equal(restoredHash, expectedHash, `${payloadKey} must restore the approved hash`);
    assert.deepEqual(restoredBytes, trackedBytes, `${payloadKey} must be byte-identical`);
  }
});

test('the glossy OW favicon source remains exact and uncropped', () => {
  const source = fs.readFileSync(
    path.join(webRoot, 'public/brand/orderweeddc-glossy-ow-source.png'),
  );
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex');

  assert.equal(
    sourceHash,
    'c5656ff1f4d528ecb5e10f3bc5d9e681ac2c1be709695374ba24098154a63f71',
  );
  assert.equal(source.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(source.readUInt32BE(16), 1424);
  assert.equal(source.readUInt32BE(20), 1202);
});

test('browser-tab metadata prefers the dedicated non-cropped favicon sizes', () => {
  const layout = fs.readFileSync(path.join(webRoot, 'src/app/layout.tsx'), 'utf8');
  const expectedIcons = [
    ['/favicon-16x16.png', '16x16'],
    ['/favicon-32x32.png', '32x32'],
    ['/favicon-48x48.png', '48x48'],
  ];

  for (const [url, sizes] of expectedIcons) {
    assert.match(layout, new RegExp(`url: '${url}', sizes: '${sizes}'`));
  }
  assert.match(layout, /shortcut: '\/favicon\.ico'/);
  assert.ok(
    layout.indexOf('/favicon-16x16.png') < layout.indexOf('/icon-192.png'),
    'dedicated browser-tab sizes must precede application icons',
  );
});
