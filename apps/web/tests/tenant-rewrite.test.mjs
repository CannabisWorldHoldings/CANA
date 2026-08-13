import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIGURED_TENANT_HOST_PATTERN,
  isExplicitRequestHost,
  TENANT_HOST_ROUTES,
  tenantRedirectPath,
  tenantRewriteRules,
} from '../src/lib/tenant-rewrite.mjs';

test('every tenant rewrite is host-bound and uses a relative internal destination', () => {
  const rules = tenantRewriteRules();
  assert.equal(rules.length, (TENANT_HOST_ROUTES.length + 1) * 2);

  for (const rule of rules) {
    assert.deepEqual(rule.has, [
      { type: 'host', value: rule.has[0].value },
    ]);
    assert.match(rule.destination, /^\//);
    assert.doesNotMatch(rule.destination, /:\/\//);
    assert.doesNotMatch(rule.destination, /(?:127\.0\.0\.1|\[?::1\]?|localhost):\d+/);
  }
});

test('validated configured hosts fall through to the canonical tenant without changing authority', () => {
  const rules = tenantRewriteRules();
  const configuredRules = rules.filter(
    (rule) => rule.has[0].value === CONFIGURED_TENANT_HOST_PATTERN,
  );
  assert.equal(configuredRules.length, 2);
  assert.equal(configuredRules[0].source, '/');
  assert.equal(configuredRules[0].destination, '/orderweeddc.localhost');
  assert.equal(configuredRules[1].source, '/:path*');
  assert.equal(
    configuredRules[1].destination,
    '/orderweeddc.localhost/:path*',
  );

  const matcher = new RegExp(`^${CONFIGURED_TENANT_HOST_PATTERN}$`);
  assert.equal(matcher.test('staging.orderweeddc.com'), true);
  assert.equal(matcher.test('custom.example'), true);
  for (const malformed of [
    '',
    'attacker.example:443',
    'orderweeddc.com@attacker.example',
    'orderweeddc.com/attacker',
  ]) {
    assert.equal(matcher.test(malformed), false, malformed);
  }

  const firstConfiguredRule = rules.indexOf(configuredRules[0]);
  assert.equal(firstConfiguredRule, TENANT_HOST_ROUTES.length * 2);
});

test('canonical public and local hosts route to the same tenant root without a trailing slash', () => {
  const rules = tenantRewriteRules();
  for (const host of ['orderweeddc.com', 'orderweeddc.localhost']) {
    const [root, nested] = rules.filter(
      (rule) => rule.has[0].value === host,
    );
    assert.equal(root.source, '/');
    assert.equal(root.destination, '/orderweeddc.localhost');
    assert.equal(root.destination.endsWith('/'), false);
    assert.equal(nested.source, '/:path*');
    assert.equal(
      nested.destination,
      '/orderweeddc.localhost/:path*',
    );
  }
});

test('public and local aliases retain their canonical redirect destinations', () => {
  assert.equal(
    tenantRedirectPath('dmvweeddelivery.com'),
    '/delivery',
  );
  assert.equal(
    tenantRedirectPath('dmvweeddelivery.localhost'),
    '/delivery',
  );
  assert.equal(
    tenantRedirectPath('weedneardc.com'),
    '/',
  );
  assert.equal(
    tenantRedirectPath('georgetowndispensarydc.com'),
    '/neighborhoods/georgetown',
  );
  assert.equal(
    tenantRedirectPath('dupontcircledispensarydc.com'),
    '/neighborhoods/dupont-circle',
  );
  assert.equal(
    tenantRedirectPath('capitolhilldispensarydc.com'),
    '/neighborhoods/capitol-hill',
  );
  assert.equal(
    tenantRedirectPath('ustreetdispensarydc.com'),
    '/neighborhoods/u-street-shaw',
  );
  assert.equal(
    tenantRedirectPath('navyyarddispensarydc.com'),
    '/neighborhoods/navy-yard-wharf',
  );
});

test('nested rewrite parameters and incoming queries remain available to Next.js', () => {
  const nested = tenantRewriteRules().find(
    (rule) =>
      rule.source === '/:path*' &&
      rule.has[0].value === 'orderweeddc.com',
  );
  assert.equal(nested.destination, '/orderweeddc.localhost/:path*');
  assert.equal(nested.destination.includes('?'), false);
});

test('parked and canonical-www hosts are not eligible for tenant rewrites', () => {
  const rewrittenHosts = new Set(
    tenantRewriteRules().map((rule) => rule.has[0].value),
  );
  for (const host of [
    'www.orderweeddc.com',
    'districtweed.com',
    'districtweed.localhost',
    'weeddmv.com',
    'weeddmv.localhost',
  ]) {
    assert.equal(rewrittenHosts.has(host), false, host);
  }
});

test('only statically defined hosts can pass the explicit routing boundary', () => {
  for (const host of [
    'orderweeddc.com',
    'orderweeddc.localhost',
    'dmvweeddelivery.com',
    'wellness.localhost',
    'www.orderweeddc.com',
    'districtweed.com',
  ]) {
    assert.equal(isExplicitRequestHost(host), true, host);
  }
  for (const host of ['custom.example', 'attacker.example', '', undefined]) {
    assert.equal(isExplicitRequestHost(host), false, String(host));
  }
});
