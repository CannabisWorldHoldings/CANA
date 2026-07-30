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
const originalLoad = Module._load;
const originalTsxLoader = require.extensions['.tsx'];

Module._load = function loadMarketplaceDependency(request, parent, isMain) {
  if (request === '@/lib/directory-search.mjs') return directorySearch;
  if (request === '@/lib/daypart-theme.mjs') return daypartTheme;
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
