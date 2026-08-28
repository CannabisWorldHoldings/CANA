import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const require = createRequire(import.meta.url);
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const directorySearch = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/directory-search.mjs')).href
);
const daypartTheme = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/daypart-theme.mjs')).href
);
const assetRegistry = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/asset-registry.mjs')).href
);
const sponsorshipEntitlement = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/sponsorship-entitlement.mjs')).href
);
// customer-world-page.tsx imports chipLabel/publicWorldStateLabel from this
// module (added at base 9d3bd70b). The .tsx require-hook resolves '@/' aliases
// through Module._load, which does not understand tsconfig path aliases, so an
// unmapped import throws MODULE_NOT_FOUND. Load the REAL module (a pure,
// dependency-free vocabulary table) and return it below, mirroring the
// directory-search/daypart-theme mappings — an infrastructure stub, not a
// behavioral fake. (WEB_COURT_TRIAGE R5, PREEXISTING_TEST_DEFECT.)
const labelVocabulary = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/label-vocabulary.mjs')).href
);
const experienceManifest = await import(
  pathToFileURL(path.join(webRoot, 'src/lib/experience/manifest.mjs')).href
);
const originalLoad = Module._load;
const originalTsxLoader = require.extensions['.tsx'];

Module._load = function loadMarketplaceDependency(request, parent, isMain) {
  if (request === '@/lib/directory-search.mjs') return directorySearch;
  if (request === '@/lib/daypart-theme.mjs') return daypartTheme;
  if (request === '@/lib/asset-registry.mjs') return assetRegistry;
  if (request === '@/lib/sponsorship-entitlement.mjs') {
    return sponsorshipEntitlement;
  }
  if (request === '@/components/sponsorship-badge') {
    return originalLoad.call(
      this,
      path.join(webRoot, 'src/components/sponsorship-badge.tsx'),
      parent,
      isMain,
    );
  }
  if (request === '@/components/brand-wordmark') {
    return originalLoad.call(
      this,
      path.join(webRoot, 'src/components/brand-wordmark.tsx'),
      parent,
      isMain,
    );
  }
  if (request === '@/components/data-status-badge') {
    return {
      DataStatusBadge: ({ dataStatus }) =>
        React.createElement('span', null, dataStatus),
    };
  }
  if (request === '@/components/favorite-button') {
    return {
      __esModule: true,
      default: () => React.createElement('button', null, 'Favorite'),
    };
  }
  if (request === '@/components/customer-world-results') {
    return {
      __esModule: true,
      default: () => React.createElement('div', null, 'Customer results'),
    };
  }
  if (request === '@/components/rail') {
    return originalLoad.call(
      this,
      path.join(webRoot, 'src/components/rail.tsx'),
      parent,
      isMain,
    );
  }
  if (request === '@/components/smart-image') {
    return originalLoad.call(
      this,
      path.join(webRoot, 'src/components/smart-image.tsx'),
      parent,
      isMain,
    );
  }
  if (request === '@/lib/customer-world.mjs') {
    return {
      customerWorldViewHref: (_world, view) => `/?view=${view}`,
    };
  }
  if (request === '@/lib/label-vocabulary.mjs') return labelVocabulary;
  if (request === '@/lib/experience/manifest.mjs') return experienceManifest;
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.tsx'] = function compileTsx(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
test.after(() => {
  Module._load = originalLoad;
  if (originalTsxLoader) {
    require.extensions['.tsx'] = originalTsxLoader;
  } else {
    delete require.extensions['.tsx'];
  }
});

function component(relativePath) {
  return require(path.join(webRoot, 'src/components', relativePath)).default;
}

test('recovered marketplace components render exact ORDERWEEDDC branding', () => {
  const BrandWordmark = component('brand-wordmark.tsx');
  const DaypartThemeControl = component('daypart-theme-control.tsx');
  const MarketplaceHomeHero = component('marketplace-home-hero.tsx');
  const MarketplaceSearchPanel = component('marketplace-search-panel.tsx');
  const MarketplaceCategoryRail = component('marketplace-category-rail.tsx');
  const rendered = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(BrandWordmark),
      React.createElement(DaypartThemeControl),
      React.createElement(MarketplaceHomeHero, {
        activeDealCount: 3,
        articleCount: 4,
        totalResults: 12,
        verifiedCurrentCount: 7,
      }),
      React.createElement(MarketplaceSearchPanel, {
        filters: { page: 1, sort: 'TRUTH_FIRST' },
      }),
      React.createElement(MarketplaceCategoryRail),
    ),
  );

  for (const renderedText of [
    'Washington, D.C. cannabis discovery',
    'The D.C. market,',
    'without the guesswork.',
    'Explore listings',
    'Browse current offers',
    'Explore the market',
    'Browse by product format',
  ]) {
    assert.ok(rendered.includes(renderedText), `${renderedText} must render`);
  }
  assert.match(rendered, /id="directory-query"/);
  assert.match(rendered, /aria-label="Marketplace shortcuts"/);
  assert.match(rendered, /brand\/orderweeddc-on-light\.png/);
  assert.match(rendered, /brand\/orderweeddc-on-dark\.png/);
  assert.match(rendered, /Automatic theme based on local time/);
  assert.doesNotMatch(rendered, /D\.C\. cannabis, with receipts\./);
});

