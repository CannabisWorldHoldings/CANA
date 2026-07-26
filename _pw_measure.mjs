import { chromium } from 'playwright';
const VIEWPORT = process.env.PW_VIEWPORT === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));
// Dismiss age gate via localStorage before load
await page.addInitScript(() => {
  try { window.localStorage.setItem('owd:age-attested-at', String(Date.now())); } catch {}
});
const resp = await page.goto('http://orderweeddc.localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('article', { timeout: 20000 });
// If age gate still present, click it
const gate = await page.$('div[role="dialog"][aria-modal="true"]');
if (gate) {
  const btn = await page.$('button:has-text("Yes, I")');
  if (btn) { await btn.click(); await page.waitForTimeout(300); }
}
const data = await page.evaluate(() => {
  const arts = Array.from(document.querySelectorAll('article'));
  const results = arts.map((art, i) => {
    const h2a = art.querySelector('h2 a');
    const name = h2a ? h2a.textContent.trim() : '(no h2)';
    // sponsorship badge span: has data-sponsorship-state
    const badgeEls = Array.from(art.querySelectorAll('[data-sponsorship-state]'));
    const badges = badgeEls.map(el => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // find visible label text
      const labelSpan = Array.from(el.querySelectorAll('span')).find(s => !s.className.includes('sr-only') && s.textContent.trim());
      const srOnly = Array.from(el.querySelectorAll('span.sr-only')).map(s=>s.textContent.trim());
      return {
        state: el.getAttribute('data-sponsorship-state'),
        reason: el.getAttribute('data-sponsorship-reason'),
        hiddenAttr: el.hasAttribute('hidden'),
        display: cs.display, visibility: cs.visibility,
        rectW: Math.round(rect.width), rectH: Math.round(rect.height),
        visibleOnScreen: rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        spendSeq: el.getAttribute('data-sponsorship-spend-seq'),
        entryHash: el.getAttribute('data-sponsorship-entry-hash'),
        placement: el.getAttribute('data-sponsorship-placement'),
        entitlement: el.getAttribute('data-sponsorship-entitlement'),
        affectsOrder: el.getAttribute('data-sponsorship-affects-order'),
        labelText: labelSpan ? labelSpan.textContent.trim() : null,
        srOnly,
        tabbable: el.tabIndex >= 0 || el.querySelector('a,button,[tabindex]') != null,
      };
    });
    // gold ring highlight
    const cls = art.className;
    const hasRing = /ring-brand-gold/.test(cls);
    return { pos: i+1, name, hasRing, badges };
  });
  return { count: arts.length, results };
});
console.log('VIEWPORT', JSON.stringify(VIEWPORT));
console.log('ARTICLE COUNT:', data.count);
for (const r of data.results) {
  console.log(`[${r.pos}] ${r.name}  ring=${r.hasRing}`);
  for (const b of r.badges) {
    console.log(`      badge state=${b.state} visibleOnScreen=${b.visibleOnScreen} display=${b.display} vis=${b.visibility} rect=${b.rectW}x${b.rectH} hiddenAttr=${b.hiddenAttr} label=${JSON.stringify(b.labelText)} srOnly=${JSON.stringify(b.srOnly)} seq=${b.spendSeq} entryHash=${b.entryHash} entitlement=${b.entitlement} affectsOrder=${b.affectsOrder} reason=${JSON.stringify(b.reason)}`);
  }
}
console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors));
await browser.close();
