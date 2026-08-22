#!/usr/bin/env node
// VISUAL COURT v1 — RENDERED harness (screenshots + rendered-law inputs).
// Drives a running build over raw Chrome DevTools Protocol using Node's
// native WebSocket — zero npm dependencies beyond a Chromium binary.
//
// Usage:
//   node tools/visual-court/screenshot-harness.mjs \
//     --base-url http://127.0.0.1:3000 \
//     --chromium /path/to/headless_shell \
//     --out /tmp/cana-visual-court \
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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkHeaderHeight, checkImageRegistry, checkOverflow, courtVerdict } from './checks.mjs';

const WIDTHS = [1728, 1512, 1440, 1280, 1024, 834, 768, 430, 393, 375, 360];
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => (arg.startsWith('--') ? [arg.slice(2), all[index + 1]] : null)).filter(Boolean),
);
const BASE = args['base-url'];
const CHROMIUM = args.chromium;
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
let OUT = args.out ? path.resolve(args.out) : null;
const ROUTES = (args.routes ?? '/').split(',');
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 20_000;
const CHROMIUM_EXIT_TIMEOUT_MS = 5_000;

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

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function resolveChromiumWorkingDirectory(outputRoot, {
  sourceRoot = SOURCE_ROOT,
  tempRoot = os.tmpdir(),
  makeTemp = mkdtempSync,
} = {}) {
  const candidate = path.join(path.resolve(outputRoot), 'chromium-workdir');
  if (!isInside(candidate, sourceRoot)) return candidate;
  return makeTemp(path.join(path.resolve(tempRoot), 'cana-chromium-cwd-'));
}