test('featured retailers render sponsorship only for active verified entitlement', () => {
  const MarketplaceFeaturedRetailers = component(
    'marketplace-featured-retailers.tsx',
  );
  const retailer = {
    address: '100 Test Street NW',
    city: 'Washington',
    dataSource: 'Synthetic verification fixture',
    dataStatus: 'VERIFIED_CURRENT',
    freshnessExpiresAt: null,
    hours: 'Open during test hours',
    id: 'retailer-test',
    isDemonstration: false,
    name: 'Test Retailer',
    type: 'storefront',
    verifiedAt: null,
  };
  const active = renderToStaticMarkup(
    React.createElement(MarketplaceFeaturedRetailers, {
      retailers: [{
        ...retailer,
        sponsorship: {
          affectsOrganicOrder: false,
          evidence: {
            entitlement_digest: 'fixture-entitlement',
            entry_hash: 'fixture-entry-hash',
            expires_at: '2099-01-01T00:00:00.000Z',
            funded_by_seq: 1,
            placement: 'FEATURED_CARD',
            spend_seq: 2,
          },
          label: 'Sponsored',
          reason: 'verified synthetic entitlement',
          spendSeq: 2,
          state: 'ACTIVE',
        },
      }],
    }),
  );
  const inactive = renderToStaticMarkup(
    React.createElement(MarketplaceFeaturedRetailers, {
      retailers: [{
        ...retailer,
        sponsorship: {
          affectsOrganicOrder: false,
          evidence: null,
          label: null,
          reason: 'no verified entitlement',
          spendSeq: null,
          state: 'NONE',
        },
      }],
    }),
  );

  assert.match(active, />Sponsored</);
  assert.match(active, /data-sponsorship-entry-hash="fixture-entry-hash"/);
  assert.match(active, /data-sponsorship-affects-order="false"/);
  assert.doesNotMatch(inactive, />Sponsored</);
});

test('age-gate branding remains tenant scoped', () => {
  const { AgeGateBrand } = require(
    path.join(webRoot, 'src/components/age-gate.tsx'),
  );
  const canonical = renderToStaticMarkup(
    React.createElement(AgeGateBrand, {
      displayName: 'ORDERWEEDDC',
      isCanonicalBrand: true,
    }),
  );
  const tenant = renderToStaticMarkup(
    React.createElement(AgeGateBrand, {
      displayName: 'Synthetic Tenant',
      isCanonicalBrand: false,
    }),
  );

  assert.match(canonical, /brand\/orderweeddc-on-light\.png/);
  assert.doesNotMatch(tenant, /brand\/orderweeddc-on-light\.png/);
  assert.match(tenant, />Synthetic Tenant</);
});

test('Apple-inspired D.C. homepage remains canonical-tenant scoped', () => {
  const CustomerWorldPage = component('customer-world-page.tsx');
  const illustrativeArtCapability = assetRegistry.issuePendingRightsCapability(
    'orderweeddc.localhost',
  );
  const world = {
    request: {
      customer_query: '',
      journey: 'HOME',
      market_id: 'US-DC',
      requested_view: 'list',
    },
    state: 'INPUT_REQUIRED',
    state_explanation: 'Enter a place to begin.',
  };
  const canonical = renderToStaticMarkup(
    React.createElement(CustomerWorldPage, {
      world,
      isCanonicalBrand: true,
      illustrativeArtCapability,
    }),
  );
  const canonicalProduction = renderToStaticMarkup(
    React.createElement(CustomerWorldPage, {
      world,
      isCanonicalBrand: true,
      illustrativeArtCapability: null,
    }),
  );
  const tenant = renderToStaticMarkup(
    React.createElement(CustomerWorldPage, { world, isCanonicalBrand: false }),
  );

  assert.match(canonical, /What are you/);
  assert.match(canonical, /Ask ORDERWEEDDC/);
  assert.match(canonical, /Browse by product format/);
  assert.match(canonical, /data-asset-context="category-navigation"/);
  assert.match(canonical, /marketplace\/hero-marketplace-v2\.webp/);
  assert.doesNotMatch(canonicalProduction, /marketplace\/hero-marketplace-v2\.webp/);
  assert.doesNotMatch(canonicalProduction, /art\/cat-flower\.jpg/);
  assert.doesNotMatch(tenant, /What are you/);
  assert.match(tenant, /Cannabis discovery without the guesswork\./);
  assert.match(tenant, /Customer journeys/);
});

test('SmartImage applies registered-asset policy to raw paths', () => {
  const SmartImage = component('smart-image.tsx');
  const props = {
    src: '/art/cat-flower.jpg',
    context: 'category-navigation',
    alt: '',
  };
  const rejected = renderToStaticMarkup(React.createElement(SmartImage, props));
  const forged = renderToStaticMarkup(
    React.createElement(SmartImage, { ...props, pendingRightsCapability: {} }),
  );
  const authorized = renderToStaticMarkup(
    React.createElement(SmartImage, {
      ...props,
      pendingRightsCapability: assetRegistry.issuePendingRightsCapability(
        'orderweeddc.localhost',
      ),
    }),
  );
  const attested = renderToStaticMarkup(
    React.createElement(SmartImage, {
      src: '/uploads/attested/merchant-123/storefront.avif',
      context: 'campaign',
      alt: 'Merchant storefront',
    }),
  );

  assert.equal(rejected, '');
  assert.equal(forged, '');
  assert.match(authorized, /art\/cat-flower\.jpg/);
  assert.match(attested, /uploads\/attested\/merchant-123\/storefront\.avif/);
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
