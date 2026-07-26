#!/usr/bin/env node
/**
 * ORDERWEEDDC Brand Prominence + Theme Law measurement.
 *
 * Turns owner design objections into numbers so a UI candidate is judged by
 * measurement, not opinion. Exits non-zero when a binding law is violated.
 *
 * Usage:
 *   node brand_prominence.mjs --url http://orderweeddc.localhost:3000/ \
 *        [--width 1440] [--height 900] [--theme day|night] [--json out.json]
 */
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_    = arg('url', 'http://orderweeddc.localhost:3000/');
const WIDTH   = parseInt(arg('width', '1440'), 10);
const HEIGHT  = parseInt(arg('height', '900'), 10);
const THEME   = arg('theme', 'day');
const JSONOUT = arg('json', null);

// Binding law from the ORDERWEEDDC Visual Constitution.
const LAW = {
  dayCanvas: 'rgb(255, 255, 255)',
  nightCanvas: 'rgb(0, 0, 0)',
  maxHeadlineToBrandRatio: 3.0,   // slogan must not dwarf the brand
  minBrandViewportPct: 1.0,       // brand must be a real presence
  maxConsoleErrors: 0,
  maxFailedRequests: 0,
};

const host = new URL(URL_).hostname;
const browser = await chromium.launch({
  args: host.endsWith('.localhost') ? [`--host-resolver-rules=MAP ${host} 127.0.0.1`] : [],
});
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });

// Age gate blocks all measurement; clear it in a throwaway page first.
const gate = await ctx.newPage();
try {
  await gate.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await gate.click("text=Yes, I'm 21 or older", { timeout: 6000 });
  await gate.waitForTimeout(1000);
} catch { /* no gate present */ }
await gate.close();

const page = await ctx.newPage();
const consoleErrors = [], failedRequests = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

const t0 = Date.now();
await page.goto(URL_, { waitUntil: 'load', timeout: 45000 });
const wallLoadMs = Date.now() - t0;
await page.waitForTimeout(1800);

const m = await page.evaluate(() => {
  const area = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height), top: Math.round(r.top) }; };
  const out = { viewportArea: window.innerWidth * window.innerHeight };

  // Brand detection: aria-label is the reliable signal (the wordmark is an
  // inline SVG that may live outside <header>, e.g. in a fixed rail).
  const brand =
    document.querySelector('[aria-label="orderweeddc" i], [aria-label*="orderweed" i]') ||
    document.querySelector('header a[href="/"], header [class*="logo"], header svg, header img');
  if (brand) {
    // For rotated marks getBoundingClientRect() gives the rotated box, which is
    // what the eye actually sees — that is the correct measure here.
    out.brand = area(brand);
    out.brandSource = brand.getAttribute('aria-label') ? 'aria-label' : 'header-heuristic';
  }
  const h1 = document.querySelector('h1');
  if (h1) { out.headline = { ...area(h1), text: h1.innerText.slice(0, 80), fontSize: getComputedStyle(h1).fontSize, color: getComputedStyle(h1).color }; }

  // The painted canvas is often a <main> wrapper, not <body>. Measure both;
  // the deepest opaque ancestor of the hero is what the user actually sees.
  out.bodyBg = getComputedStyle(document.body).backgroundColor;
  let paint = null, el = document.querySelector('h1');
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && !/rgba\(0, 0, 0, 0\)/.test(bg)) { paint = { tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,80), bg }; break; }
    el = el.parentElement;
  }
  out.paintedCanvas = paint;

  // Analytics/dashboard card holding prime hero space is an anti-pattern.
  const card = [...document.querySelectorAll('div,section,aside')].find(e => {
    const r = e.getBoundingClientRect();
    return /directory snapshot|what the evidence supports/i.test(e.innerText || '') && r.width > 200 && r.width < 900 && r.top < window.innerHeight;
  });
  if (card) out.dashboardCardInHero = area(card);

  const freq = {};
  [...document.querySelectorAll('*')].slice(0, 1500).forEach(e => {
    const cs = getComputedStyle(e);
    [cs.color, cs.backgroundColor].forEach(c => { if (c && !/rgba\(0, 0, 0, 0\)/.test(c)) freq[c] = (freq[c] || 0) + 1; });
  });
  out.topColors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const n = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  out.perf = {
    ttfbMs: Math.round(n.responseStart || 0),
    domInteractiveMs: Math.round(n.domInteractive || 0),
    resourceCount: res.length,
    transferKB: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
  };
  return out;
});

