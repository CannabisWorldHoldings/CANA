#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { getCompetitiveReviewCampaigns } from '../../packages/ad-creative/src/competitive-campaigns.mjs';

const campaigns = getCompetitiveReviewCampaigns();
const viewports = Object.freeze({
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 844 },
});

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const baseUrlInput = argument('base-url');
const outputInput = argument('output');
if (!baseUrlInput || !outputInput) {
  throw new Error('Usage: capture-owner-review.mjs --base-url <local URL> --output <directory>');
}
const baseUrl = new URL(baseUrlInput);
if (!['orderweeddc.localhost', 'localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
  throw new Error('Owner-review capture refuses non-local URLs.');
}
const outputDirectory = path.resolve(outputInput);
if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length > 0) {
  throw new Error(`Owner-review output must be empty: ${outputDirectory}`);
}
fs.mkdirSync(outputDirectory, { recursive: true });

const actionLog = [];
const manifest = {
  schema_version: 'cana.owner-review-render-manifest/1.0.0',
  base_url: baseUrl.origin,
  rejected_source_commit: '5c7fe2707dcb2836ed62e1c3d9a01bb62cd50723',
  owner_decision_status: 'PENDING',
  production_accessed: false,
  campaigns: {},
};

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const releaseContext = await browser.newContext();
  const releaseResponse = await releaseContext.request.get(new URL('/api/release', baseUrl).href);
  if (!releaseResponse.ok()) throw new Error(`/api/release returned ${releaseResponse.status()}`);
  manifest.release_identity = await releaseResponse.json();
  manifest.source_commit = manifest.release_identity.gitSha ?? null;
  await releaseContext.close();

  for (const campaign of campaigns) {
    manifest.campaigns[campaign.id] = {};
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport });
      await context.route('**/*', async (route) => {
        const hostname = new URL(route.request().url()).hostname;
        if (['orderweeddc.localhost', 'localhost', '127.0.0.1'].includes(hostname)) await route.continue();
        else await route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem('owd:age-attested-at', String(Date.now()));
      });
      const consoleProblems = [];
      const requestFailures = [];
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) {
          consoleProblems.push(`${message.type()}:${message.text()}`);
        }
      });
      page.on('pageerror', (error) => consoleProblems.push(`pageerror:${error.message}`));
      page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown';
        if (failure !== 'net::ERR_ABORTED') requestFailures.push(`${request.url()}:${failure}`);
      });

      const route = `/?ownerReviewCampaign=${encodeURIComponent(campaign.id)}`;
      const url = new URL(route, baseUrl).href;
      actionLog.push({ action: 'goto', campaign_id: campaign.id, viewport: viewportName, url });
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
      if (!response || response.status() !== 200) {
        throw new Error(`${campaign.id} ${viewportName} returned ${response?.status() ?? 'no response'}`);
      }
      const banner = page.locator(
        `aside[data-owner-review-campaign="true"][data-owner-review-status="PENDING"][data-banner-campaign="${campaign.id}"]`,
      );
      await banner.waitFor({ state: 'visible', timeout: 7_000 });
      const pageText = await page.locator('body').innerText();
      const forbidden = [
        /House campaign/i,
        /No paid campaign is live/i,
        /Demo Retailer (?:Alpha|Beta|Gamma|Delta|Epsilon)/i,
      ].filter((pattern) => pattern.test(pageText)).map((pattern) => pattern.source);
      if (forbidden.length > 0) {
        throw new Error(`${campaign.id} ${viewportName} exposed forbidden prototype/internal copy: ${forbidden.join(', ')}`);
      }
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = axe.violations
        .filter((violation) => ['serious', 'critical'].includes(violation.impact))
        .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
      const performance = await page.evaluate(() => ({
        resource_count: performance.getEntriesByType('resource').length,
        transferred_bytes: performance.getEntriesByType('resource')
          .reduce((total, entry) => total + (entry.transferSize || 0), 0),
      }));

      const pagePath = path.join(outputDirectory, `${campaign.id}-${viewportName}-homepage.png`);
      const isolatedPath = path.join(outputDirectory, `${campaign.id}-${viewportName}-billboard.png`);
      await page.screenshot({ path: pagePath, fullPage: false });
      await banner.screenshot({ path: isolatedPath });
      const imageSource = await banner.locator('img').evaluate((image) => new URL(image.currentSrc).pathname);
      const record = {
        route,
        viewport,
        status: response.status(),
        page_context_path: path.basename(pagePath),
        page_context_sha256: sha256(pagePath),
        isolated_path: path.basename(isolatedPath),
        isolated_sha256: sha256(isolatedPath),
        image_source: imageSource,
        horizontal_overflow: horizontalOverflow,
        console_problems: consoleProblems,
        request_failures: requestFailures,
        serious_accessibility_findings: serious,
        performance,
      };
      manifest.campaigns[campaign.id][viewportName] = record;
      actionLog.push({
        action: 'capture', campaign_id: campaign.id, viewport: viewportName,
        page_context_sha256: record.page_context_sha256,
        isolated_sha256: record.isolated_sha256,
      });
      if (horizontalOverflow || consoleProblems.length || requestFailures.length || serious.length) {
        throw new Error(`${campaign.id} ${viewportName} failed browser courts: overflow=${horizontalOverflow}; console=${consoleProblems.join(' | ') || 'none'}; requests=${requestFailures.join(' | ') || 'none'}; accessibility=${serious.map((finding) => finding.id).join(' | ') || 'none'}`);
      }
      await context.close();
    }
  }
  manifest.captured_at = new Date().toISOString();
  manifest.screenshot_count = campaigns.length * Object.keys(viewports).length * 2;
  manifest.status = 'PASS';
  writeJson(path.join(outputDirectory, 'action-log.json'), actionLog);
  writeJson(path.join(outputDirectory, 'render-manifest.json'), manifest);
  console.log(JSON.stringify({
    status: manifest.status,
    campaigns: Object.keys(manifest.campaigns),
    screenshots: manifest.screenshot_count,
    output_directory: outputDirectory,
  }, null, 2));
} catch (error) {
  writeJson(path.join(outputDirectory, 'failure-receipt.json'), {
    status: 'FAIL',
    error: error instanceof Error ? error.message : String(error),
    action_log: actionLog,
    browser_closed_in_finally: true,
  });
  throw error;
} finally {
  await browser?.close();
}
