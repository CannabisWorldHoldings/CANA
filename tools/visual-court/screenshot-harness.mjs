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
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 20_000;
const CHROMIUM_EXIT_TIMEOUT_MS = 5_000;

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
mkdirSync(OUT, { recursive: true });
const chromiumCwd = path.join(OUT, 'chromium-workdir');
mkdirSync(chromiumCwd, { recursive: true });

let chrome = null;
let ws = null;
let messageId = 0;
const pending = new Map();
let lastRequest = null;
let terminalFailure = null;
let loadWait = null;
let cleanupStarted = false;
let chromeExited = false;
let resolveChromeExit = () => {};
const chromeExit = new Promise((resolve) => { resolveChromeExit = resolve; });

function cdpFailure(failureClass, entry, extra = {}) {
  const context = entry?.context ?? lastRequest?.context ?? {};
  const detail = {
    CDP_MESSAGE_ID: entry?.id ?? lastRequest?.id ?? null,
    CDP_METHOD: entry?.method ?? lastRequest?.method ?? null,
    ROUTE: context.route ?? null,
    SCHEME: context.scheme ?? null,
    WIDTH: context.width ?? null,
    FAILURE_CLASS: failureClass,
    ELAPSED_MS: entry ? Date.now() - entry.startedAt : null,
    ...extra,
  };
  const error = new Error(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}`);
  error.cdpFailure = detail;
  return error;
}

function rejectEntry(entry, failureClass, extra = {}) {
  if (!pending.delete(entry.id)) return null;
  clearTimeout(entry.timer);
  const error = cdpFailure(failureClass, entry, extra);
  entry.reject(error);
  return error;
}

function failLifecycle(failureClass, extra = {}) {
  if (cleanupStarted) return;
  let failure = null;
  for (const entry of [...pending.values()]) {
    failure ??= rejectEntry(entry, failureClass, extra);
  }
  failure ??= cdpFailure(failureClass, lastRequest, extra);
  terminalFailure ??= failure;
  if (loadWait) loadWait.fail(terminalFailure);
}

function send(method, params = {}, context = null) {
  const entry = {
    id: ++messageId,
    method,
    context,
    startedAt: Date.now(),
    timer: null,
    resolve: null,
    reject: null,
  };
  lastRequest = entry;
  return new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
    if (terminalFailure) {
      reject(cdpFailure(terminalFailure.cdpFailure?.FAILURE_CLASS ?? 'HARNESS_ERROR', entry));
      return;
    }
    entry.timer = setTimeout(() => {
      terminalFailure ??= rejectEntry(entry, 'CDP_TIMEOUT');
    }, CDP_COMMAND_TIMEOUT_MS);
    pending.set(entry.id, entry);
    try {
      ws.send(JSON.stringify({ id: entry.id, method, params }));
    } catch (error) {
      terminalFailure ??= rejectEntry(entry, 'WEBSOCKET_ERROR', { MESSAGE: error.message });
    }
  });
}

function waitForLoad(context) {
  if (loadWait) loadWait.resolve('replaced');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (loadWait?.timer !== timer) return;
      loadWait = null;
      resolve('timeout');
    }, LOAD_TIMEOUT_MS);
    loadWait = {
      timer,
      resolve(reason) {
        if (loadWait?.timer !== timer) return;
        clearTimeout(timer);
        loadWait = null;
        resolve(reason);
      },
      fail(error) {
        if (loadWait?.timer !== timer) return;
        clearTimeout(timer);
        loadWait = null;
        resolve({ reason: 'failure', error });
      },
      context,
    };
  });
}

function signalChromium(signal) {
  if (!chrome || chromeExited) return true;
  try {
    if (process.platform === 'win32') chrome.kill(signal);
    else process.kill(-chrome.pid, signal);
    return true;
  } catch (error) {
    try {
      chrome.kill(signal);
      return true;
    } catch (fallbackError) {
      process.stderr.write(`CHROMIUM_CLEANUP_SIGNAL_FAILED ${signal} ${error.message}; ${fallbackError.message}\n`);
      return false;
    }
  }
}

async function terminateChromium() {
  if (!chrome || chromeExited) return;
  signalChromium('SIGTERM');
  const exitedAfterTerm = await Promise.race([
    chromeExit.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), CHROMIUM_EXIT_TIMEOUT_MS)),
  ]);
  if (exitedAfterTerm) return;
  signalChromium('SIGKILL');
  await Promise.race([
    chromeExit,
    new Promise((resolve) => setTimeout(resolve, CHROMIUM_EXIT_TIMEOUT_MS)),
  ]);
}

async function cleanup() {
  cleanupStarted = true;
  for (const entry of [...pending.values()]) {
    rejectEntry(entry, terminalFailure?.cdpFailure?.FAILURE_CLASS ?? 'WEBSOCKET_CLOSED');
  }
  if (loadWait) loadWait.resolve('cleanup');
  if (ws && ws.readyState < WebSocket.CLOSING) {
    try {
      ws.close();
    } catch (error) {
      process.stderr.write(`WEBSOCKET_CLEANUP_FAILED ${error.message}\n`);
    }
  }
  await terminateChromium();
}

let failure = null;
let verdict = null;

try {
  chrome = spawn(CHROMIUM, [
    '--no-sandbox',
    '--disable-gpu',
    '--headless',
    '--hide-scrollbars',
    '--remote-debugging-port=9224',
    'about:blank',
  ], { cwd: chromiumCwd, stdio: 'ignore', detached: process.platform !== 'win32' });
  chrome.once('error', (error) => failLifecycle('CHROMIUM_EXIT', { MESSAGE: error.message }));
  chrome.once('exit', (code, signal) => {
    chromeExited = true;
    resolveChromeExit();
    failLifecycle('CHROMIUM_EXIT', { EXIT_CODE: code, SIGNAL: signal });
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (terminalFailure) throw terminalFailure;

  const targets = await (await fetch('http://127.0.0.1:9224/json/list', {
    signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS),
  })).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No Chromium page target is available');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(cdpFailure('WEBSOCKET_ERROR', null, { MESSAGE: 'WebSocket open timed out' })), CDP_COMMAND_TIMEOUT_MS);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (event) => { clearTimeout(timer); reject(cdpFailure('WEBSOCKET_ERROR', null, { MESSAGE: String(event?.message ?? 'WebSocket open failed') })); };
  });
  ws.onclose = (event) => failLifecycle('WEBSOCKET_CLOSED', { CLOSE_CODE: event.code, REASON: event.reason });
  ws.onerror = (event) => failLifecycle('WEBSOCKET_ERROR', { MESSAGE: String(event?.message ?? 'unknown WebSocket error') });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      if (message.error) {
        terminalFailure ??= rejectEntry(entry, 'CDP_PROTOCOL_ERROR', { PROTOCOL_ERROR: message.error });
      } else {
        pending.delete(entry.id);
        clearTimeout(entry.timer);
        entry.resolve(message.result);
      }
      return;
    }
    if (message.method === 'Page.loadEventFired' && loadWait) loadWait.resolve('event');
    if (message.method === 'Inspector.targetCrashed' || message.method === 'Target.targetCrashed') {
      failLifecycle('TARGET_CRASH', { EVENT: message.method, PARAMS: message.params ?? null });
    }
    if (message.method === 'Inspector.detached' || message.method === 'Target.detachedFromTarget') {
      failLifecycle('TARGET_DETACH', { EVENT: message.method, PARAMS: message.params ?? null });
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Inspector.enable');

  const rendered = { measuredAt: new Date().toISOString(), baseUrl: BASE, routes: {} };
  const overflowing = new Set();
  const headerSamples = [];
  const allImgs = new Set();

  for (const route of ROUTES) {
    rendered.routes[route] = {};
    for (const scheme of ['light', 'dark']) {
      await send(
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: scheme }] },
        { route, scheme, width: null },
      );
      for (const width of WIDTHS) {
        const context = { route, scheme, width };
        await send(
          'Emulation.setDeviceMetricsOverride',
          { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 834 },
          context,
        );
        const loaded = waitForLoad(context);
        await send('Page.navigate', { url: new URL(route, BASE).href }, context);
        const loadOutcome = await loaded;
        if (loadOutcome?.error) throw loadOutcome.error;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (terminalFailure) throw terminalFailure;
        const evaluated = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, context);
        const values = JSON.parse(evaluated.result.value);
        rendered.routes[route][`${scheme}@${width}`] = values;
        if (values.overflowX) overflowing.add(`${route} ${scheme}@${width}`);
        if (values.headerPx) headerSamples.push(values.headerPx);
        values.imgs.forEach((img) => allImgs.add(img));
        const shot = await send('Page.captureScreenshot', { format: 'png' }, context);
        const dir = path.join(OUT, route.replaceAll('/', '_') || '_home', scheme);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${width}.png`), Buffer.from(shot.data, 'base64'));
        process.stdout.write(`OK ${route} ${scheme}@${width} header=${values.headerPx}\n`);
      }
    }
  }
  if (terminalFailure) throw terminalFailure;

  const { assertRegisteredImage } = await import(path.resolve('apps/web/src/lib/asset-registry.mjs'));
  const unregistered = [...allImgs].filter((img) => {
    try { assertRegisteredImage(img); return false; } catch { return true; }
  });

  const checks = [
    checkHeaderHeight({ desktopPx: Math.max(...headerSamples.filter(Boolean)) }),
    checkOverflow({ overflowingWidths: [...overflowing] }),
    checkImageRegistry({ unregistered }),
  ];
  if (terminalFailure) throw terminalFailure;
  verdict = courtVerdict(checks, 'RENDERED');
  writeFileSync(path.join(OUT, 'rendered-verdict.json'), JSON.stringify({ verdict, rendered }, null, 1));
  console.log(JSON.stringify(verdict, null, 2));
} catch (error) {
  failure = error;
  const detail = error.cdpFailure ?? {
    CDP_MESSAGE_ID: lastRequest?.id ?? null,
    CDP_METHOD: lastRequest?.method ?? null,
    ROUTE: lastRequest?.context?.route ?? null,
    SCHEME: lastRequest?.context?.scheme ?? null,
    WIDTH: lastRequest?.context?.width ?? null,
    FAILURE_CLASS: 'HARNESS_ERROR',
    ELAPSED_MS: lastRequest ? Date.now() - lastRequest.startedAt : null,
    MESSAGE: error.message,
  };
  writeFileSync(path.join(OUT, 'rendered-failure.json'), JSON.stringify(detail, null, 2));
  process.stderr.write(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}\n`);
} finally {
  await cleanup();
}

process.exitCode = failure || verdict?.verdict !== 'PASS' ? 1 : 0;
