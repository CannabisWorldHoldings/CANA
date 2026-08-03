import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function attest(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('owd:age-attested-at', String(Date.now()));
  });
}

function observe(page) {
  const issues = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      issues.push(`console:${message.type()}:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => issues.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      issues.push(`requestfailed:${request.url()}:${request.failure()?.errorText}`);
    }
  });
  return issues;
}

test('customer routes, banner behavior, truth states, and mobile navigation work', async ({ browser }) => {
  const bannerEvents = [];
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await desktop.exposeFunction('captureBannerEvent', (detail) => bannerEvents.push(detail));
  await desktop.addInitScript(() => {
    window.addEventListener('orderweeddc:banner-event', (event) => {
      window.captureBannerEvent(event.detail);
    });
    window.localStorage.setItem('owd:age-attested-at', String(Date.now()));
  });
  const desktopIssues = observe(desktop);

  await desktop.goto('/', { waitUntil: 'networkidle' });
  await expect(desktop.getByRole('heading', { level: 1, name: /A clearer way to find cannabis in D\.C\./ })).toBeVisible();
  const banner = desktop.locator('[data-banner-campaign]');
  await expect(banner.getByText(/House campaign/)).toBeVisible();
  await expect(banner.getByText(/No paid campaign is live/)).toBeVisible();
  expect(await banner.evaluate((element) => {
    const siblings = [...element.parentElement.children].filter((child) => child.tagName !== 'SCRIPT');
    return siblings[0] === element;
  })).toBe(true);
  await expect.poll(() => bannerEvents.some((event) => event.eventName === 'HOUSE_BANNER_VIEW')).toBe(true);
  await banner.getByRole('link', { name: /Explore delivery/ }).click();
  await expect(desktop).toHaveURL(/\/delivery$/);
  expect(bannerEvents.some((event) => event.eventName === 'HOUSE_BANNER_CLICK')).toBe(true);
  await expect(desktop.getByRole('heading', { level: 1, name: /Find delivery records/ })).toBeVisible();
  await expect(desktop.getByText(/confirm service area/i).first()).toBeVisible();
  await expect(desktop.getByText(/Availability, role details, fee and minimum not sourced/).first()).toBeVisible();

  await desktop.goto('/dispensaries', { waitUntil: 'networkidle' });
  await expect(desktop.getByRole('heading', { level: 1, name: /Start with the details/ })).toBeVisible();
  await desktop.goto('/search?query=flower', { waitUntil: 'networkidle' });
  await expect(desktop.getByRole('searchbox')).toHaveValue('flower');
  await expect(desktop.getByRole('heading', { level: 1, name: /Search records without blending/ })).toBeVisible();
  expect(desktopIssues).toEqual([]);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await attest(mobile);
  const mobileIssues = observe(mobile);
  await mobile.goto('/', { waitUntil: 'networkidle' });
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.getByRole('button', { name: /open navigation menu/i }).click();
  await expect(mobile.getByRole('navigation', { name: /mobile/i })).toBeVisible();
  await mobile.getByRole('button', { name: /close navigation menu/i }).click();
  expect(await mobile.locator('[data-banner-campaign] img').evaluate((image) => image.currentSrc)).toContain('hero-marketplace-v2');
  for (const route of ['/delivery', '/dispensaries', '/search?query=flower']) {
    await mobile.goto(route, { waitUntil: 'networkidle' });
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(mobileIssues).toEqual([]);
});

test('visual constitution has neutral sections and no top-level divider borders', async ({ page }) => {
  await attest(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const violations = await page.locator('main section, footer').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const backgrounds = [style.backgroundColor, style.backgroundImage].join(' ');
    const greenBackground = /rgb\((?:0|[1-9]\d?|1\d\d),\s*(?:8\d|9\d|1\d\d|2[0-4]\d),\s*(?:0|[1-9]\d?|1\d\d)\)/.test(backgrounds);
    const divider = parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0;
    return [
      ...(greenBackground ? [`green-background:${element.outerHTML.slice(0, 100)}`] : []),
      ...(divider ? [`divider:${element.outerHTML.slice(0, 100)}`] : []),
    ];
  }));
  expect(violations).toEqual([]);
});

test('age gate, keyboard focus, and WCAG A/AA routes pass', async ({ browser }) => {
  const gateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gatePage = await gateContext.newPage();
  await gatePage.goto('/', { waitUntil: 'networkidle' });
  const dialog = gatePage.getByRole('dialog', { name: /Are you 21 or older/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Yes/ })).toBeFocused();
  await dialog.getByRole('link', { name: /legal & compliance notes/ }).focus();
  await gatePage.keyboard.press('Tab');
  expect(await gatePage.evaluate(() => document.activeElement?.textContent)).toContain('Yes, I');
  await gateContext.close();

  const serious = [];
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await attest(page);
    for (const route of ['/', '/delivery', '/dispensaries', '/search?query=flower']) {
      await page.goto(route, { waitUntil: 'networkidle' });
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      serious.push(...result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)));
    }
    await context.close();
  }
  expect(serious).toEqual([]);
});

test('slower-mobile LCP, CLS, and third-party-script boundary pass', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem('owd:age-attested-at', String(Date.now()));
    window.__reviewVitals = { cls: 0, lcp: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__reviewVitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      window.__reviewVitals.lcp = list.getEntries().at(-1)?.startTime || 0;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 75_000,
    connectionType: 'cellular4g',
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/', { waitUntil: 'networkidle', timeout: 90_000 });
  const vitals = await page.evaluate(() => window.__reviewVitals);
  const thirdPartyScripts = await page.locator('script[src]').evaluateAll((scripts) => scripts
    .map((script) => new URL(script.src).hostname)
    .filter((hostname) => hostname !== window.location.hostname));
  console.log(`CUSTOMER_SLOWER_MOBILE ${JSON.stringify({ ...vitals, thirdPartyScripts })}`);
  expect(vitals.cls).toBeLessThan(0.1);
  expect(vitals.lcp).toBeGreaterThan(0);
  expect(vitals.lcp).toBeLessThan(4_000);
  expect(thirdPartyScripts).toEqual([]);
  await context.close();
});
