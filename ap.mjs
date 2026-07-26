#!/usr/bin/env node
/**
 * ORDERWEEDDC ACCESSIBILITY + PERFORMANCE COURT
 *
 * Browser Court proves layout law. Brand Fidelity Court proves the mark is the
 * approved asset. Neither says anything about whether the page is USABLE by
 * someone on a keyboard or a screen reader, or whether it is fast.
 *
 * BROWSER_PASS != BRAND_PASS != A11Y_PASS != PERF_PASS != OWNER_APPROVAL.
 *
 * Deliberately dependency-free: axe-core would be a supply-chain install that
 * has not passed the skill security court. These checks are hand-written
 * against the WCAG rules that actually bite on this product, and every one is
 * derived from the live DOM rather than from source inspection.
 *
 * Usage:
 *   node a11y_perf.mjs --url <url> [--theme day|night] [--width N] [--height N] [--json out.json]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://orderweeddc.localhost:3000/');
const WIDTH = parseInt(arg('width', '1440'), 10);
const HEIGHT = parseInt(arg('height', '900'), 10);
const THEME = arg('theme', 'day');
const JSONOUT = arg('json', null);

/** Performance budget. Regressions past the recorded baseline are failures. */
const BUDGET = {
  ttfbMs: 400,
  domInteractiveMs: 1500,
  transferKB: 900,
  cls: 0.1,          // Core Web Vitals "good"
  longTaskMs: 250,
};
/** WCAG 2.2 AA contrast minimums. */
const CONTRAST = { normal: 4.5, large: 3.0 };
const MIN_TAP_PX = 24; // WCAG 2.2 AA target size (minimum)

// ---- relative luminance / contrast, per WCAG definition
const srgb = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parseRGB = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
  const p = m[1].split(',').map((n) => parseFloat(n)); return p.length >= 3 ? [p[0], p[1], p[2], p[3] ?? 1] : null; };

const host = new URL(URL_).hostname;
const browser = await chromium.launch({
  args: host.endsWith('.localhost') ? [`--host-resolver-rules=MAP ${host} 127.0.0.1`] : [],
});
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });

// Age gate hides the page; measuring it would measure the modal.
const gate = await ctx.newPage();
try {
  await gate.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await gate.click("text=Yes, I'm 21 or older", { timeout: 6000 });
  await gate.waitForTimeout(900);
} catch { /* no gate */ }
await gate.close();

const page = await ctx.newPage();
const consoleErrors = [], failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

// Observe layout shift and long tasks BEFORE navigation completes.
await page.addInitScript(() => {
  window.__cls = 0; window.__longTasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
});

await page.goto(URL_, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2200);

