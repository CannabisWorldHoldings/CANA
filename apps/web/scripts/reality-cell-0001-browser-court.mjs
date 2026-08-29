import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

import { digest } from '../src/lib/cana-intelligence/core.mjs';
import { makeReceipt } from '../src/lib/cana-intelligence/receipts.mjs';
import { buildManifest } from '../src/lib/experience/manifest.mjs';
import { CANONICAL_TENANT_DOMAIN } from '../src/lib/tenant-host.mjs';
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

function assertedApplicationOrigin(baseUrl) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== CANONICAL_TENANT_DOMAIN) {
    throw new Error('REALITY_CELL_BROWSER_LOCAL_APP_REQUIRED');
  }
  return origin;
}

async function assertDisposableDatabase(prisma) {
  const expectedSystemIdentifier = process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER ?? '';
  let locator;
  try {
    locator = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new Error('REALITY_CELL_DISPOSABLE_DATABASE_REQUIRED');
  }
  if (
    process.env.NODE_ENV === 'production'
    || process.env.CANA_REALITY_CELL_DISPOSABLE_DB !== '1'
    || !['postgres:', 'postgresql:'].includes(locator.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(locator.hostname)
    || !/(?:cana|reality|fixture|verify|court)/i.test(locator.pathname)
    || !/^\d{10,}$/.test(expectedSystemIdentifier)
  ) throw new Error('REALITY_CELL_DISPOSABLE_DATABASE_REQUIRED');
  const [identity] = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS database, system_identifier::text AS system_identifier FROM pg_control_system()',
  );
  if (
    identity?.database !== locator.pathname.slice(1)
    || identity?.system_identifier !== expectedSystemIdentifier
  ) throw new Error('REALITY_CELL_DISPOSABLE_DATABASE_IDENTITY_MISMATCH');
}

async function seedFixtureManifest(prisma, fixture) {
  const manifest = buildManifest({ tenant: CANONICAL_TENANT_DOMAIN, journey: 'DISPENSARIES' });
  manifest.presentation.copy = {
    eyebrow: 'SIMULATED / FIXTURE',
    title: 'Find verified merchant and product information faster.',
    description: 'Fixture-only information hierarchy. No real merchant, inventory, price, availability, customer traffic, or authorization.',
    action: '/dispensaries',
    placeholder: 'Fixture city or neighborhood',
  };
  const promotionReceipt = makeReceipt({
    kind: 'PROMOTION',
    subjectDigest: fixture.candidate.candidateDigest,
    realm: 'FIXTURE',
    issuer: 'fixture-runtime-promotion-court',
    payload: {
      candidateDigest: fixture.candidate.candidateDigest,
      allowedEffectSet: ['UPDATE_LAYOUT'],
      fixtureOnly: true,
    },
  });
  await prisma.canaEvidenceReceipt.create({
    data: {
      tenant: CANONICAL_TENANT_DOMAIN,
      receiptDigest: promotionReceipt.receiptDigest,
      kind: promotionReceipt.kind,
      subjectDigest: promotionReceipt.subjectDigest,
      realm: promotionReceipt.realm,
      issuer: promotionReceipt.issuer,
      payloadJson: JSON.stringify(promotionReceipt.payload),
      issuedAt: new Date(promotionReceipt.issuedAt),
      expiresAt: promotionReceipt.expiresAt ? new Date(promotionReceipt.expiresAt) : null,
      parentDigestsJson: JSON.stringify(promotionReceipt.parentDigests),
    },
  });
  manifest.promotion = {
    receiptDigest: promotionReceipt.receiptDigest,
    candidateDigest: fixture.candidate.candidateDigest,
    evidenceRealm: 'FIXTURE',
  };
  const recordType = 'EXPERIENCE_MANIFEST';
  const recordId = 'journey:DISPENSARIES';
  const recordDigest = digest({
    tenant: CANONICAL_TENANT_DOMAIN,
    recordType,
    recordId,
    body: manifest,
  }, 'record-experience_manifest');
  try {
    await prisma.canaIntelligenceRecord.create({
      data: {
        tenant: CANONICAL_TENANT_DOMAIN,
        recordDigest,
        recordType,
        recordId,
        status: 'PROMOTED',
        bodyJson: JSON.stringify(manifest),
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const replay = await prisma.canaIntelligenceRecord.findUnique({ where: { recordDigest } });
    if (replay?.bodyJson !== JSON.stringify(manifest)) {
      throw new Error('REALITY_CELL_FIXTURE_MANIFEST_DIGEST_CONFLICT');
    }
  }
}

export async function runRealityCellBrowserCourt({
  baseUrl,
  commit,
  tree,
  outputDirectory,
  chromeExecutable = CHROME,
}) {
  if (!outputDirectory) throw new Error('outputDirectory required');
  if (!fs.existsSync(chromeExecutable)) throw new Error(`Chrome executable not found: ${chromeExecutable}`);
  const applicationOrigin = assertedApplicationOrigin(baseUrl);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const fixture = createRealityCellFixture({ commit, tree });
  const prisma = new PrismaClient();
  let browser;
  try {
    await assertDisposableDatabase(prisma);
    await seedFixtureManifest(prisma, fixture);
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable, args: ['--no-sandbox'] });
    const route = fixture.candidate.target;
    const url = new URL(route, applicationOrigin);
    const browserEvidenceByViewport = [];
    const externalRequestUrls = new Set();
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
      page.on('request', (request) => {
        const requestUrl = new URL(request.url());
        if (!['data:', 'blob:'].includes(requestUrl.protocol) && requestUrl.origin !== url.origin) {
          externalRequestUrls.add(requestUrl.href);
        }
      });
      const response = await page.goto(url.href, { waitUntil: 'networkidle' });
      if (!response?.ok()) throw new Error(`${viewport.label} CANA app returned ${response?.status() ?? 'no response'}`);
      const renderedCandidateDigest = await page
        .locator('[data-experience-candidate-digest]')
        .first()
        .getAttribute('data-experience-candidate-digest');
      if (renderedCandidateDigest !== fixture.candidate.candidateDigest) {
        throw new Error('REALITY_CELL_RENDERED_CANDIDATE_DIGEST_MISMATCH');
      }
      const fixtureNotice = await page.getByText('SIMULATED / FIXTURE', { exact: true }).count();
      if (fixtureNotice !== 1) throw new Error('REALITY_CELL_FIXTURE_NOTICE_MISSING');
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
          targets: violation.nodes.map((node) => node.target),
          failureSummaries: violation.nodes.map((node) => node.failureSummary),
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
        independentObserver: 'playwright-browser-court',
        evidenceRealm: 'FIXTURE',
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
      schemaVersion: 'cana.reality-cell-0001-browser-court/1.2.0',
      result: allViewportsPass
        && externalRequestUrls.size === 0
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
      externalRequests: externalRequestUrls.size,
      externalRequestUrls: [...externalRequestUrls],
      applicationRoute: route,
      productionEffects: 0,
      realCustomerExposure: 0,
      realMerchantExposure: 0,
    };
    fs.writeFileSync(path.join(outputDirectory, 'dry-run.json'), `${JSON.stringify(dryRun, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(outputDirectory, 'browser-court.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } finally {
    await browser?.close();
    await prisma.$disconnect();
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const result = await runRealityCellBrowserCourt({
    baseUrl: argument('--base-url'),
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
