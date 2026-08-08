#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CAMPAIGNS = ['district-signal', 'evening-index', 'receipt-rhythm'];
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 1100 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function reviewUrl(baseUrl, surface, campaign) {
  const target = new URL(baseUrl);
  if (surface === 'homepage') {
    target.pathname = '/';
    target.searchParams.set('creativeReview', campaign);
  } else {
    target.pathname = '/lab/dynamic-creative';
    target.searchParams.set('campaign', campaign);
  }
  return target.toString();
}

async function captureScenario({ browser, baseUrl, outputRoot, campaign, surface, viewportName }) {
  const viewport = VIEWPORTS[viewportName];
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const blockedExternal = [];
  const httpErrors = [];
  const allowedHosts = new Set(['localhost', 'orderweeddc.localhost']);

  await page.route('**/*', async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (['http:', 'https:'].includes(new URL(route.request().url()).protocol) && !allowedHosts.has(hostname)) {
      blockedExternal.push(route.request().url());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (!blockedExternal.includes(request.url())) failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'UNKNOWN' });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
  });

  const url = reviewUrl(baseUrl, surface, campaign);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`${surface}/${campaign}/${viewportName} returned ${response?.status() ?? 'no response'}`);
  const ageDialog = page.getByRole('dialog', { name: 'Are you 21 or older?' });
  if (surface === 'homepage') {
    await ageDialog.waitFor({ state: 'visible' });
    await ageDialog.getByRole('button', { name: "Yes, I'm 21 or older" }).click();
    await ageDialog.waitFor({ state: 'detached' });
  }
  const placement = page.locator('[data-dynamic-creative-placement]');
  await placement.waitFor({ state: 'visible' });
  await page.locator('[data-creative-asset]').evaluate((image) => {
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) {
      return new Promise((resolveImage, rejectImage) => {
        image.addEventListener('load', () => resolveImage(true), { once: true });
        image.addEventListener('error', () => rejectImage(new Error('creative image failed to load')), { once: true });
      });
    }
    return true;
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await placement.scrollIntoViewIfNeeded();

  const expectedAsset = `/creative/${campaign === 'source-before-hype' ? 'house/source-before-hype' : `review/${campaign}`}-${viewportName}.svg`;
  const observed = await placement.evaluate((element) => {
    const image = element.querySelector('[data-creative-asset]');
    const rect = element.getBoundingClientRect();
    return {
      campaignId: element.getAttribute('data-campaign-id'),
      reviewState: element.getAttribute('data-review-state'),
      providerNetwork: element.getAttribute('data-provider-network'),
      text: element.textContent,
      currentSrc: image instanceof HTMLImageElement ? new URL(image.currentSrc).pathname : null,
      naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      naturalHeight: image instanceof HTMLImageElement ? image.naturalHeight : 0,
      placementWidth: rect.width,
      placementHeight: rect.height,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  const axe = await new AxeBuilder({ page })
    .include('[data-dynamic-creative-placement]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const seriousAxe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.includes('ERR_BLOCKED_BY_CLIENT'));
  const unexpectedFailedRequests = failedRequests.filter(
    (request) => !(request.error === 'net::ERR_ABORTED' && new URL(request.url).searchParams.has('_rsc')),
  );
  const screenshotPath = join(outputRoot, `${campaign}-${viewportName}-${surface}.png`);
  if (surface === 'homepage') {
    await placement.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 76), behavior: 'instant' });
    });
    await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage: false });
  } else {
    await placement.screenshot({ path: screenshotPath, animations: 'disabled' });
  }

  const checks = {
    age_gate_attested: await ageDialog.count() === 0,
    campaign_matches: observed.campaignId === campaign,
    responsive_source_matches: observed.currentSrc === expectedAsset,
    image_loaded: observed.naturalWidth > 0 && observed.naturalHeight > 0,
    disclosure_visible: campaign === 'source-before-hype'
      ? observed.text?.includes('ORDERWEEDDC house campaign')
      : observed.text?.includes('Sponsored'),
    synthetic_label_visible: observed.text?.includes('Synthetic advertiser'),
    owner_review_gate_visible: campaign === 'source-before-hype'
      ? observed.reviewState === 'APPROVED_PRIMARY'
      : observed.reviewState === 'OWNER_REVIEW_REQUIRED',
    zero_provider_network_receipt: observed.providerNetwork === '0',
    no_horizontal_overflow: observed.pageScrollWidth <= observed.viewportWidth,
    no_console_errors: unexpectedConsoleErrors.length === 0,
    no_page_errors: pageErrors.length === 0,
    no_failed_local_requests: unexpectedFailedRequests.length === 0,
    no_http_errors: httpErrors.length === 0,
    no_serious_critical_axe: seriousAxe.length === 0,
    no_external_image_provider_requests: blockedExternal.every((requestUrl) => !/openai|googleapis|vertex|gemini|replicate|stability|fal\.ai/i.test(requestUrl)),
  };
  const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
  await context.close();
  return {
    scenario: `${campaign}-${viewportName}-${surface}`,
    status,
    url,
    viewport,
    expected_asset: expectedAsset,
    observed,
    checks,
    serious_critical_axe: seriousAxe.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.length })),
    all_axe_violation_count: axe.violations.length,
    console_errors: consoleErrors,
    unexpected_console_errors: unexpectedConsoleErrors,
    page_errors: pageErrors,
    failed_requests: failedRequests,
    unexpected_failed_requests: unexpectedFailedRequests,
    http_errors: httpErrors,
    external_requests_blocked: [...new Set(blockedExternal)],
    screenshot_scope: surface === 'homepage' ? 'FULL_BROWSER_VIEWPORT_WITH_PAGE_CONTEXT' : 'PLACEMENT_ISOLATION',
    screenshot: relative(REPO_ROOT, screenshotPath),
  };
}

