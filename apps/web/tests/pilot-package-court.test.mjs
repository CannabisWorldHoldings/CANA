import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/**
 * PILOT PACKAGE COURT — the document must match the running system.
 *
 * A merchant-facing package is a set of PROMISES. If it claims a cap the ledger does
 * not enforce, an action type the enum does not contain, or a privacy boundary the
 * code does not keep, then it is worse than no document: it is a written commitment
 * we would breach on first contact, and nobody would notice until a merchant did.
 *
 * So this suite reads the package as DATA and checks each claim against the actual
 * exported constants and behaviour. When the code changes, the document fails here
 * rather than quietly becoming a lie.
 */

const PKG = '/agent/workspace/deliverables/MERCHANT_PILOT_PACKAGE_V1.md';
const doc = existsSync(PKG) ? readFileSync(PKG, 'utf8') : null;

test('the package exists and is readable', () => {
  assert.ok(doc, `the pilot package must exist at ${PKG}`);
  assert.ok(doc.length > 4000, 'a package this thin could not cover 16 required sections');
});

test('all 16 required sections are present', () => {
  const required = [
    'Merchant eligibility and truth audit',
    'Visibility and menu-data baseline',
    'Exact sponsored-credit authorization contract',
    'Credit issuance and expiration rules',
    'Sponsored-placement disclosure rules',
    'Organic-order non-interference proof',
    'Approved attribution action types',
    'Evidence-grade requirements per action',
    'Merchant-facing report schema',
    'Withheld-value explanations',
    'Refund, rollback and dispute handling',
    'Pilot success and failure thresholds',
    'Data retention and privacy boundaries',
    'Operator runbook',
    'Independent verification checklist',
    'Owner approval form',
  ];
  for (const s of required) {
    assert.ok(doc.includes(s), `missing required section: ${s}`);
  }
});

test('IT IS NOT AUTHORIZED — and says so unmissably', () => {
  // The single most important property. A package that reads as approved is an
  // invitation to act on it.
  assert.match(doc, /PREPARED, NOT SENT\. NOT AUTHORIZED\./);
  assert.match(doc, /No line above is signed\. Nothing in this package is authorized\./);
  assert.ok(!/\[x\]/i.test(doc), 'no approval checkbox may be pre-ticked');
  // Every owner-gated line must still be an empty checkbox.
  const boxes = doc.match(/^\[ \] /gm) ?? [];
  assert.ok(boxes.length >= 7, `expected the 7 owner authorizations unsigned, found ${boxes.length}`);
});

test('the ACTION TYPES it approves are exactly the enum the ledger enforces', async () => {
  const { ACTION_KINDS } = await import('../src/lib/demand-credits.mjs');
  for (const k of ACTION_KINDS) {
    assert.ok(doc.includes(k), `the package omits a real action kind: ${k}`);
  }
  // And it must not invent one the ledger would refuse.
  const claimed = [...doc.matchAll(/`([A-Z][A-Z_]{4,})`/g)].map((m) => m[1]);
  const actionish = claimed.filter((c) => /_(VIEW|CLICK)$|^HANDOFF$/.test(c));
  for (const c of new Set(actionish)) {
    assert.ok(ACTION_KINDS.includes(c), `the package claims an action the ledger does not accept: ${c}`);
  }
});

test('the PLACEMENTS it lists are exactly the enum the ledger enforces', async () => {
  const { PLACEMENT_KINDS } = await import('../src/lib/demand-credits.mjs');
  for (const p of PLACEMENT_KINDS) {
    assert.ok(doc.includes(p), `the package omits a real placement: ${p}`);
  }
});

test('the CAPS it states are the caps the ledger actually enforces', async () => {
  const { MAX_ENTRY_AMOUNT, MAX_MERCHANT_BALANCE } = await import('../src/lib/demand-credits.mjs');
  const withCommas = (n) => n.toLocaleString('en-US');
  assert.ok(doc.includes(withCommas(MAX_ENTRY_AMOUNT)),
    `package must state the real MAX_ENTRY_AMOUNT ${withCommas(MAX_ENTRY_AMOUNT)}`);
  assert.ok(doc.includes(withCommas(MAX_MERCHANT_BALANCE)),
    `package must state the real MAX_MERCHANT_BALANCE ${withCommas(MAX_MERCHANT_BALANCE)}`);
});

test('the EVIDENCE GRADES it promises are the states the code can produce', async () => {
  const { PAGE_PROOF_STATES, PAGE_VALUE_ELIGIBLE, pageStateContributesToValue } =
    await import('../src/lib/page-challenge.mjs');
  for (const s of PAGE_PROOF_STATES) {
    assert.ok(doc.includes(s), `the package omits a real proof state: ${s}`);
  }
  // The value-eligibility table must match the code exactly, in both directions.
  for (const s of PAGE_PROOF_STATES) {
    const eligible = pageStateContributesToValue(s);
    const row = doc.split('\n').find((l) => l.includes(`\`${s}\``) && l.includes('|'));
    if (!row) continue;
    if (eligible) {
      assert.ok(/\|\s*Yes\s*\|?\s*$/.test(row.trimEnd()),
        `${s} IS value-eligible in code but the package row does not say Yes: ${row.trim()}`);
    } else {
      assert.ok(/\*\*No\*\*|unreachable/.test(row),
        `${s} is NOT value-eligible in code but the package row does not say No: ${row.trim()}`);
    }
  }
  assert.deepEqual([...PAGE_VALUE_ELIGIBLE].sort(),
    ['MERCHANT_HANDOFF_VERIFIED', 'PAGE_INTERACTION_VERIFIED']);
});