const audit = await page.evaluate(({ MIN_TAP_PX }) => {
  const out = { a11y: {}, perf: {}, meta: {} };
  const visible = (el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01 && r.width > 0 && r.height > 0;
  };

  // --- Document-level
  out.a11y.lang = document.documentElement.getAttribute('lang');
  out.a11y.title = document.title;
  out.meta.viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null;

  // --- Headings: exactly one h1, no skipped levels
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  out.a11y.h1Count = hs.filter((h) => h.tagName === 'H1').length;
  let skips = [];
  let prev = 0;
  for (const h of hs) { const lvl = +h.tagName[1]; if (prev && lvl > prev + 1) skips.push(`${prev}->${lvl}`); prev = lvl; }
  out.a11y.headingSkips = skips;

  // --- Images need alt (empty alt is valid for decorative)
  out.a11y.imagesMissingAlt = [...document.querySelectorAll('img')].filter(visible)
    .filter((i) => i.getAttribute('alt') === null).map((i) => i.getAttribute('src')?.slice(0, 70));

  // --- Interactive elements need an accessible name
  const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')].filter(visible);
  out.a11y.unnamedControls = interactive.filter((el) => {
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      || (el.labels?.length ? [...el.labels].map((l) => l.textContent).join(' ').trim() : '')
      || el.getAttribute('placeholder') || '';
    return name.length === 0;
  }).map((el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`);

  // --- Form controls need a programmatic label
  out.a11y.unlabeledInputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible)
    .filter((el) => !(el.labels?.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
    .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('type') || 'text'}]`);

  // --- Tap targets (WCAG 2.2 AA)
  out.a11y.smallTargets = interactive.map((el) => { const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height),
               label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) }; })
    .filter((t) => t.w > 0 && t.h > 0 && (t.w < MIN_TAP_PX || t.h < MIN_TAP_PX));

  // --- Text contrast: sample real rendered text against its painted backdrop
  const bgOf = (el) => { let n = el;
    while (n && n !== document.documentElement) { const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)/.test(bg)) return bg; n = n.parentElement; }
    return getComputedStyle(document.body).backgroundColor; };
  const textNodes = [...document.querySelectorAll('p,span,a,button,h1,h2,h3,h4,li,td,label,div')]
    .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim().length > 1)
    .slice(0, 220);
  out.a11y.contrastSamples = textNodes.map((el) => { const cs = getComputedStyle(el);
    return { fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: cs.fontWeight,
             text: (el.textContent || '').trim().slice(0, 34) }; });

  // --- Focus visibility: does :focus-visible produce any visual change?
  const focusables = interactive.slice(0, 12);
  out.a11y.focusableCount = focusables.length;
  out.a11y.noFocusIndicator = [];
  for (const el of focusables) {
    const before = getComputedStyle(el);
    const b = { outline: before.outlineStyle + before.outlineWidth, shadow: before.boxShadow, border: before.borderColor };
    el.focus();
    const after = getComputedStyle(el);
    const changed = (after.outlineStyle + after.outlineWidth) !== b.outline || after.boxShadow !== b.shadow || after.borderColor !== b.border;
    if (!changed) out.a11y.noFocusIndicator.push(`${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 18)}`);
    el.blur();
  }

  // --- Landmarks
  out.a11y.hasMain = !!document.querySelector('main, [role="main"]');
  out.a11y.hasNav = !!document.querySelector('nav, [role="navigation"]');

  // --- Performance
  const n = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  out.perf = {
    ttfbMs: Math.round(n.responseStart || 0),
    domInteractiveMs: Math.round(n.domInteractive || 0),
    loadMs: Math.round(n.loadEventEnd || 0),
    resourceCount: res.length,
    transferKB: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
    cls: Math.round((window.__cls || 0) * 1000) / 1000,
    longTasks: window.__longTasks || [],
    maxLongTaskMs: (window.__longTasks || []).length ? Math.max(...window.__longTasks) : 0,
  };
  return out;
}, { MIN_TAP_PX });

// ---- adjudicate
const v = [];
const a = audit.a11y, p = audit.perf;

if (!a.lang) v.push('A11Y_NO_LANG: <html> has no lang attribute — screen readers cannot select a pronunciation');
if (!a.title || a.title.trim().length < 3) v.push('A11Y_NO_TITLE: document title is missing or trivial');
if (a.h1Count === 0) v.push('A11Y_NO_H1: no visible h1 — the page has no announced main heading');
if (a.h1Count > 1) v.push(`A11Y_MULTIPLE_H1: ${a.h1Count} h1 elements`);
if (a.headingSkips.length) v.push(`A11Y_HEADING_SKIP: level jumps ${a.headingSkips.join(', ')}`);
if (a.imagesMissingAlt.length) v.push(`A11Y_IMG_NO_ALT: ${a.imagesMissingAlt.length} image(s) without an alt attribute`);
if (a.unnamedControls.length) v.push(`A11Y_UNNAMED_CONTROL: ${a.unnamedControls.length} interactive element(s) with no accessible name (${a.unnamedControls.slice(0, 3).join(', ')})`);
if (a.unlabeledInputs.length) v.push(`A11Y_UNLABELED_INPUT: ${a.unlabeledInputs.length} form control(s) without a label (${a.unlabeledInputs.slice(0, 3).join(', ')})`);
if (!a.hasMain) v.push('A11Y_NO_MAIN_LANDMARK: no <main> landmark for skip navigation');
if (a.noFocusIndicator.length) v.push(`A11Y_NO_FOCUS_INDICATOR: ${a.noFocusIndicator.length} focusable element(s) show no visible focus change`);
if (a.smallTargets.length) v.push(`A11Y_SMALL_TAP_TARGET: ${a.smallTargets.length} target(s) below ${MIN_TAP_PX}px (${a.smallTargets.slice(0, 3).map((t) => `${t.tag} ${t.w}x${t.h}`).join(', ')})`);

