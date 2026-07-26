#!/usr/bin/env node
/**
 * ORDERWEEDDC BRAND FIDELITY COURT
 *
 * Browser Court proves layout law. This court proves the mark on screen is the
 * APPROVED RIBBON ASSET and not a typeset substitute, a wrong variant, a
 * distorted copy, or a clipped render.
 *
 * BROWSER_COURT_PASS != EXACT_LOGO_PASS. This is the second gate.
 *
 * Usage:
 *   node brand_fidelity.mjs --url <url> [--theme day|night] [--width N] [--height N] [--json out.json]
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://orderweeddc.localhost:3000/');
const WIDTH = parseInt(arg('width', '1440'), 10);
const HEIGHT = parseInt(arg('height', '900'), 10);
const THEME = arg('theme', 'day');
const JSONOUT = arg('json', null);

/** Canonical registry — the only marks permitted to render. */
const CANON = {
  'orderweeddc-ribbon-primary': {
    sha256: 'd6a4faf9b532bcda72b79bf9571140cfdfcd2c3d39301a8108acacc85929de0d',
    intrinsic: '1858x387', aspect: 1858 / 387, forTheme: 'day',
  },
  'orderweeddc-ribbon-inverse': {
    sha256: 'a426413d4c4a0f804de59882c7058f4e20d6a851b8c56d30957498e0131383c3',
    intrinsic: '1794x350', aspect: 1794 / 350, forTheme: 'night',
  },
};

const ASPECT_TOLERANCE = 0.02;   // 2% — ribbon must not stretch
const MIN_SAFE_AREA_PX = 12;     // clear space around the mark
const MIN_RENDER_WIDTH = 120;    // below this the ribbon detail is mud

const host = new URL(URL_).hostname;
const browser = await chromium.launch({
  args: host.endsWith('.localhost') ? [`--host-resolver-rules=MAP ${host} 127.0.0.1`] : [],
});
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });

// Age gate hides everything; clear it first.
const gate = await ctx.newPage();
try {
  await gate.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await gate.click("text=Yes, I'm 21 or older", { timeout: 6000 });
  await gate.waitForTimeout(900);
} catch { /* none */ }
await gate.close();

const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1600);

const found = await page.evaluate(() => {
  const out = { marks: [], suspects: [] };
  document.querySelectorAll('[data-brand-asset-id]').forEach(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.marks.push({
      assetId: el.getAttribute('data-brand-asset-id'),
      declaredSha: el.getAttribute('data-brand-source-sha256'),
      variant: el.getAttribute('data-brand-variant'),
      declaredIntrinsic: el.getAttribute('data-brand-intrinsic'),
      src: el.getAttribute('src'),
      naturalWidth: el.naturalWidth || null,
      naturalHeight: el.naturalHeight || null,
      renderW: Math.round(r.width), renderH: Math.round(r.height),
      // getBoundingClientRect() returns the ROTATED box. For a rail-mounted mark
      // that inflates height and collapses width, faking ASPECT_DRIFT. offsetWidth/
      // offsetHeight are pre-transform, so they describe the true letterform box.
      layoutW: el.offsetWidth || null, layoutH: el.offsetHeight || null,
      top: Math.round(r.top), left: Math.round(r.left),
      objectFit: cs.objectFit, opacity: cs.opacity,
      filter: cs.filter, transform: cs.transform,
      ariaLabel: el.getAttribute('aria-label'),
    });
  });
  // Typeset-substitute detection. Must catch BOTH:
  //  (a) HTML text styled as the logo, and
  //  (b) inline <svg> that typesets the name via <text>/<tspan> (the exact
  //      failure mode of the rejected wordmark.tsx — its textContent is the
  //      name repeated for the gloss layer, so never match on equality alone).
  const NAME = /^orderwee?d{1,2}c$/;
  const norm = t => (t || '').trim().toLowerCase().replace(/\s+/g, '');
  const seen = new Set();
  const consider = el => {
    if (el.closest && el.closest('[data-brand-asset-id]')) return;
    if (seen.has(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 12) return;
    const label = norm(el.getAttribute && el.getAttribute('aria-label'));
    const svgTexts = el.querySelectorAll ? [...el.querySelectorAll('text, tspan')] : [];
    const svgTypeset = svgTexts.some(t => NAME.test(norm(t.textContent)));
    const textMatch = NAME.test(norm(el.textContent));
    const labelMatch = NAME.test(label);
    if (!(svgTypeset || textMatch || labelMatch)) return;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fontEl = svgTexts.find(t => NAME.test(norm(t.textContent))) || el;
    const fcs = getComputedStyle(fontEl);
    out.suspects.push({
      tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height),
      fontFamily: fcs.fontFamily, fontStyle: fcs.fontStyle, fontSize: fcs.fontSize,
      isSvgText: el.tagName.toLowerCase() === 'svg' && svgTypeset,
      matchedVia: svgTypeset ? 'svg-text' : (textMatch ? 'text-content' : 'aria-label'),
    });
  };
  document.querySelectorAll('svg, h1, h2, span, div, a, p, [aria-label]').forEach(consider);
  return out;
});

const violations = [];

if (found.marks.length === 0) {
  violations.push('CANONICAL_ASSET_MISSING: no element carries data-brand-asset-id — the approved ribbon asset is not rendered');
}

