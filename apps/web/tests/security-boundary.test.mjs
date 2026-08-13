import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isStaticAssetPath,
  parseAllowedRequestHost,
} from '../src/lib/host-policy.mjs';
import {
  canonicalOriginForRequestHost,
  originForRequestHost,
  tenantDomainForRequestHostname,
} from '../src/lib/tenant-host.mjs';
import {
  currentPublicRecordWhere,
  serializeStructuredData,
} from '../src/lib/seo-truth.mjs';
import {
  CONFIGURED_TENANT_HOST_PATTERN,
  isExplicitRequestHost,
  tenantRedirectPath,
  tenantRewriteRules,
} from '../src/lib/tenant-rewrite.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const AS_OF = new Date('2026-07-17T15:00:00.000Z');

test('request host policy accepts exact platform hosts and rejects authority tricks', () => {
  assert.deepEqual(parseAllowedRequestHost('orderweeddc.localhost:3000'), {
    hostname: 'orderweeddc.localhost',
    port: '3000',
    authority: 'orderweeddc.localhost:3000',
  });
  assert.deepEqual(
    parseAllowedRequestHost('CUSTOM.EXAMPLE:8443', 'custom.example'),
    {
      hostname: 'custom.example',
      port: '8443',
      authority: 'custom.example:8443',
    },
  );
  assert.deepEqual(
    parseAllowedRequestHost('custom.example:8443', 'custom.example'),
    {
      hostname: 'custom.example',
      port: '8443',
      authority: 'custom.example:8443',
    },
  );
  assert.equal(isExplicitRequestHost('custom.example'), false);
  assert.deepEqual(
    parseAllowedRequestHost(
      'staging.orderweeddc.com',
      'staging.orderweeddc.com',
    ),
    {
      hostname: 'staging.orderweeddc.com',
      port: '',
      authority: 'staging.orderweeddc.com',
    },
  );
  assert.equal(parseAllowedRequestHost('staging.orderweeddc.com', ''), null);

  for (const authority of [
    null,
    '',
    'attacker.example',
    'orderweeddc.localhost.evil',
    'orderweeddc.localhost@attacker.example',
    'orderweeddc.localhost/attacker',
    'orderweeddc.localhost:0',
    'orderweeddc.localhost:65536',
    'orderweeddc.localhost:3000, attacker.example',
  ]) {
    assert.equal(parseAllowedRequestHost(authority), null, String(authority));
  }
});

test('public canonical and local development hosts resolve to one tenant', () => {
  assert.equal(
    tenantDomainForRequestHostname('orderweeddc.com'),
    'orderweeddc.localhost',
  );
  assert.equal(
    tenantDomainForRequestHostname('orderweeddc.localhost'),
    'orderweeddc.localhost',
  );
  assert.equal(
    originForRequestHost({
      hostname: 'orderweeddc.com',
      authority: 'orderweeddc.com',
      port: '',
    }).toString(),
    'https://orderweeddc.com/',
  );
  assert.equal(
    canonicalOriginForRequestHost({
      hostname: 'wellness.localhost',
      authority: 'wellness.localhost:3000',
      port: '3000',
    }).toString(),
    'http://orderweeddc.localhost:3000/',
  );
});

test('every route receives the release security header policy', () => {
  const configSource = fs.readFileSync(
    path.join(webRoot, 'next.config.ts'),
    'utf8',
  );
  for (const required of [
    /poweredByHeader:\s*false/,
    /Content-Security-Policy/,
    /default-src 'self'/,
    /script-src-attr 'none'/,
    /object-src 'none'/,
    /base-uri 'self'/,
    /form-action 'self'/,
    /frame-ancestors 'none'/,
    /Strict-Transport-Security/,
    /X-Content-Type-Options/,
    /X-Frame-Options/,
    /Referrer-Policy/,
    /Permissions-Policy/,
    /Cross-Origin-Opener-Policy/,
  ]) {
    assert.match(configSource, required);
  }
  assert.doesNotMatch(configSource, /upgrade-insecure-requests/);
  assert.match(configSource, /private, no-store, max-age=0/);
  assert.match(configSource, /X-Robots-Tag/);
  for (const privateSurface of [
    '/admin/:path*',
    '/business/:path*',
    '/customer/:path*',
    '/wallet/:path*',
  ]) {
    assert.ok(configSource.includes(privateSurface));
  }
});