const violations = [];
const expectedCanvas = THEME === 'night' ? LAW.nightCanvas : LAW.dayCanvas;
const painted = m.paintedCanvas?.bg || m.bodyBg;
if (painted !== expectedCanvas) violations.push(`CANVAS: ${THEME} painted canvas is ${painted}${m.paintedCanvas ? ` (from <${m.paintedCanvas.tag} class="${m.paintedCanvas.cls}">)` : ''}, law requires ${expectedCanvas}`);

let ratio = null, brandPct = null;
if (!m.brand) {
  // Fail loudly: an undetectable brand is either absent (a real violation) or
  // unlabelled (an accessibility violation). Never skip the gate silently.
  violations.push('BRAND_NOT_FOUND: no element with aria-label "orderweeddc" and no header logo — brand absent or unlabelled');
} else {
  brandPct = +((m.brand.area / m.viewportArea) * 100).toFixed(2);
  if (brandPct < LAW.minBrandViewportPct) violations.push(`BRAND_TOO_SMALL: brand is ${brandPct}% of viewport (min ${LAW.minBrandViewportPct}%)`);
  if (m.headline) {
    ratio = +(m.headline.area / m.brand.area).toFixed(1);
    if (ratio > LAW.maxHeadlineToBrandRatio) violations.push(`BRAND_DWARFED: headline is ${ratio}x brand area (max ${LAW.maxHeadlineToBrandRatio}x)`);
  }
}
if (m.dashboardCardInHero) violations.push(`DASHBOARD_IN_HERO: analytics card ${m.dashboardCardInHero.w}x${m.dashboardCardInHero.h} occupies prime hero space`);
if (consoleErrors.length > LAW.maxConsoleErrors) violations.push(`CONSOLE_ERRORS: ${consoleErrors.length}`);
if (failedRequests.length > LAW.maxFailedRequests) violations.push(`FAILED_REQUESTS: ${failedRequests.length}`);

const report = {
  url: URL_, theme: THEME, viewport: `${WIDTH}x${HEIGHT}`, measuredAt: new Date().toISOString(),
  brand: m.brand || null, brandSource: m.brandSource || null, headline: m.headline || null,
  headlineToBrandRatio: ratio, brandViewportPct: brandPct,
  bodyBackground: m.bodyBg, paintedCanvas: m.paintedCanvas || null, expectedCanvas,
  dashboardCardInHero: m.dashboardCardInHero || null,
  topColors: m.topColors,
  perf: { ...m.perf, wallLoadMs },
  consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
  failedRequests: [...new Set(failedRequests)].slice(0, 10),
  violations, verdict: violations.length === 0 ? 'PASS' : 'FAIL',
};

console.log(`\n=== ORDERWEEDDC BROWSER COURT — ${THEME.toUpperCase()} ${WIDTH}x${HEIGHT} ===`);
if (m.brand)    console.log(`  brand:    ${m.brand.w}x${m.brand.h} = ${m.brand.area.toLocaleString()}px² (${brandPct}% of viewport) [via ${m.brandSource}]`);
else            console.log('  brand:    NOT DETECTED');
if (m.headline) console.log(`  headline: ${m.headline.w}x${m.headline.h} = ${m.headline.area.toLocaleString()}px² @ ${m.headline.fontSize}`);
else            console.log('  headline: none (brand-only hero)');
if (ratio)      console.log(`  headline/brand ratio: ${ratio}x  (law: <= ${LAW.maxHeadlineToBrandRatio}x)`);
console.log(`  body background:   ${m.bodyBg}`);
console.log(`  painted canvas:    ${painted}${m.paintedCanvas ? `  <- <${m.paintedCanvas.tag} class="${m.paintedCanvas.cls}">` : ''}  (law: ${expectedCanvas})`);
console.log(`  perf: TTFB ${m.perf.ttfbMs}ms · domInteractive ${m.perf.domInteractiveMs}ms · ${m.perf.resourceCount} files / ${m.perf.transferKB}KB`);
console.log(`  console errors: ${consoleErrors.length} · failed requests: ${failedRequests.length}`);
console.log(`\n  VERDICT: ${report.verdict}`);
violations.forEach(v => console.log(`    ✗ ${v}`));

if (JSONOUT) { const fs = await import('node:fs'); fs.writeFileSync(JSONOUT, JSON.stringify(report, null, 2)); console.log(`\n  report -> ${JSONOUT}`); }
await browser.close();
process.exit(violations.length === 0 ? 0 : 1);
