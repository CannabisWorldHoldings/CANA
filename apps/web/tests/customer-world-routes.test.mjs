import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function source(relativePath) {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8');
}

test('home, search, delivery, dispensaries, and merchant profile consume one customer world resolver', () => {
  const routes = [
    ['src/app/[domain]/page.tsx', "journey: 'HOME'"],
    ['src/app/[domain]/search/page.tsx', "journey: 'SEARCH'"],
    ['src/app/[domain]/delivery/page.tsx', "journey: 'DELIVERY'"],
    ['src/app/[domain]/dispensaries/page.tsx', "journey: 'DISPENSARIES'"],
    ['src/app/[domain]/merchant/[id]/page.tsx', 'loadCustomerMerchantProfile'],
  ];
  for (const [file, journey] of routes) {
    const route = source(file);
    assert.match(route, /loadCustomer(?:World|MerchantProfile)/);
    assert.ok(route.includes(journey), `${file} must declare ${journey}`);
    assert.doesNotMatch(route, /prisma\.retailer|directoryRetailerWhere|\?type=delivery/);
  }
});

test('delivery and dispensaries are separate navigable journeys, never query aliases', () => {
  const layout = source('src/app/[domain]/layout.tsx');
  const rail = source('src/components/marketplace-category-rail.tsx');
  for (const code of [layout, rail]) {
    assert.match(code, /href:\s*['"]\/delivery['"]/);
    assert.match(code, /href:\s*['"]\/dispensaries['"]/);
    assert.doesNotMatch(code, /\?type=delivery/);
  }
});

test('customer routes include honest loading and unexpected-error boundaries', () => {
  const loading = source('src/app/[domain]/loading.tsx');
  const error = source('src/app/[domain]/error.tsx');
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading verified customer discovery/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Verified customer discovery is temporarily unavailable/);
});

test('the functional slice does not add Apple visual canon or CSS changes', () => {
  const routes = source('src/components/customer-world-page.tsx');
  assert.doesNotMatch(routes, /apple|frosted|glass|backdrop-blur/i);
});
