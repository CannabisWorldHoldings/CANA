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
      'public/apple-touch-icon.png',
      '8c75e489bd413e7625dbb6065c4f6dd54ed8ea1cf21e38494c0ccc6eea73ca68',
    ],
    [
      'public/icon-192.png',
      'f496c53d921d77b90d17d0e3af7087c213f92e7491c7ae61d41a6a4b89e520b5',
    ],
    [
      'public/icon-512.png',
      '1fa428a6989bd51292fce06274a7929d0e1290d174e8d38b0bfe8e596bfe54e0',
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
