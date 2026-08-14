// VISUAL COURT v1 — STATIC collector.
// Extracts the court inputs from SOURCE files so the laws run in CI without a
// browser. When the rendered harness runs (screenshot-harness.mjs), the same
// laws re-run on rendered values — static is the floor, not the ceiling.
import fs from 'node:fs';
import path from 'node:path';

const TAILWIND_HEIGHTS = { 'h-12': 48, 'h-16': 64, 'h-20': 80 };

function read(rootDir, relative) {
  return fs.readFileSync(path.join(rootDir, relative), 'utf8');
}

export function collectStaticInputs(rootDir) {
  const layout = read(rootDir, 'apps/web/src/app/[domain]/layout.tsx');
  const globals = read(rootDir, 'apps/web/src/app/globals.css');
  const rail = read(rootDir, 'apps/web/src/components/rail.tsx');
  const home = read(rootDir, 'apps/web/src/components/customer-world-page.tsx');
  const smartImage = read(rootDir, 'apps/web/src/components/smart-image.tsx');
  const homeRoute = read(rootDir, 'apps/web/src/app/[domain]/page.tsx');
  const assetRegistry = read(rootDir, 'apps/web/src/lib/asset-registry.mjs');

  // Header height: the height class on the header's inner container.
  const headerBlock = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
  const heightClass = Object.keys(TAILWIND_HEIGHTS).find((cls) => headerBlock.includes(`flex ${cls} `));
  const desktopPx = heightClass ? TAILWIND_HEIGHTS[heightClass] : NaN;

  // Nav census from the NAV_LINKS constant.
  const navBlock = layout.slice(layout.indexOf('const NAV_LINKS'), layout.indexOf('];', layout.indexOf('const NAV_LINKS')));
  const navLinkCount = (navBlock.match(/href:/g) ?? []).length;

  // Forbidden chrome inside the header BAR (the dashboard-regression
  // tripwire). The MobileNav invocation is excluded: its props feed the
  // full-height SHEET, which is the approved relocation home for utilities
  // like the theme control — sheet content is not bar chrome.
  const mobileNavStart = headerBlock.indexOf('<MobileNav');
  const mobileNavEnd = mobileNavStart === -1 ? -1 : headerBlock.indexOf('/>', mobileNavStart);
  const barBlock =
    mobileNavStart === -1
      ? headerBlock
      : headerBlock.slice(0, mobileNavStart) + headerBlock.slice(mobileNavEnd + 2);
  const FORBIDDEN = ['DaypartThemeControl', 'Evidence labeled', 'LifeBuoy', 'ShieldCheck'];
  const forbiddenPresent = FORBIDDEN.filter((marker) => barBlock.includes(marker));

  // Operator leakage anywhere in the consumer shell.
  const OPERATOR_MARKERS = ['operator-strip'];
  const operatorArtifacts = OPERATOR_MARKERS.filter((marker) => layout.includes(marker));

  // Token contract from globals.css.
  const tokens = {};
  for (const match of globals.matchAll(/(--owd-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!(match[1] in tokens)) tokens[match[1]] = match[2].trim();
  }
  const mediaBlocks = [...globals.matchAll(/@media[^{]+/g)].map((match) => match[0]);

  // Rail contract from the primitive source.
  const hasSnap = rail.includes('snap-x') && rail.includes('snap-mandatory');
  const hasMinRefusal = rail.includes('minItems') && rail.includes('return null');
  const paddlesPointerOnly = rail.includes('min-[1024px]:flex');

  const heroBlock = globals.slice(
    globals.indexOf('.owd-home-hero {'),
    globals.indexOf('}', globals.indexOf('.owd-home-hero {')),
  );
  const heroMinHeightPx = Number(heroBlock.match(/min-height:\s*(\d+)px/)?.[1]);
  const homeComposition = {
    usesCanonicalRail: home.includes("from '@/components/rail'") && home.includes('<Rail'),
    usesRailItem: home.includes('<RailItem'),
    smartImageCount: (home.match(/<SmartImage/g) ?? []).length,
    importsNextImage: home.includes("from 'next/image'"),
    askUsesCanonicalSearch: home.includes('Ask ORDERWEEDDC') && home.includes('action="/search"'),
    imagePolicyEnforced: smartImage.includes('resolveAssetUse')
      && smartImage.includes('pendingRightsCapability')
      && smartImage.includes('getAssetByPath')
      && smartImage.includes('assertRegisteredImage'),
    productionArtGate: homeRoute.includes('issuePendingRightsCapability(origin.hostname)')
      && assetRegistry.includes("process.env.NODE_ENV === 'production'")
      && assetRegistry.includes("hostname.endsWith('.localhost')")
      && assetRegistry.includes('PENDING_RIGHTS_CAPABILITIES.has'),
    heroMinHeightPx,
    campaignAsymmetric: globals.includes('minmax(0, 1.16fr) minmax(340px, 0.84fr)'),
  };

  return {
    headerHeight: { desktopPx },
    navCensus: { navLinkCount, forbiddenPresent },
    shellPurity: { operatorArtifacts },
    typeTokens: { tokens },
    trioBreakpoints: { mediaBlocks },
    railContract: { hasSnap, hasMinRefusal, paddlesPointerOnly },
    homeComposition,
  };
}