test('the PRIVACY boundaries it promises are the ones the code keeps', async () => {
  const { PAGE_PRIVACY_CONTRACT, CHALLENGE_TTL_MS } = await import('../src/lib/page-challenge.mjs');
  const { IDENTITY_WINDOW_MS } = await import('../src/lib/demand-credits.mjs');
  assert.equal(PAGE_PRIVACY_CONTRACT.ip_address_used, false);
  assert.equal(PAGE_PRIVACY_CONTRACT.user_agent_used, false);
  assert.equal(PAGE_PRIVACY_CONTRACT.durable_user_identifier, false);
  assert.match(doc, /No IP address, no user agent, no fingerprinting, no durable user identifier/i);
  // The stated TTLs must be the real ones.
  assert.ok(doc.includes(`**${CHALLENGE_TTL_MS / 60_000} minutes**`),
    `the package must state the real challenge TTL of ${CHALLENGE_TTL_MS / 60_000} minutes`);
  assert.ok(doc.includes(`**${IDENTITY_WINDOW_MS / 60_000} minutes**`),
    `the package must state the real identity window of ${IDENTITY_WINDOW_MS / 60_000} minutes`);
});

test('the NOT_CLAIMED list it publishes matches what the code disclaims', async () => {
  const { NOT_CLAIMED } = await import('../src/lib/growth-os.mjs');
  for (const k of NOT_CLAIMED) {
    assert.ok(doc.toLowerCase().includes(k.toLowerCase()),
      `the package must disclaim ${k}, as the code does`);
  }
});

test('the REPORT SCHEMA it documents matches the fields the code emits', async () => {
  const { buildGrowthView } = await import('../src/lib/growth-os.mjs');
  const view = buildGrowthView({
    retailer: { id: 'm1', name: 'X', dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    ledger: [], audit: { score: 50, counts: {}, top_actions: [] },
  });
  for (const k of ['truth_label', 'visibility', 'priority_actions', 'attribution',
                   'proof_of_value', 'proof_of_value_blockers', 'not_claimed', 'disclaimer']) {
    assert.ok(k in view, `the code should emit ${k}`);
    assert.ok(doc.includes(k), `the package schema omits an emitted field: ${k}`);
  }
  for (const k of Object.keys(view.attribution)) {
    assert.ok(doc.includes(k), `the package omits an attribution counter the code emits: ${k}`);
  }
});

test('the WITHHELD blockers it quotes are the strings the code produces', async () => {
  const { buildGrowthView } = await import('../src/lib/growth-os.mjs');
  const view = buildGrowthView({
    retailer: { id: 'm1', name: 'X', dataStatus: 'VERIFIED_CURRENT', isDemonstration: false },
    ledger: [],
  });
  for (const b of view.proof_of_value_blockers) {
    assert.ok(doc.includes(b), `the package quotes a blocker the code does not emit, or omits: "${b}"`);
  }
});

test('the METRIC LADDER never promotes an unestablished metric', () => {
  // The distinction that must never collapse.
  const ladder = doc.slice(doc.indexOf('Metric ladder'));
  for (const m of ['Order intent', 'Confirmed order', 'Commercial outcome', 'Revenue']) {
    const row = ladder.split('\n').find((l) => l.startsWith(`| ${m}`));
    assert.ok(row, `the ladder must list ${m}`);
    assert.match(row, /\*\*No\*\*/, `${m} is NOT established and the ladder must say so: ${row}`);
  }
  for (const m of ['Interaction', 'Application handoff', 'Merchant handoff']) {
    const row = ladder.split('\n').find((l) => l.startsWith(`| ${m}`));
    assert.match(row, /\*\*Yes\*\*/, `${m} IS established and the ladder should say so: ${row}`);
  }
  assert.match(ladder, /never silently promoted/i);
});

test('it does not claim revenue, rankings, or proven humans anywhere', () => {
  // Strip the tables and lists that legitimately NAME these things in order to
  // disclaim them, then check the prose makes no positive claim.
  const prose = doc
    .replace(/\| *(No|Yes)[^\n]*/g, '')
    .replace(/not_claimed[^\n]*/g, '')
    .replace(/Explicitly NOT[^\n]*/g, '');
  assert.ok(!/\b(will increase|guaranteed|proven ROI|drives revenue|more customers)\b/i.test(prose),
    'the package must promise no commercial outcome');
  assert.ok(!/proves a human|verified human|real person/i.test(doc),
    'nothing here may claim personhood');
  assert.match(doc, /None of these prove personhood/i);
  assert.match(doc, /scripted browser can render a page/i);
});

test('it states the tampering limit honestly rather than implying tamper-proofing', async () => {
  assert.match(doc, /wholesale re-signed chain.*cannot be detected without an external anchor/is);
  assert.match(doc, /That anchor does not exist yet/i);
});

test('ONLY HANDOFF is billable in this pilot, and the package says why', () => {
  // Assert the CLAIM, not one markdown spelling of it. My first version demanded
  // backticks inside the bold markers; the document emphasises the word either way
  // and the meaning is identical. A court that fails on formatting teaches people
  // to edit the court instead of the document.
  assert.match(doc, /only\s+\*\*`?HANDOFF`?\*\*\s+is value-eligible/i);
  // Markdown wraps prose, so a phrase can straddle a newline. Match across
  // whitespace rather than demanding the sentence sit on one line.
  // Collapse whitespace before matching. Markdown wraps prose at arbitrary points,
  // so guessing WHERE the break falls is exactly as brittle as demanding one line —
  // I got that wrong once already by splitting at the wrong word.
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /may not be billed against or reported as value/i);
});
