import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  daypartForLocalHour,
  nextThemeMode,
  resolveDaypart,
} from '../src/lib/daypart-theme.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const primaryFavicon = '/favicon-glossy-ow-13fd3ae2e4ca.ico';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function icoDimensions(bytes) {
  assert.equal(bytes.readUInt16LE(0), 0, 'ICO reserved field must be zero');
  assert.equal(bytes.readUInt16LE(2), 1, 'ICO must contain images');
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return {
      width: bytes[offset] || 256,
      height: bytes[offset + 1] || 256,
    };
  });
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function pngContentBounds(bytes) {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, 'favicon PNG must be 8-bit');
  assert.equal(bytes[25], 2, 'favicon PNG must use RGB color');
  assert.equal(bytes[28], 0, 'favicon PNG must be non-interlaced');

  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }

  const decoded = zlib.inflateSync(Buffer.concat(idat));
  const rowLength = width * 3;
  const rows = [];
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[cursor];
    cursor += 1;
    const encoded = decoded.subarray(cursor, cursor + rowLength);
    cursor += rowLength;
    const row = Buffer.alloc(rowLength);
    const previous = rows[y - 1];
    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= 3 ? row[x - 3] : 0;
      const above = previous?.[x] ?? 0;
      const upperLeft = x >= 3 ? previous?.[x - 3] ?? 0 : 0;
      const value = encoded[x];
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 255;
      else if (filter === 2) row[x] = (value + above) & 255;
      else if (filter === 3) row[x] = (value + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) row[x] = (value + paethPredictor(left, above, upperLeft)) & 255;
      else assert.fail(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = x * 3;
      if (rows[y][offset] < 235 || rows[y][offset + 1] < 235 || rows[y][offset + 2] < 235) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.ok(maxX >= minX && maxY >= minY, 'favicon must contain visible artwork');
  return {
    height,
    occupiedHeight: maxY - minY + 1,
    occupiedWidth: maxX - minX + 1,
    width,
  };
}

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
      '7a78711025f65ca557a63fa708185cd6a5cc6b22ce4a76dfc827f623b662db2e',
    ],
    [
      'public/favicon-32x32.png',
      '0f618d31340ad6232e4a47639191eba67c7dfabf3fda67bbb4e13d4badaecdd5',
    ],
    [
      'public/favicon-48x48.png',
      '1072122b84d4ad99fb488d2b8cdde398436fad84a703f3dddae4da25688e839e',
    ],
    [
      'public/apple-touch-icon.png',
      'd78c5c25091fbf1479d5aba0df50cd2ce3597042d2f67c7075169812ab3d377d',
    ],
    [
      'public/icon-192.png',
      'e660feb58718c32f6fd9859f0e63b2631b6797063b851732e0260028443a55aa',
    ],
    [
      'public/icon-512.png',
      '64cb00e2a64ccaad7b14790fbbe623d8d6bb1c29c4330c6d441d19a5c0d0c0cc',
    ],
    [
      `public${primaryFavicon}`,
      '13fd3ae2e4ca30fd1c3f43a148a533b850fd8e2846fac43dc50fe5859f5872f7',
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

test('Safari must not select the stale default triangle favicon', () => {
  const appFavicon = fs.readFileSync(path.join(webRoot, 'src/app/favicon.ico'));
  const cacheBustedFavicon = fs.readFileSync(path.join(webRoot, `public${primaryFavicon}`));
  const triangleHash = '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932';

  assert.equal(sha256(appFavicon), '13fd3ae2e4ca30fd1c3f43a148a533b850fd8e2846fac43dc50fe5859f5872f7');
  assert.notEqual(sha256(appFavicon), triangleHash);
  assert.deepEqual(appFavicon, cacheBustedFavicon);
  assert.deepEqual(
    icoDimensions(appFavicon),
    [16, 32, 48, 64, 128, 256].map((size) => ({ width: size, height: size })),
  );
});

test('no competing App Router or public ICO can restore another favicon identity', () => {
  for (const relativePath of [
    'src/app/icon.ico',
    'src/app/icon.png',
    'src/app/icon.svg',
    'src/app/apple-icon.png',
    'public/favicon.ico',
  ]) {
    assert.equal(
      fs.existsSync(path.join(webRoot, relativePath)),
      false,
      `${relativePath} would compete with the approved primary icon`,
    );
  }
});

test('browser-tab artwork keeps tight safe occupancy at every native size', () => {
  for (const size of [16, 32, 48]) {
    const bounds = pngContentBounds(
      fs.readFileSync(path.join(webRoot, `public/favicon-${size}x${size}.png`)),
    );
    assert.equal(bounds.width, size);
    assert.equal(bounds.height, size);
    assert.ok(bounds.occupiedWidth / size >= 0.85, `${size}px artwork is too narrow`);
    assert.ok(bounds.occupiedHeight / size >= 0.75, `${size}px artwork is too short`);
  }
});

test('browser-tab metadata gives the cache-busted glossy OW icon first authority', () => {
  const layout = fs.readFileSync(path.join(webRoot, 'src/app/layout.tsx'), 'utf8');
  const expectedIcons = [
    ['/favicon-16x16.png', '16x16'],
    ['/favicon-32x32.png', '32x32'],
    ['/favicon-48x48.png', '48x48'],
  ];

  for (const [url, sizes] of expectedIcons) {
    assert.match(layout, new RegExp(`url: '${url}', sizes: '${sizes}'`));
  }
  assert.match(layout, new RegExp(`shortcut: '${primaryFavicon.replaceAll('.', '\\.')}'`));
  assert.ok(
    layout.indexOf(primaryFavicon) < layout.indexOf('/favicon-16x16.png'),
    'the cache-busted glossy ICO must be the first explicit icon',
  );
  assert.ok(
    layout.indexOf('/favicon-16x16.png') < layout.indexOf('/icon-192.png'),
    'dedicated browser-tab sizes must precede application icons',
  );
});
