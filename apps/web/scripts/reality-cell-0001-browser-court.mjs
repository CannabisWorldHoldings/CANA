import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import {
  createRealityCellFixture,
  runRealityCellFixtureDryRun,
} from './reality-cell-0001-dry-run.mjs';

const require = createRequire(import.meta.url);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
  Object.freeze({ label: 'tablet', width: 768, height: 1024 }),
  Object.freeze({ label: 'desktop', width: 1280, height: 900 }),
]);

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function previewHtml(fixture) {
  const candidate = escapeHtml(fixture.candidate.candidateDigest);
  return `<!doctype html>
<html lang="en" data-candidate-digest="${candidate}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Reality Cell 0001 private fixture preview</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f4f4ef; color: #172019; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f4ef; }
    header { background: #153d26; color: #fff; padding: 20px 32px; }
    header p { margin: 6px 0 0; color: #d7eadb; }
    main { width: min(1080px, calc(100% - 40px)); margin: 32px auto 56px; }
    .notice { padding: 14px 16px; border: 2px solid #705100; border-radius: 14px; background: #fff4c2; color: #392900; font-weight: 700; }
    .hero { margin-top: 22px; padding: 32px; border-radius: 24px; background: #fff; box-shadow: 0 12px 36px rgb(20 48 30 / 10%); }
    h1 { max-width: 720px; margin: 0; font-size: clamp(2rem, 5vw, 4.2rem); line-height: 1; letter-spacing: -.04em; }
    .lede { max-width: 690px; margin: 18px 0 0; font-size: 1.12rem; line-height: 1.6; color: #34433a; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 0; margin: 24px 0 0; list-style: none; }
    .fact { border: 1px solid #c8d4ca; border-radius: 14px; padding: 15px; background: #f7faf7; }
    .fact strong { display: block; margin-bottom: 5px; }
    h2 { margin: 34px 0 14px; font-size: 1.65rem; }
    .products { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    article { min-height: 184px; padding: 20px; border: 1px solid #c8d4ca; border-radius: 18px; background: #fff; }
    article h3 { margin: 8px 0; }
    .verified { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 999px; background: #dff3e5; color: #0d4923; font-size: .8rem; font-weight: 800; }
    .unknown { color: #5a625d; font-size: .9rem; }
    a { color: #0c5e2c; font-weight: 750; text-underline-offset: 3px; }
    footer { width: min(1080px, calc(100% - 40px)); margin: 0 auto 32px; color: #465149; font-size: .9rem; }
    footer code { overflow-wrap: anywhere; word-break: break-word; }
    @media (max-width: 760px) { header { padding: 18px 20px; } .hero { padding: 24px; } .facts, .products { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <strong>ORDERWEEDDC Experience Fabric</strong>
    <p>Private, local, fixture-only preview</p>
  </header>
  <main>
    <div class="notice" role="status">SIMULATED / FIXTURE. No real merchant, inventory, customer traffic, price, availability, or authorization.</div>
    <section class="hero" aria-labelledby="preview-title">
      <h1 id="preview-title">Find verified merchant and product information faster.</h1>
      <p class="lede">This bounded candidate tests information hierarchy only. Verified facts remain distinct from unknown availability and fixture product examples.</p>
      <ul class="facts" aria-label="Fixture merchant facts">
        <li class="fact"><strong>License</strong><span>Fixture identifier, not a real license</span></li>
        <li class="fact"><strong>Service mode</strong><span>UNKNOWN until separately verified</span></li>
        <li class="fact"><strong>Availability</strong><span>UNKNOWN; no inventory claim</span></li>
      </ul>
      <h2>Fixture product discovery</h2>
      <div class="products">
        <article><span class="verified">Fixture record</span><h3>Category example A</h3><p class="unknown">Price and availability: UNKNOWN</p><a href="#evidence-a">Inspect fixture evidence</a></article>
        <article><span class="verified">Fixture record</span><h3>Category example B</h3><p class="unknown">Price and availability: UNKNOWN</p><a href="#evidence-b">Inspect fixture evidence</a></article>
        <article><span class="verified">Fixture record</span><h3>Category example C</h3><p class="unknown">Price and availability: UNKNOWN</p><a href="#evidence-c">Inspect fixture evidence</a></article>
      </div>
    </section>
  </main>
  <footer>Candidate digest: <code>${candidate}</code></footer>
</body>
</html>`;
}

