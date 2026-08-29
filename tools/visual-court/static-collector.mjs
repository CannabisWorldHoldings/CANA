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


// A15 — public-copy vocabulary. Extract string literals from the files whose
// strings render on consumer surfaces, then scan for internal/system terms.
// Case-sensitive entries protect proper-noun system terms (capital-R Reality)
// without flagging legitimate lowercase English.
const PUBLIC_COPY_FILES = [
  'apps/web/src/components/customer-world-page.tsx',
  'apps/web/src/components/cart-drawer.tsx',
  'apps/web/src/app/[domain]/layout.tsx',
  'apps/web/src/lib/customer-world.mjs',
];
const FORBIDDEN_PUBLIC_TERMS = [
  { term: 'admitted market', cs: false },
  { term: 'admitted Reality', cs: true },
  { term: 'canonical Reality', cs: true },
  { term: 'Reality contract', cs: true },
  { term: 'Reality projection', cs: true },
  { term: 'answerability', cs: false },
  { term: 'market contract', cs: false },
  { term: 'Customer World', cs: true },
  { term: 'Directory prototype', cs: false },
  { term: 'truth path', cs: false },
  { term: 'state machine', cs: false },
  { term: 'AWAITING_VERIFICATION', cs: true },
  { term: 'staging', cs: false },
];

function collectPublicCopyViolations(rootDir) {
  const violations = [];
  for (const relative of PUBLIC_COPY_FILES) {
    const source = read(rootDir, relative);
    // Comment-stripped whole-source scan: string literals AND JSX text nodes
    // are both rendered copy; comments are not. (A16 originally scanned only
    // quoted literals and missed internal vocabulary in JSX text.)
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/([^:'"])\/\/[^\n]*$/gm, '$1 ');
    for (const { term, cs } of FORBIDDEN_PUBLIC_TERMS) {
      const haystack = cs ? stripped : stripped.toLowerCase();
      const needle = cs ? term : term.toLowerCase();
      const at = haystack.indexOf(needle);
      if (at !== -1) {
        violations.push({ file: relative, term, literal: stripped.slice(at, at + 80).replace(/\s+/g, ' ') });
      }
    }
  }
  return violations;
}

export function collectStaticInputs(rootDir) {
  const layout = read(rootDir, 'apps/web/src/app/[domain]/layout.tsx');
  const globals = read(rootDir, 'apps/web/src/app/globals.css');
  const rail = read(rootDir, 'apps/web/src/components/rail.tsx');
  const home = read(rootDir, 'apps/web/src/components/customer-world-page.tsx');
  const smartImage = read(rootDir, 'apps/web/src/components/smart-image.tsx');
  const homeRoute = read(rootDir, 'apps/web/src/app/[domain]/page.tsx');
  const experienceManifest = read(rootDir, 'apps/web/src/lib/experience/manifest.mjs');
  const assetRegistry = read(rootDir, 'apps/web/src/lib/asset-registry.mjs');
  const proxy = read(rootDir, 'apps/web/src/proxy.ts');

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
  const canonicalHomeCopy = experienceManifest.slice(
    experienceManifest.indexOf('const CANONICAL_HOME_COPY'),
    experienceManifest.indexOf('\n});', experienceManifest.indexOf('const CANONICAL_HOME_COPY')) + 4,
  );
  const homeComposition = {
    usesCanonicalRail: home.includes("from '@/components/rail'") && home.includes('<Rail'),
    usesRailItem: home.includes('<RailItem'),
    smartImageCount: (home.match(/<SmartImage/g) ?? []).length,
    importsNextImage: home.includes("from 'next/image'"),
    askUsesCanonicalSearch: home.includes('Ask ORDERWEEDDC')
      && home.includes('action={presentation.copy.action}')
      && canonicalHomeCopy.includes("action: '/search'"),
    imagePolicyEnforced: smartImage.includes('resolveAssetUse')
      && smartImage.includes('pendingRightsCapability')
      && smartImage.includes('getAssetByPath')
      && smartImage.includes('assertRegisteredImage'),
    productionArtGate: homeRoute.includes('issuePendingRightsCapability(origin.hostname)')
      && assetRegistry.includes("process.env.NODE_ENV === 'production'")
      && assetRegistry.includes("hostname.endsWith('.localhost')")
      && assetRegistry.includes('PENDING_RIGHTS_CAPABILITIES.has')
      && proxy.includes('mayServePendingAssetPath(url.pathname, host)')
      && proxy.includes('pendingAssetPlaceholderResponse'),
    heroMinHeightPx,
    campaignAsymmetric: globals.includes('minmax(0, 1.16fr) minmax(340px, 0.84fr)'),
  };

  const publicCopyViolations = collectPublicCopyViolations(rootDir);

  return {
    headerHeight: { desktopPx },
    navCensus: { navLinkCount, forbiddenPresent },
    shellPurity: { operatorArtifacts },
    typeTokens: { tokens },
    trioBreakpoints: { mediaBlocks },
    railContract: { hasSnap, hasMinRefusal, paddlesPointerOnly },
    homeComposition,
    publicCopyVocabulary: { violations: publicCopyViolations },
  };
}