// contrast
const failures = [];
for (const s of a.contrastSamples) {
  const fg = parseRGB(s.fg), bg = parseRGB(s.bg);
  if (!fg || !bg || fg[3] === 0) continue;
  const large = s.size >= 24 || (s.size >= 18.66 && +s.weight >= 700);
  const need = large ? CONTRAST.large : CONTRAST.normal;
  const got = ratio(fg, bg);
  if (got < need) failures.push({ text: s.text, ratio: Math.round(got * 100) / 100, need, size: s.size });
}
if (failures.length) {
  v.push(`A11Y_CONTRAST: ${failures.length} text sample(s) below WCAG AA (worst ${Math.min(...failures.map((f) => f.ratio))}:1 — "${failures.sort((x, y) => x.ratio - y.ratio)[0].text}")`);
}

if (p.ttfbMs > BUDGET.ttfbMs) v.push(`PERF_TTFB: ${p.ttfbMs}ms exceeds ${BUDGET.ttfbMs}ms`);
if (p.domInteractiveMs > BUDGET.domInteractiveMs) v.push(`PERF_DOM_INTERACTIVE: ${p.domInteractiveMs}ms exceeds ${BUDGET.domInteractiveMs}ms`);
if (p.transferKB > BUDGET.transferKB) v.push(`PERF_TRANSFER: ${p.transferKB}KB exceeds ${BUDGET.transferKB}KB`);
if (p.cls > BUDGET.cls) v.push(`PERF_CLS: cumulative layout shift ${p.cls} exceeds ${BUDGET.cls}`);
if (p.maxLongTaskMs > BUDGET.longTaskMs) v.push(`PERF_LONG_TASK: ${p.maxLongTaskMs}ms blocks the main thread (budget ${BUDGET.longTaskMs}ms)`);
if (consoleErrors.length) v.push(`CONSOLE_ERRORS: ${consoleErrors.length}`);
if (failedRequests.length) v.push(`FAILED_REQUESTS: ${failedRequests.length}`);

const report = {
  url: URL_, theme: THEME, viewport: `${WIDTH}x${HEIGHT}`, checkedAt: new Date().toISOString(),
  accessibility: { ...a, contrastFailures: failures.slice(0, 10), contrastSamples: a.contrastSamples.length },
  performance: p, budget: BUDGET,
  consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
  failedRequests: [...new Set(failedRequests)].slice(0, 8),
  violations: v, verdict: v.length === 0 ? 'PASS' : 'FAIL',
};
delete report.accessibility.contrastSamples;

console.log(`\n=== A11Y + PERFORMANCE COURT — ${THEME.toUpperCase()} ${WIDTH}x${HEIGHT} ===`);
console.log(`  lang=${a.lang ?? 'MISSING'}  h1=${a.h1Count}  main=${a.hasMain}  focusables=${a.focusableCount}`);
console.log(`  contrast: ${a.contrastSamples.length} samples, ${failures.length} below AA`);
console.log(`  tap targets below ${MIN_TAP_PX}px: ${a.smallTargets.length}`);
console.log(`  perf: TTFB ${p.ttfbMs}ms · domInteractive ${p.domInteractiveMs}ms · ${p.resourceCount} files / ${p.transferKB}KB · CLS ${p.cls} · maxLongTask ${p.maxLongTaskMs}ms`);
console.log(`  console errors ${consoleErrors.length} · failed requests ${failedRequests.length}`);
console.log(`\n  VERDICT: ${report.verdict}`);
v.forEach((x) => console.log(`    ✗ ${x}`));

if (JSONOUT) { fs.writeFileSync(JSONOUT, JSON.stringify(report, null, 2)); console.log(`\n  report -> ${JSONOUT}`); }
await browser.close();
process.exit(v.length === 0 ? 0 : 1);
