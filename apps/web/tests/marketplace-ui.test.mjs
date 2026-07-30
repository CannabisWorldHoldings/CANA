import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

function getCanonicalHomepage() {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/',
        method: 'GET',
        headers: { Host: 'orderweeddc.localhost' },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            body,
            contentType: response.headers['content-type'],
            status: response.statusCode,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('canonical homepage renders the recovered marketplace interface', async () => {
  const response = await getCanonicalHomepage();

  assert.equal(response.status, 200);
  assert.match(response.contentType ?? '', /^text\/html/);
  for (const renderedText of [
    'ORDERWEEDDC',
    'Washington, D.C. cannabis discovery',
    'The D.C. market,',
    'without the guesswork.',
    'Explore listings',
    'Browse current offers',
    'Explore the market',
    'Browse by product format',
    'Start with these labeled records',
  ]) {
    assert.ok(response.body.includes(renderedText), `${renderedText} must render`);
  }
  assert.match(response.body, /id="directory-query"/);
  assert.match(response.body, /aria-label="Marketplace shortcuts"/);
  assert.match(response.body, /brand\/orderweeddc-on-light\.png/);
  assert.match(response.body, /brand\/orderweeddc-on-dark\.png/);
  assert.match(response.body, /Automatic theme based on local time/);
  assert.doesNotMatch(response.body, /D\.C\. cannabis, with receipts\./);
});

test('marketplace sponsorship labels use verified entitlement, not intent flags', () => {
  const homeSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/page.tsx'),
    'utf8',
  );
  const featuredSource = fs.readFileSync(
    path.join(webRoot, 'src/components/marketplace-featured-retailers.tsx'),
    'utf8',
  );
  assert.match(homeSource, /sponsorshipFor\(retailer\.id\)\?\.state/);
  assert.match(featuredSource, /sponsorshipState === 'ACTIVE'/);
  assert.doesNotMatch(featuredSource, /retailer\.isSponsored/);
});

test('marketplace components and artwork are present in the canonical workspace', () => {
  for (const relativePath of [
    'src/components/marketplace-home-hero.tsx',
    'src/components/marketplace-search-panel.tsx',
    'src/components/marketplace-category-rail.tsx',
    'src/components/marketplace-featured-retailers.tsx',
    'public/marketplace/hero-marketplace-v2.webp',
    'public/marketplace/product-0.webp',
    'public/marketplace/product-1.webp',
    'public/marketplace/product-2.webp',
    'public/marketplace/product-3.webp',
  ]) {
    const file = path.join(webRoot, relativePath);
    assert.equal(fs.existsSync(file), true, `${relativePath} must exist`);
    assert.ok(fs.statSync(file).size > 500, `${relativePath} is unexpectedly small`);
  }
});