async function listen(html) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

export async function runRealityCellBrowserCourt({ commit, tree, outputDirectory, chromeExecutable = CHROME }) {
  if (!outputDirectory) throw new Error('outputDirectory required');
  if (!fs.existsSync(chromeExecutable)) throw new Error(`Chrome executable not found: ${chromeExecutable}`);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const fixture = createRealityCellFixture({ commit, tree });
  const html = previewHtml(fixture);
  const server = await listen(html);
  const address = server.address();
  const route = fixture.candidate.target;
  const url = `http://127.0.0.1:${address.port}${route}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable, args: ['--no-sandbox'] });
    const browserEvidenceByViewport = [];
    for (const viewport of VIEWPORTS) {
      const consoleErrors = [];
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: 'light',
      });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      if (!response?.ok()) throw new Error(`${viewport.label} private preview returned ${response?.status() ?? 'no response'}`);
      const screenshotName = viewport.label === 'desktop' ? 'private-preview.png' : `private-preview-${viewport.label}.png`;
      const screenshotPath = path.join(outputDirectory, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const dom = await page.content();
      if (viewport.label === 'desktop') {
        fs.writeFileSync(path.join(outputDirectory, 'private-preview.html'), dom, { mode: 0o600 });
      }
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const accessibility = await page.evaluate(async () => {
        const result = await globalThis.axe.run(document, { resultTypes: ['violations'] });
        return result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        }));
      });
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      browserEvidenceByViewport.push({
        route,
        candidateDigest: fixture.candidate.candidateDigest,
        commit,
        tree,
        browser: 'Google Chrome',
        browserVersion: browser.version(),
        viewport: { width: viewport.width, height: viewport.height },
        screenshotDigest: sha256(fs.readFileSync(screenshotPath)),
        domDigest: sha256(dom),
        capturedAt: new Date().toISOString(),
        consoleResult: { status: consoleErrors.length === 0 ? 'PASS' : 'FAIL', errors: consoleErrors.length, messages: consoleErrors },
        accessibilityResult: { status: accessibility.length === 0 ? 'PASS' : 'FAIL', violations: accessibility },
        layoutResult: { status: horizontalOverflow ? 'FAIL' : 'PASS', horizontalOverflow },
      });
      await context.close();
    }
    const browserEvidence = browserEvidenceByViewport.find((evidence) => evidence.viewport.width === 1280);
    fs.writeFileSync(path.join(outputDirectory, 'browser-evidence.json'), `${JSON.stringify(browserEvidence, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(outputDirectory, 'browser-evidence-all-viewports.json'), `${JSON.stringify(browserEvidenceByViewport, null, 2)}\n`, { mode: 0o600 });
    fixture.browserEvidence = browserEvidence;
    const dryRun = await runRealityCellFixtureDryRun({ commit, tree, fixture });
    const allViewportsPass = browserEvidenceByViewport.length === VIEWPORTS.length
      && browserEvidenceByViewport.every((evidence) => evidence.consoleResult.status === 'PASS'
        && evidence.accessibilityResult.status === 'PASS'
        && evidence.layoutResult.status === 'PASS');
    const result = {
      schemaVersion: 'cana.reality-cell-0001-browser-court/1.1.0',
      result: allViewportsPass
        && dryRun.result === 'VERIFIED'
        ? 'PASS'
        : 'FAIL',
      browserEvidence,
      browserEvidenceByViewport,
      dryRun,
      artifacts: [
        'private-preview-mobile.png',
        'private-preview-tablet.png',
        'private-preview.png',
        'private-preview.html',
        'browser-evidence.json',
        'browser-evidence-all-viewports.json',
        'dry-run.json',
      ],
      externalRequests: 0,
      productionEffects: 0,
      realCustomerExposure: 0,
      realMerchantExposure: 0,
    };
    fs.writeFileSync(path.join(outputDirectory, 'dry-run.json'), `${JSON.stringify(dryRun, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(outputDirectory, 'browser-court.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const result = await runRealityCellBrowserCourt({
    commit: argument('--commit'),
    tree: argument('--tree'),
    outputDirectory: argument('--out'),
    chromeExecutable: argument('--chrome') ?? CHROME,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