export function createTimerRegistry({
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const active = new Set();
  return {
    set(callback, timeoutMs) {
      let timer = null;
      timer = setTimeoutFn(() => {
        active.delete(timer);
        callback();
      }, timeoutMs);
      active.add(timer);
      return timer;
    },
    clear(timer) {
      if (timer === null || timer === undefined) return;
      clearTimeoutFn(timer);
      active.delete(timer);
    },
    clearAll() {
      for (const timer of active) clearTimeoutFn(timer);
      active.clear();
    },
    get activeCount() {
      return active.size;
    },
  };
}

export function createCdpLifecycle({
  sendJson,
  timerRegistry = createTimerRegistry(),
  commandTimeoutMs = CDP_COMMAND_TIMEOUT_MS,
  now = Date.now,
  onTerminalFailure = () => {},
  onEvent = () => {},
} = {}) {
  let messageId = 0;
  const pending = new Map();
  let lastRequest = null;
  let terminalFailure = null;
  let terminalFailureCount = 0;

  function cdpFailure(failureClass, entry = lastRequest, extra = {}) {
    const context = entry?.context ?? lastRequest?.context ?? {};
    const detail = {
      CDP_MESSAGE_ID: entry?.id ?? lastRequest?.id ?? null,
      CDP_METHOD: entry?.method ?? lastRequest?.method ?? null,
      ROUTE: context.route ?? null,
      SCHEME: context.scheme ?? null,
      WIDTH: context.width ?? null,
      FAILURE_CLASS: failureClass,
      ELAPSED_MS: entry ? now() - entry.startedAt : null,
      ...extra,
    };
    const error = new Error(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}`);
    error.cdpFailure = detail;
    return error;
  }

  function rejectEntry(entry, canonicalFailure) {
    if (!pending.delete(entry.id)) return false;
    timerRegistry.clear(entry.timer);
    entry.timer = null;
    const cause = canonicalFailure.cdpFailure;
    const failure = cdpFailure(cause.FAILURE_CLASS, entry, { TERMINAL_CAUSE: cause });
    entry.reject(failure);
    return true;
  }

  function failLifecycle(failureClass, extra = {}, causeEntry = lastRequest) {
    if (!terminalFailure) {
      terminalFailure = cdpFailure(failureClass, causeEntry, extra);
      terminalFailureCount += 1;
      try {
        onTerminalFailure(terminalFailure);
      } catch (error) {
        terminalFailure.cdpFailure.HANDLER_ERROR = error.message;
      }
    }
    for (const entry of [...pending.values()]) rejectEntry(entry, terminalFailure);
    return terminalFailure;
  }

  function send(method, params = {}, context = null) {
    const entry = {
      id: ++messageId,
      method,
      context,
      startedAt: now(),
      timer: null,
      resolve: null,
      reject: null,
    };
    lastRequest = entry;
    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      if (terminalFailure) {
        reject(cdpFailure(terminalFailure.cdpFailure.FAILURE_CLASS, entry, {
          TERMINAL_CAUSE: terminalFailure.cdpFailure,
        }));
        return;
      }
      pending.set(entry.id, entry);
      entry.timer = timerRegistry.set(() => {
        failLifecycle('CDP_TIMEOUT', {}, entry);
      }, commandTimeoutMs);
      try {
        sendJson(JSON.stringify({ id: entry.id, method, params }));
      } catch (error) {
        failLifecycle('WEBSOCKET_ERROR', { MESSAGE: error.message }, entry);
      }
    });
  }

  function resolveEntry(entry, result) {
    if (!pending.delete(entry.id)) return;
    timerRegistry.clear(entry.timer);
    entry.timer = null;
    entry.resolve(result);
  }

  function handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      failLifecycle('CDP_MALFORMED_MESSAGE', { MESSAGE: error.message });
      return;
    }
    try {
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        if (message.error) {
          failLifecycle('CDP_PROTOCOL_ERROR', { PROTOCOL_ERROR: message.error }, entry);
        } else {
          resolveEntry(entry, message.result);
        }
        return;
      }
      onEvent(message);
    } catch (error) {
      failLifecycle('HARNESS_ASYNC_HANDLER', { MESSAGE: error.message });
    }
  }

  return {
    send,
    handleMessage,
    failLifecycle,
    get pendingCount() { return pending.size; },
    get activeRequestTimerCount() {
      return [...pending.values()].filter((entry) => entry.timer !== null).length;
    },
    get terminalFailure() { return terminalFailure; },
    get terminalFailureCount() { return terminalFailureCount; },
    get lastRequest() { return lastRequest; },
  };
}

let chrome = null;
let ws = null;
let lifecycle = null;
let timers = null;
let loadWait = null;
let cleanupStarted = false;
let cleanupPromise = null;
let chromeExited = false;
let chromiumCwd = null;
let terminalWaiters = new Set();

function resetChromeExit() {
  chromeExited = false;
}

function delay(timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      terminalWaiters.delete(cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = (error) => finish(error);
    terminalWaiters.add(cancel);
    timer = timers.set(() => finish(), timeoutMs);
  });
}

function waitForLoad(context) {
  if (loadWait) loadWait.resolve('replaced');
  return new Promise((resolve) => {
    const timer = timers.set(() => {
      if (loadWait?.timer !== timer) return;
      loadWait = null;
      resolve('timeout');
    }, LOAD_TIMEOUT_MS);
    loadWait = {
      timer,
      resolve(reason) {
        if (loadWait?.timer !== timer) return;
        timers.clear(timer);
        loadWait = null;
        resolve(reason);
      },
      fail(error) {
        if (loadWait?.timer !== timer) return;
        timers.clear(timer);
        loadWait = null;
        resolve({ reason: 'failure', error });
      },
      context,
    };
  });
}

function signalChromium(signal) {
  if (!chrome) return true;
  try {
    if (process.platform === 'win32') {
      if (!chromeExited) chrome.kill(signal);
    }
    else process.kill(-chrome.pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    try {
      if (!chromeExited) chrome.kill(signal);
      return true;
    } catch (fallbackError) {
      process.stderr.write(`CHROMIUM_CLEANUP_SIGNAL_FAILED ${signal} ${error.message}; ${fallbackError.message}\n`);
      return false;
    }
  }
}

function chromiumProcessTreeAlive() {
  if (!chrome) return false;
  if (process.platform === 'win32') return !chromeExited;
  if (process.platform === 'linux') {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
        const [state, , processGroup] = fields;
        if (Number(processGroup) === chrome.pid && state !== 'Z') return true;
      } catch {
        // Processes can exit between the directory listing and stat read.
      }
    }
    return false;
  }
  try {
    process.kill(-chrome.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

function cleanupDelay(timeoutMs) {
  return new Promise((resolve) => timers.set(resolve, timeoutMs));
}

async function waitForChromiumTreeExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (chromiumProcessTreeAlive() && Date.now() < deadline) {
    await cleanupDelay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  return !chromiumProcessTreeAlive();
}

async function terminateChromium() {
  if (!chromiumProcessTreeAlive()) return;
  signalChromium('SIGTERM');
  const exitedAfterTerm = await waitForChromiumTreeExit(CHROMIUM_EXIT_TIMEOUT_MS);
  if (exitedAfterTerm) return;
  signalChromium('SIGKILL');
  const exitedAfterKill = await waitForChromiumTreeExit(CHROMIUM_EXIT_TIMEOUT_MS);
  if (!exitedAfterKill) {
    lifecycle.failLifecycle('CHROMIUM_EXIT', { MESSAGE: 'Chromium did not exit after SIGKILL escalation' });
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupStarted = true;
  cleanupPromise = (async () => {
    try {
      if (lifecycle?.pendingCount > 0) lifecycle.failLifecycle('HARNESS_CLEANUP');
      if (loadWait) loadWait.resolve('cleanup');
      if (ws) {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      }
      if (ws && ws.readyState < 2) {
        try {
          ws.close();
        } catch (error) {
          process.stderr.write(`WEBSOCKET_CLEANUP_FAILED ${error.message}\n`);
        }
      }
      await terminateChromium();
    } finally {
      timers?.clearAll();
    }
  })();
  return cleanupPromise;
}

async function runScreenshotHarness() {
  if (!BASE || !CHROMIUM) {
    console.error('REFUSED: --base-url and --chromium are required. This harness needs a running build; see file header.');
    process.exitCode = 2;
    return;
  }

  OUT ??= mkdtempSync(path.join(os.tmpdir(), 'cana-visual-court-'));
  mkdirSync(OUT, { recursive: true });
  chromiumCwd = resolveChromiumWorkingDirectory(OUT);
  mkdirSync(chromiumCwd, { recursive: true });
  process.stdout.write(`VISUAL_COURT_OUT=${OUT}\nBROWSER_CWD=${chromiumCwd}\n`);

  chrome = null;
  ws = null;
  loadWait = null;
  cleanupStarted = false;
  cleanupPromise = null;
  terminalWaiters = new Set();
  timers = createTimerRegistry();
  resetChromeExit();
  lifecycle = createCdpLifecycle({
    timerRegistry: timers,
    sendJson(payload) {
      if (!ws) throw new Error('WebSocket is not connected');
      ws.send(payload);
    },
    onTerminalFailure(error) {
      for (const cancel of [...terminalWaiters]) cancel(error);
      if (loadWait) loadWait.fail(error);
    },
    onEvent(message) {
      if (message.method === 'Page.loadEventFired' && loadWait) loadWait.resolve('event');
      if (message.method === 'Inspector.targetCrashed' || message.method === 'Target.targetCrashed') {
        lifecycle.failLifecycle('TARGET_CRASH', { EVENT: message.method, PARAMS: message.params ?? null });
      }
      if (message.method === 'Inspector.detached' || message.method === 'Target.detachedFromTarget') {
        lifecycle.failLifecycle('TARGET_DETACH', { EVENT: message.method, PARAMS: message.params ?? null });
      }
    },
  });
  const { send } = lifecycle;
  let failure = null;
  let failureDetail = null;
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
  chrome.once('error', (error) => {
    chromeExited = true;
    if (!cleanupStarted) lifecycle.failLifecycle('CHROMIUM_EXIT', { MESSAGE: error.message });
  });
  chrome.once('exit', (code, signal) => {
    chromeExited = true;
    if (!cleanupStarted) lifecycle.failLifecycle('CHROMIUM_EXIT', { EXIT_CODE: code, SIGNAL: signal });
  });
  await delay(3000);
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;

  const controller = new AbortController();
  const cancelFetch = () => controller.abort();
  terminalWaiters.add(cancelFetch);
  const fetchTimer = timers.set(() => controller.abort(), CDP_COMMAND_TIMEOUT_MS);
  let targets;
  try {
    targets = await (await fetch('http://127.0.0.1:9224/json/list', { signal: controller.signal })).json();
  } catch (error) {
    throw lifecycle.terminalFailure ?? lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: error.message });
  } finally {
    timers.clear(fetchTimer);
    terminalWaiters.delete(cancelFetch);
  }
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No Chromium page target is available');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      terminalWaiters.delete(cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = (error) => finish(error);
    terminalWaiters.add(cancel);
    timer = timers.set(() => {
      finish(lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: 'WebSocket open timed out' }));
    }, CDP_COMMAND_TIMEOUT_MS);
    ws.onopen = () => finish();
    ws.onerror = (event) => {
      finish(lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: String(event?.message ?? 'WebSocket open failed') }));
    };
    ws.onclose = (event) => {
      finish(lifecycle.failLifecycle('WEBSOCKET_CLOSED', { CLOSE_CODE: event.code, REASON: event.reason }));
    };
  });
  ws.onclose = (event) => lifecycle.failLifecycle('WEBSOCKET_CLOSED', { CLOSE_CODE: event.code, REASON: event.reason });
  ws.onerror = (event) => lifecycle.failLifecycle('WEBSOCKET_ERROR', { MESSAGE: String(event?.message ?? 'unknown WebSocket error') });
  ws.onmessage = (event) => lifecycle.handleMessage(event.data);

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
        await delay(1200);
        if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;
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
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;

  const { assertRegisteredImage } = await import(path.join(SOURCE_ROOT, 'apps/web/src/lib/asset-registry.mjs'));
  const unregistered = [...allImgs].filter((img) => {
    try { assertRegisteredImage(img); return false; } catch { return true; }
  });

  const checks = [
    checkHeaderHeight({ desktopPx: Math.max(...headerSamples.filter(Boolean)) }),
    checkOverflow({ overflowingWidths: [...overflowing] }),
    checkImageRegistry({ unregistered }),
  ];
  if (lifecycle.terminalFailure) throw lifecycle.terminalFailure;
  verdict = courtVerdict(checks, 'RENDERED');
  writeFileSync(path.join(OUT, 'rendered-verdict.json'), JSON.stringify({ verdict, rendered }, null, 1));
  console.log(JSON.stringify(verdict, null, 2));
} catch (error) {
  failure = error;
  const lastRequest = lifecycle.lastRequest;
  failureDetail = error.cdpFailure ?? {
    CDP_MESSAGE_ID: lastRequest?.id ?? null,
    CDP_METHOD: lastRequest?.method ?? null,
    ROUTE: lastRequest?.context?.route ?? null,
    SCHEME: lastRequest?.context?.scheme ?? null,
    WIDTH: lastRequest?.context?.width ?? null,
    FAILURE_CLASS: 'HARNESS_ERROR',
    ELAPSED_MS: lastRequest ? Date.now() - lastRequest.startedAt : null,
    MESSAGE: error.message,
  };
} finally {
  await cleanup();
}

  failure ??= lifecycle.terminalFailure;
  if (failure) {
    failureDetail ??= failure.cdpFailure ?? { FAILURE_CLASS: 'HARNESS_ERROR', MESSAGE: failure.message };
    const detail = {
      ...failureDetail,
      BROWSER_CWD: chromiumCwd,
      PENDING_COUNT: lifecycle.pendingCount,
      ACTIVE_TIMER_COUNT: timers.activeCount,
      TERMINAL_FAILURE_COUNT: lifecycle.terminalFailureCount,
    };
    writeFileSync(path.join(OUT, 'rendered-failure.json'), JSON.stringify(detail, null, 2));
    process.stderr.write(`CANA_RENDERED_CDP_FAILURE ${JSON.stringify(detail)}\n`);
  }
  process.exitCode = failure || verdict?.verdict !== 'PASS' ? 1 : 0;
}

if (IS_MAIN) await runScreenshotHarness();