for (const s of found.suspects) {
  violations.push(
    `TYPESET_SUBSTITUTE: <${s.tag}> typesets the brand name (via ${s.matchedVia}: ${s.fontFamily.split(',')[0]} ${s.fontStyle} ${s.fontSize}, ${s.w}x${s.h}) instead of the approved ribbon asset`
  );
}

for (const m of found.marks) {
  const canon = CANON[m.assetId];
  if (!canon) { violations.push(`UNKNOWN_ASSET_ID: "${m.assetId}" is not in the canonical registry`); continue; }

  if (m.declaredSha !== canon.sha256) {
    violations.push(`SOURCE_HASH_MISMATCH: ${m.assetId} declares ${String(m.declaredSha).slice(0, 16)}… but canonical is ${canon.sha256.slice(0, 16)}…`);
  }
  if (m.declaredIntrinsic !== canon.intrinsic) {
    violations.push(`INTRINSIC_MISMATCH: ${m.assetId} declares ${m.declaredIntrinsic}, canonical is ${canon.intrinsic}`);
  }
  // Did the bytes actually decode? naturalWidth 0 == broken image.
  if (!m.naturalWidth) {
    violations.push(`ASSET_FAILED_TO_DECODE: ${m.src} did not load (naturalWidth=0)`);
  } else {
    const nat = `${m.naturalWidth}x${m.naturalHeight}`;
    if (nat !== canon.intrinsic) violations.push(`DECODED_SIZE_MISMATCH: ${m.src} decoded ${nat}, canonical ${canon.intrinsic}`);
  }
  // Aspect drift = stretched/squashed letterform. Measure the PRE-TRANSFORM box:
  // rotation is a legitimate layout choice and must not be reported as distortion.
  const useW = m.layoutW || m.renderW, useH = m.layoutH || m.renderH;
  const rotated = !!(m.transform && m.transform !== 'none');
  if (useW > 0 && useH > 0) {
    const ar = useW / useH;
    const drift = Math.abs(ar - canon.aspect) / canon.aspect;
    if (drift > ASPECT_TOLERANCE) {
      violations.push(`ASPECT_DRIFT: ${m.assetId} letterform box ${useW}x${useH} = ${ar.toFixed(2)} vs canonical ${canon.aspect.toFixed(2)} (${(drift * 100).toFixed(1)}% drift)${rotated ? ' [measured pre-transform]' : ''}`);
    }
  }
  if (useW < MIN_RENDER_WIDTH) {
    violations.push(`RESOLUTION_TOO_LOW: ${m.assetId} letterform ${useW}px wide (min ${MIN_RENDER_WIDTH}px for ribbon detail)`);
  }
  // Variant must match theme.
  if (canon.forTheme !== THEME) {
    violations.push(`WRONG_VARIANT_FOR_THEME: ${m.variant} is for ${canon.forTheme} but page is ${THEME}`);
  }
  // Clipping / safe area.
  if (m.top < 0 || m.left < 0) violations.push(`CLIPPED: ${m.assetId} extends off-canvas (top=${m.top}, left=${m.left})`);
  else if (m.top < MIN_SAFE_AREA_PX && m.top >= 0) violations.push(`SAFE_AREA: ${m.assetId} only ${m.top}px from top (min ${MIN_SAFE_AREA_PX}px)`);
  // Unapproved colour mutation.
  if (m.filter && m.filter !== 'none') violations.push(`COLOR_MUTATION: CSS filter "${m.filter}" applied to the approved mark`);
  if (parseFloat(m.opacity) < 0.95) violations.push(`OPACITY_MUTATION: mark rendered at opacity ${m.opacity}`);
  if (m.objectFit && !['contain', 'none'].includes(m.objectFit)) violations.push(`OBJECT_FIT: "${m.objectFit}" can crop or distort the mark (use contain)`);
  if (!m.ariaLabel) violations.push(`MISSING_ARIA_LABEL: ${m.assetId} has no aria-label (accessibility + court detection)`);
}

const report = {
  url: URL_, theme: THEME, viewport: `${WIDTH}x${HEIGHT}`, checkedAt: new Date().toISOString(),
  canonicalMarksFound: found.marks.length,
  marks: found.marks, typesetSuspects: found.suspects,
  violations, verdict: violations.length === 0 ? 'PASS' : 'FAIL',
};

console.log(`\n=== BRAND FIDELITY COURT — ${THEME.toUpperCase()} ${WIDTH}x${HEIGHT} ===`);
console.log(`  canonical marks found: ${found.marks.length}`);
for (const m of found.marks) {
  const rot = m.transform && m.transform !== 'none';
  console.log(`    ${m.assetId} [${m.variant}] letterform ${m.layoutW||m.renderW}x${m.layoutH||m.renderH}${rot ? ` (rotated; screen box ${m.renderW}x${m.renderH})` : ''} · decoded ${m.naturalWidth}x${m.naturalHeight} · sha ${String(m.declaredSha).slice(0, 12)}…`);
}
if (found.suspects.length) console.log(`  typeset suspects: ${found.suspects.length}`);
console.log(`\n  VERDICT: ${report.verdict}`);
violations.forEach(v => console.log(`    ✗ ${v}`));

if (JSONOUT) { const fs = await import('node:fs'); fs.writeFileSync(JSONOUT, JSON.stringify(report, null, 2)); console.log(`\n  report -> ${JSONOUT}`); }
await browser.close();
process.exit(violations.length === 0 ? 0 : 1);