test('host validation runs before infrastructure and privileged route bypasses', () => {
  const proxySource = fs.readFileSync(
    path.join(webRoot, 'src/proxy.ts'),
    'utf8',
  );
  const hostValidation = proxySource.indexOf(
    'parseAllowedRequestHost(hostnameHeader)',
  );
  const routeBypass = proxySource.indexOf(
    "url.pathname.startsWith('/_next')",
  );
  assert.ok(hostValidation >= 0);
  assert.ok(routeBypass > hostValidation);
  assert.match(proxySource, /status:\s*421/);
  assert.match(proxySource, /X-Robots-Tag/);
  assert.match(proxySource, /noindex, nofollow, noarchive/);
  assert.match(proxySource, /isCanonicalPlatformHostname\(host\)/);
  assert.match(proxySource, /return NextResponse\.next\(\);/);
  assert.doesNotMatch(proxySource, /NextResponse\.rewrite/);
  assert.doesNotMatch(proxySource, /process\.env\.(?:PORT|HOSTNAME)/);
  assert.doesNotMatch(proxySource, /request\.(?:url|nextUrl)\.origin/);
  assert.doesNotMatch(proxySource, /['"]\/(?:delivery|near-me)['"]/);
  assert.match(proxySource, /tenantRedirectPath\(host\)/);
  assert.match(
    proxySource,
    /\/\(\(\?!_next\/static\|_next\/image\|assets\|favicon\.ico\)\.\*\)/,
  );
});

test('configured staging hosts retain their authority during relative tenant routing', () => {
  const proxySource = fs.readFileSync(
    path.join(webRoot, 'src/proxy.ts'),
    'utf8',
  );
  const adminGate = proxySource.indexOf("url.pathname.startsWith('/admin')");
  const districtGate = proxySource.indexOf("host === 'districtweed.com'");
  const weedDmvGate = proxySource.indexOf("host === 'weeddmv.com'");
  const passthrough = proxySource.indexOf("url.pathname.startsWith('/api')");
  const configuredRules = tenantRewriteRules().filter(
    (rule) => rule.has[0].value === CONFIGURED_TENANT_HOST_PATTERN,
  );

  assert.ok(adminGate >= 0);
  assert.ok(districtGate >= 0);
  assert.ok(weedDmvGate > districtGate);
  assert.ok(passthrough > weedDmvGate);
  assert.match(proxySource, /Access Gated/);
  assert.match(proxySource, /Access Isolated/);
  assert.match(proxySource, /isStaticAssetPath\(url\.pathname\)/);
  assert.match(proxySource, /isCanonicalPlatformHostname\(host\)/);
  assert.equal(configuredRules.length, 2);
  assert.deepEqual(
    configuredRules.map(({ source, destination }) => ({ source, destination })),
    [
      { source: '/', destination: '/orderweeddc.localhost' },
      {
        source: '/:path*',
        destination: '/orderweeddc.localhost/:path*',
      },
    ],
  );
  assert.doesNotMatch(proxySource, /new Headers\(request\.headers\)/);
  assert.doesNotMatch(proxySource, /requestHeaders\.set\(/);
  assert.doesNotMatch(proxySource, /request:\s*\{\s*headers:/);
  assert.doesNotMatch(proxySource, /url\.pathname\s*=\s*`\/orderweeddc\.localhost/);
  assert.doesNotMatch(proxySource, /NextResponse\.rewrite/);
});

test('SEO eligibility requires non-demo evidence inside its freshness window', () => {
  assert.deepEqual(currentPublicRecordWhere(AS_OF), {
    isDemonstration: false,
    dataStatus: 'VERIFIED_CURRENT',
    verifiedAt: { not: null, lte: AS_OF },
    freshnessExpiresAt: { gt: AS_OF },
  });
  assert.throws(() => currentPublicRecordWhere(new Date('invalid')));

  const sitemapSource = fs.readFileSync(
    path.join(webRoot, 'src/app/sitemap.ts'),
    'utf8',
  );
  const retailerSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/retailer/[id]/page.tsx'),
    'utf8',
  );
  const articleSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/education/[slug]/page.tsx'),
    'utf8',
  );
  const neighborhoodSource = fs.readFileSync(
    path.join(webRoot, 'src/app/[domain]/neighborhoods/[slug]/page.tsx'),
    'utf8',
  );
  assert.match(sitemapSource, /currentPublicRecordWhere\(asOf\)/);
  assert.match(sitemapSource, /CANONICAL_PUBLIC_HOSTNAME/);
  assert.match(sitemapSource, /CANONICAL_TENANT_DOMAIN/);
  assert.doesNotMatch(sitemapSource, /https:\/\/\$\{brand\.domain\}/);
  assert.match(retailerSource, /const indexable = isPubliclyVerified\(retailer\)/);
  assert.match(articleSource, /const indexable = isPubliclyVerified\(article\)/);
  assert.match(articleSource, /\{indexable && \(/);
  assert.match(
    neighborhoodSource,
    /robots:\s*\{\s*index:\s*false,\s*follow:\s*false,\s*nocache:\s*true\s*\}/,
  );
});

test('structured data serialization neutralizes script termination payloads', () => {
  const serialized = serializeStructuredData({
    title: '</script><script>alert(1)</script>',
    ampersand: 'A&B',
  });
  assert.doesNotMatch(serialized, /<|>|&/);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.match(serialized, /A\\u0026B/);
});

test('live ABCA acquisition remains a fixed owner-opted maintenance boundary', () => {
  const adapterSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/reality/live-abca-adapter.mjs'),
    'utf8',
  );
  assert.match(adapterSource, /CANA_LIVE_REALITY_NETWORK/);
  assert.match(adapterSource, /maps2\.dcgis\.dc\.gov/);
  assert.match(adapterSource, /redirect:\s*'manual'/);
  assert.match(adapterSource, /MAX_RESPONSE_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(adapterSource, /MAX_RUN_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  assert.doesNotMatch(adapterSource, /process\.env\.(?:SOURCE_URL|ABCA_URL|FETCH_URL)/);
  assert.doesNotMatch(adapterSource, /redirect:\s*'follow'/);
});

test('www.orderweeddc.com is an allowed host that permanently redirects to the apex', () => {
  // Parse: www must be inside the host allowlist (otherwise it would 421).
  assert.deepEqual(parseAllowedRequestHost('www.orderweeddc.com'), {
    hostname: 'www.orderweeddc.com',
    port: '',
    authority: 'www.orderweeddc.com',
  });

  // Behavior contract: the proxy consolidates www onto the canonical apex
  // with a path-and-query-preserving 308 before any tenant routing.
  const proxySource = fs.readFileSync(
    path.join(webRoot, 'src/proxy.ts'),
    'utf8',
  );
  const wwwRedirect = proxySource.indexOf("host === 'www.orderweeddc.com'");
  const acceptedTenant = proxySource.lastIndexOf(
    'return NextResponse.next();',
  );
  assert.ok(wwwRedirect >= 0, 'www redirect must exist in the proxy');
  assert.ok(
    wwwRedirect < acceptedTenant,
    'www consolidation must run before tenant routing',
  );
  assert.match(proxySource, /url\.pathname \+ url\.search, 'https:\/\/orderweeddc\.com'/);
  assert.match(proxySource, /308/);
});

test('loopback and client-supplied internal routing state cannot bypass the host gate', () => {
  assert.equal(parseAllowedRequestHost('localhost:3000'), null);
  assert.equal(parseAllowedRequestHost('127.0.0.1:3000'), null);

  const proxySource = fs.readFileSync(
    path.join(webRoot, 'src/proxy.ts'),
    'utf8',
  );
  const hostValidation = proxySource.indexOf(
    'parseAllowedRequestHost(hostnameHeader)',
  );
  assert.ok(hostValidation >= 0);
  assert.doesNotMatch(proxySource, /isLoopbackHostname/);
  assert.doesNotMatch(proxySource, /parseRequestAuthority/);
  assert.doesNotMatch(proxySource, /TENANT_REWRITE_MARKER/);
  assert.doesNotMatch(proxySource, /randomUUID/);
  assert.doesNotMatch(proxySource, /request\.headers\.get\([^)]*rewrite/i);
});

test('Next.js configuration owns host-based relative tenant routing', () => {
  const configSource = fs.readFileSync(
    path.join(webRoot, 'next.config.ts'),
    'utf8',
  );
  const helperSource = fs.readFileSync(
    path.join(webRoot, 'src/lib/tenant-rewrite.mjs'),
    'utf8',
  );
  assert.match(configSource, /async rewrites\(\)/);
  assert.match(configSource, /return tenantRewriteRules\(\)/);
  assert.match(helperSource, /type: 'host'/);
  assert.match(helperSource, /source: '\/:path\*'/);
  assert.match(helperSource, /destination: CANONICAL_TENANT_PATH/);
  assert.doesNotMatch(helperSource, /NextResponse/);
  assert.doesNotMatch(helperSource, /process\.env/);
  assert.doesNotMatch(helperSource, /requestUrl|passenger|marker/i);
  assert.doesNotMatch(helperSource, /(?:https?:)?\/\//);
  assert.equal(tenantRedirectPath('dmvweeddelivery.com'), '/delivery');
  assert.equal(tenantRedirectPath('weedneardc.com'), '/');
});

test('static-asset passthrough is extension-scoped, not any-dot: hostname paths are tenant-routed', () => {
  // Real root static files / file-routes pass through.
  for (const asset of [
    '/sitemap.xml',
    '/robots.txt',
    '/llms.txt',
    '/og-default.jpg',
    '/icon-192.png',
    '/manifest.webmanifest',
    '/fonts/inter-var-latin.woff2',
  ]) {
    assert.equal(isStaticAssetPath(asset), true, asset);
  }
  // Hostname-shaped and ordinary content paths do NOT pass through, so the
  // proxy tenant-routes them instead of exposing the [domain] route.
  for (const contentPath of [
    '/wellness.localhost',
    '/luxury.localhost',
    '/orderweeddc.com',
    '/',
    '/pricing',
    '/products',
  ]) {
    assert.equal(isStaticAssetPath(contentPath), false, contentPath);
  }

  const proxySource = fs.readFileSync(
    path.join(webRoot, 'src/proxy.ts'),
    'utf8',
  );
  assert.match(proxySource, /isStaticAssetPath\(url\.pathname\)/);
  assert.doesNotMatch(
    proxySource,
    /url\.pathname\.includes\('\.'\)/,
    'the broad any-dot passthrough must be gone',
  );
});
