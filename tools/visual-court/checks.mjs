// VISUAL COURT v1 — the design laws as pure, falsifiable functions.
// Two execution modes feed these same laws:
//   STATIC   — values extracted from source files (static-collector.mjs; runs in CI today)
//   RENDERED — values extracted from a running build (screenshot-harness.mjs)
// A page is not "done" because React compiles; it is done when these laws hold
// AND the human gates (C1–C5, VISUAL_QUALITY_COURT.md) pass. This file is the
// automatable half only — it never pretends to measure taste.

export const COURT_VERSION = 'visual-court-v1';

const result = (id, ok, detail) => ({ id, status: ok ? 'PASS' : 'FAIL', detail });

/** A1 — consumer chrome height: ≤49px desktop, ≤48px mobile bar. */
export function checkHeaderHeight({ desktopPx, mobilePx }) {
  const okDesktop = Number.isFinite(desktopPx) && desktopPx <= 49;
  const okMobile = mobilePx === undefined || (Number.isFinite(mobilePx) && mobilePx <= 48);
  return result('A1.header-height', okDesktop && okMobile, `desktop=${desktopPx}px mobile=${mobilePx ?? 'n/a'}px (law: ≤49 / ≤48)`);
}

/** A2 — nav census: ≤6 text links; zero forbidden element classes in the bar. */
export function checkNavCensus({ navLinkCount, forbiddenPresent }) {
  const ok = Number.isFinite(navLinkCount) && navLinkCount <= 6 && (forbiddenPresent ?? []).length === 0;
  return result('A2.nav-census', ok, `links=${navLinkCount} forbidden=[${(forbiddenPresent ?? []).join(',')}]`);
}

/** A2b — the operator world may not leak into the consumer shell. */
export function checkConsumerShellPurity({ operatorArtifacts }) {
  const ok = (operatorArtifacts ?? []).length === 0;
  return result('A2b.shell-purity', ok, ok ? 'no operator artifacts' : `leaked: ${operatorArtifacts.join(',')}`);
}

/** A4 — the token contract: required tokens exist with their lawful values. */
export function checkTypeTokens({ tokens }) {
  const REQUIRED = {
    '--owd-type-body': '17px',
    '--owd-type-nav': '13px',
    '--owd-radius-card': '20px',
    '--owd-radius-pill': '980px',
    '--owd-rail-gap': '20px',
    '--owd-header-h': '48px',
  };
  const misses = Object.entries(REQUIRED)
    .filter(([token, expected]) => (tokens ?? {})[token] !== expected)
    .map(([token, expected]) => `${token}≠${expected} (got ${(tokens ?? {})[token] ?? 'missing'})`);
  return result('A4.type-tokens', misses.length === 0, misses.length === 0 ? 'all required tokens lawful' : misses.join('; '));
}

/** A4b — the responsive trio mechanism exists at the measured boundaries. */
export function checkTrioBreakpoints({ mediaBlocks }) {
  const has1068 = (mediaBlocks ?? []).some((block) => block.includes('1068'));
  const has734 = (mediaBlocks ?? []).some((block) => block.includes('734'));
  return result('A4b.trio-breakpoints', has1068 && has734, `1068:${has1068} 734:${has734}`);
}

/** A6 — rail contract: snap, minimum refusal, pointer-only paddles. */
export function checkRailContract({ hasSnap, hasMinRefusal, paddlesPointerOnly }) {
  const ok = hasSnap === true && hasMinRefusal === true && paddlesPointerOnly === true;
  return result('A6.rail-contract', ok, `snap=${hasSnap} minRefusal=${hasMinRefusal} paddles≥1024=${paddlesPointerOnly}`);
}

/** A9 — closed chip vocabulary (delegates to the canonical set). */
export function checkChipVocabulary({ chipKindsInUse, allowedKinds }) {
  const aliens = (chipKindsInUse ?? []).filter((kind) => !(allowedKinds ?? []).includes(kind));
  return result('A9.chip-vocabulary', aliens.length === 0, aliens.length === 0 ? 'closed set holds' : `aliens: ${aliens.join(',')}`);
}

/** A14 — every consumer image is registered or attested. */
export function checkImageRegistry({ unregistered }) {
  const ok = (unregistered ?? []).length === 0;
  return result('A14.image-registry', ok, ok ? 'all imagery registered/attested' : `unregistered: ${unregistered.join(',')}`);
}

/** A15 — P1 home must consume P0 and preserve the production image gate. */
export function checkHomeComposition({
  usesCanonicalRail,
  usesRailItem,
  smartImageCount,
  importsNextImage,
  askUsesCanonicalSearch,
  imagePolicyEnforced,
  productionArtGate,
  heroMinHeightPx,
  campaignAsymmetric,
}) {
  const ok = usesCanonicalRail === true
    && usesRailItem === true
    && Number.isFinite(smartImageCount)
    && smartImageCount >= 5
    && importsNextImage === false
    && askUsesCanonicalSearch === true
    && imagePolicyEnforced === true
    && productionArtGate === true
    && Number.isFinite(heroMinHeightPx)
    && heroMinHeightPx >= 630
    && campaignAsymmetric === true;
  return result(
    'A15.p1-home-composition',
    ok,
    `rail=${usesCanonicalRail}/${usesRailItem} smartImages=${smartImageCount} nextImage=${importsNextImage} ask=${askUsesCanonicalSearch} policy=${imagePolicyEnforced} productionGate=${productionArtGate} hero=${heroMinHeightPx}px asymmetric=${campaignAsymmetric}`,
  );
}

/** A7 — no horizontal document overflow at any mandated width (RENDERED mode). */
export function checkOverflow({ overflowingWidths }) {
  const ok = (overflowingWidths ?? []).length === 0;
  return result('A7.overflow', ok, ok ? 'no overflow at mandated widths' : `overflow at: ${overflowingWidths.join(',')}`);
}

/** Aggregate a verdict receipt. */
/** A15 — consumer surfaces never leak internal/system vocabulary (owner
 *  correction compiled to law: public UI must read as product, not engine).
 *  Violations arrive from the collector as { file, term, literal } rows. */
export function checkPublicCopyVocabulary({ violations }) {
  const ok = (violations ?? []).length === 0;
  return result('A16.public-copy-vocabulary', ok, ok
    ? 'no internal vocabulary in public copy'
    : (violations ?? []).slice(0, 6).map((v) => `${v.file}: "${v.term}"`).join('; '));
}

export function courtVerdict(checks, mode) {
  const failures = checks.filter((check) => check.status === 'FAIL');
  return {
    court: COURT_VERSION,
    mode,
    checkedAt: new Date().toISOString(),
    checks,
    failures: failures.map((check) => check.id),
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    note: 'Automatable laws only. Human gates C1–C5 (VISUAL_QUALITY_COURT.md) are not represented here and cannot be skipped.',
  };
}