async function contactSheet(browser, outputRoot, results) {
  const selected = results.filter((result) => CAMPAIGNS.includes(result.observed.campaignId) && result.url.includes('/lab/dynamic-creative'));
  const tiles = [];
  for (const result of selected) {
    const imageBytes = await readFile(resolve(REPO_ROOT, result.screenshot));
    const viewportClass = result.viewport.width < 500 ? 'mobile' : 'desktop';
    tiles.push(`<figure class="${viewportClass}"><img src="data:image/png;base64,${imageBytes.toString('base64')}" alt="${result.scenario}"><figcaption><strong>${result.observed.campaignId}</strong><span>${result.viewport.width}px · ${result.status}</span></figcaption></figure>`);
  }
  const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#eef3ef;color:#0f172a;font-family:Arial,sans-serif;padding:38px}header{display:flex;align-items:end;justify-content:space-between;margin-bottom:24px}h1{margin:0;font-size:34px;letter-spacing:-.04em}p{margin:8px 0 0;color:#475569}small{font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#166534}.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:20px;align-items:start}figure{margin:0;background:white;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.12)}img{display:block;width:100%;object-fit:contain;object-position:top;background:#fff}.desktop img{height:360px}.mobile img{height:560px}figcaption{display:flex;justify-content:space-between;padding:14px 16px;font-size:14px}figcaption span{color:#64748b;font-size:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}.mobile img{height:640px}}
  </style></head><body><header><div><small>Owner review · no publication authority</small><h1>Dynamic creative tournament</h1><p>Three original systems · desktop and mobile · deterministic zero-spend fixtures</p></div><small>OWNER_REVIEW_REQUIRED</small></header><div class="grid">${tiles.join('')}</div></body></html>`);
  const sheetPath = join(outputRoot, 'campaign-contact-sheet.png');
  await page.screenshot({ path: sheetPath, fullPage: true });
  await page.close();
  return relative(REPO_ROOT, sheetPath);
}

async function main() {
  const baseUrl = argument('base-url');
  const requestedOutput = argument('output');
  if (!baseUrl || !requestedOutput) throw new Error('Usage: capture-owner-review.mjs --base-url <url> --output <directory>');
  const outputRoot = isAbsolute(requestedOutput) ? requestedOutput : resolve(REPO_ROOT, requestedOutput);
  await mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const campaign of CAMPAIGNS) {
      for (const surface of ['homepage', 'lab']) {
        for (const viewportName of Object.keys(VIEWPORTS)) {
          results.push(await captureScenario({ browser, baseUrl, outputRoot, campaign, surface, viewportName }));
        }
      }
    }
    for (const viewportName of Object.keys(VIEWPORTS)) {
      results.push(await captureScenario({ browser, baseUrl, outputRoot, campaign: 'source-before-hype', surface: 'homepage', viewportName }));
    }
    const contactSheetPath = await contactSheet(browser, outputRoot, results);
    const failed = results.filter((result) => result.status !== 'PASS');
    const receipt = {
      schema_version: 'cana.dynamic-creative-browser-tournament/1.0.0',
      status: failed.length === 0 ? 'PASS' : 'FAIL',
      runtime: { node: process.version, exec_path: process.execPath, playwright: '1.62.1', browser: 'chromium' },
      scenarios: results,
      scenario_count: results.length,
      passed: results.length - failed.length,
      failed: failed.map((result) => result.scenario),
      contact_sheet: contactSheetPath,
      production_accessed: false,
      provider_spend_usd: 0,
      provider_requests: 0,
      publication_authority: 'NONE',
    };
    await writeFile(join(outputRoot, 'browser-tournament-receipt.json'), json(receipt), 'utf8');
    process.stdout.write(json(receipt));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
