#!/usr/bin/env node
// VISUAL COURT v1 — RENDERED harness (screenshots + rendered-law inputs).
// Drives a running build over raw Chrome DevTools Protocol using Node's
// native WebSocket — zero npm dependencies beyond a Chromium binary.
//
// Usage:
//   node tools/visual-court/screenshot-harness.mjs \
//     --base-url http://127.0.0.1:3000 \
//     --chromium /path/to/headless_shell \
//     --out .cana-local/visual-court \
//     [--routes /,/dispensaries,/products]
//
// Per route × width (1728,1512,1440,1280,1024,834,768,430,393,375,360)
// × scheme (light via emulated prefers-color-scheme light, dark via dark):
//   - viewport screenshot (PNG) into <out>/<route>/<scheme>/<width>.png
//   - rendered inputs: header height (getBoundingClientRect), body font-size,
//     document overflow, chip text census, <img> src census
// Then the SAME court laws from checks.mjs judge the rendered values and a
// verdict receipt lands at <out>/rendered-verdict.json.
//
// PREREQUISITES (honest): a running `next build && next start` (or dev) of
// apps/web and a Chromium binary. In environments without npm-registry
// access this cannot self-run; execute it wherever the app builds.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { checkHeaderHeight, checkImageRegistry, checkOverflow, courtVerdict } from './checks.mjs';

const WIDTHS = [1728, 1512, 1440, 1280, 1024, 834, 768, 430, 393, 375, 360];
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => (arg.startsWith('--') ? [arg.slice(2), all[index + 1]] : null)).filter(Boolean),
);
const BASE = args['base-url'];
const CHROMIUM = args.chromium;
const OUT = path.resolve(args.out ?? '.cana-local/visual-court');
const ROUTES = (args.routes ?? '/').split(',');

if (!BASE || !CHROMIUM) {
  console.error('REFUSED: --base-url and --chromium are required. This harness needs a running build; see file header.');
  process.exit(2);
}

const MEASURE = `(() => {
  const header = document.querySelector('header');
  const bar = header ? header.querySelector('div') : null;
  const chipTexts = [...document.querySelectorAll('.tint-chip')].map((el) => el.textContent.trim());
  const imgs = [...document.images].map((img) => new URL(img.currentSrc || img.src, location.href).pathname);
  return JSON.stringify({
    headerPx: bar ? Math.round(bar.getBoundingClientRect().height * 10) / 10 : null,
    bodyFontPx: getComputedStyle(document.body).fontSize,
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    chipTexts,
    imgs,
  });
})()`;

const { spawn } = await import('node:child_process');
const chrome = spawn(CHROMIUM, ['--no-sandbox', '--disable-gpu', '--headless', '--hide-scrollbars', '--remote-debugging-port=9224', 'about:blank'], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 3000));

const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
const page = targets.find((target) => target.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
let loadResolver = null;
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); entry(message.result); }
  else if (message.method === 'Page.loadEventFired' && loadResolver) loadResolver();
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++messageId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable');
await send('Runtime.enable');

const rendered = { measuredAt: new Date().toISOString(), baseUrl: BASE, routes: {} };
const overflowing = new Set();
const headerSamples = [];
const allImgs = new Set();

for (const route of ROUTES) {
  rendered.routes[route] = {};
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    for (const width of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 834 });
      const loaded = new Promise((resolve) => { loadResolver = resolve; setTimeout(resolve, 20000); });
      await send('Page.navigate', { url: new URL(route, BASE).href });
      await loaded;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const evaluated = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const values = JSON.parse(evaluated.result.value);
      rendered.routes[route][`${scheme}@${width}`] = values;
      if (values.overflowX) overflowing.add(`${route} ${scheme}@${width}`);
      if (values.headerPx) headerSamples.push(values.headerPx);
      values.imgs.forEach((img) => allImgs.add(img));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const dir = path.join(OUT, route.replaceAll('/', '_') || '_home', scheme);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${width}.png`), Buffer.from(shot.data, 'base64'));
      process.stdout.write(`OK ${route} ${scheme}@${width} header=${values.headerPx}\n`);
    }
  }
}

const { assertRegisteredImage } = await import(path.resolve('apps/web/src/lib/asset-registry.mjs'));
const unregistered = [...allImgs].filter((img) => {
  try { assertRegisteredImage(img); return false; } catch { return true; }
});

const checks = [
  checkHeaderHeight({ desktopPx: Math.max(...headerSamples.filter(Boolean)) }),
  checkOverflow({ overflowingWidths: [...overflowing] }),
  checkImageRegistry({ unregistered }),
];
const verdict = courtVerdict(checks, 'RENDERED');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'rendered-verdict.json'), JSON.stringify({ verdict, rendered }, null, 1));
console.log(JSON.stringify(verdict, null, 2));
chrome.kill();
process.exitCode = verdict.verdict === 'PASS' ? 0 : 1;
