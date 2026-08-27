import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tenantDomainForRequestHostname } from '../src/lib/tenant-host.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');

test('critical application entry points are present', () => {
  const requiredFiles = [
    'src/app/layout.tsx',
    'src/app/[domain]/layout.tsx',
    'src/app/[domain]/page.tsx',
    'src/app/api/health/route.ts',
    'src/proxy.ts',
    'src/middleware.ts',
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(webRoot, relativePath)),
      true,
      `Missing required file: ${relativePath}`,
    );
  }
});

test('tracked application source contains no plaintext provider keys', () => {
  const sourceRoot = path.join(webRoot, 'src');
  const secretPattern = /sk-or-v1-[a-fA-F0-9]{64}/;

  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(entryPath);
      } else if (/\.(?:js|mjs|ts|tsx|json)$/.test(entry.name)) {
        assert.doesNotMatch(
          fs.readFileSync(entryPath, 'utf8'),
          secretPattern,
          `Plaintext OpenRouter key found in ${entryPath}`,
        );
      }
    }
  }

  scan(sourceRoot);
});

test('the web runtime has no direct external model or credential-inspection path', () => {
  const removedClients = [
    'src/lib/ai/openrouter.ts',
    'src/lib/ai/openrouter-router.ts',
  ];
  for (const relativePath of removedClients) {
    assert.equal(fs.existsSync(path.join(webRoot, relativePath)), false);
  }

  const sourceRoot = path.join(webRoot, 'src');
  const forbiddenRuntimePatterns = [
    /OPENROUTER_API_KEY/,
    /api\.openrouter\.ai/,
    /getKeyFingerprintSuffix/,
    /resolveLaneKey/,
  ];

  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(entryPath);
      } else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(entryPath, 'utf8');
        for (const pattern of forbiddenRuntimePatterns) {
          assert.doesNotMatch(source, pattern, `Retired provider path found in ${entryPath}`);
        }
      }
    }
  }

  scan(sourceRoot);
});

test('health reports only executable capabilities and dead integration stubs stay removed', () => {
  const removedAdapters = [
    'src/lib/maps/mapbox.ts',
    'src/lib/search/typesense.ts',
    'src/lib/storage/r2.ts',
  ];
  for (const relativePath of removedAdapters) {
    assert.equal(fs.existsSync(path.join(webRoot, relativePath)), false);
  }

  const healthSource = fs.readFileSync(
    path.join(webRoot, 'src/app/api/health/route.ts'),
    'utf8',
  );
  const nextConfig = fs.readFileSync(
    path.join(webRoot, 'next.config.ts'),
    'utf8',
  );

  assert.match(healthSource, /searchSource: 'AUTHORITATIVE_DATABASE'/);
  assert.match(healthSource, /evidenceIntake: 'PUBLIC_REFERENCE_ONLY'/);
  assert.doesNotMatch(
    healthSource,
    /MAPBOX|R2_|TYPESENSE|MOCK_FALLBACK|getErrorMessage/,
  );
  assert.match(nextConfig, /"connect-src 'self'"/);
  assert.doesNotMatch(nextConfig, /mapbox\.com/);
});

test('tenant rewrite logic preserves infrastructure and admin routes', () => {
  function rewriteHost(hostname, pathname) {
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api') ||
      pathname.includes('.') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/business')
    ) {
      return pathname;
    }

    return `/${tenantDomainForRequestHostname(hostname.split(':')[0])}${pathname}`;
  }

  assert.equal(rewriteHost('orderweeddc.localhost:3000', '/'), '/orderweeddc.localhost/');
  assert.equal(rewriteHost('orderweeddc.com', '/'), '/orderweeddc.localhost/');
  assert.equal(rewriteHost('deals.localhost:3000', '/retailer/123'), '/deals.localhost/retailer/123');
  assert.equal(rewriteHost('luxury.localhost:3000', '/admin'), '/admin');
  assert.equal(rewriteHost('luxury.localhost:3000', '/business/login'), '/business/login');
  assert.equal(rewriteHost('luxury.localhost:3000', '/api/health'), '/api/health');
});
