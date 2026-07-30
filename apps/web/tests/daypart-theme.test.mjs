import assert from 'node:assert/strict';
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
