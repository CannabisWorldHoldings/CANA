import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDiscoveryCommand, DISCOVERY_CATEGORIES, removeChipFromCommand } from '../src/lib/discovery-command.mjs';

/**
 * The Universal Discovery Command — owner-approved mechanism (Where's Weed
 * dev-v4 focused launcher, FOCUSED_DISCOVERY_MODE_APPROVED) exceeded:
 * natural-language intent compiles into the SAME structured chips the
 * launcher exposes (category, business type, location, radius, time, price),
 * deterministically, with explicit assumptions and zero hallucination —
 * unknown words stay in the free-text query; nothing is invented.
 */

const NOW = '2026-08-08T19:36:00-04:00'; // Saturday evening ET

test('owner example: "flower delivered near Navy Yard tonight"', () => {
  const c = compileDiscoveryCommand('flower delivered near Navy Yard tonight', { now: NOW });
  assert.equal(c.category, 'flower');
  assert.equal(c.business_type, 'delivery');
  assert.equal(c.location.kind, 'NEIGHBORHOOD');
  assert.equal(c.location.name, 'Navy Yard');
  assert.equal(c.time.kind, 'TONIGHT');
  assert.ok(c.time.until.includes('T'), 'tonight resolves to a concrete window end');
  assert.equal(c.query_text, '', 'fully compiled — nothing left unparsed');
  assert.ok(c.assumptions.length > 0);
});

test('owner example: "edibles around Dupont under $50"', () => {
  const c = compileDiscoveryCommand('edibles around Dupont under $50', { now: NOW });
  assert.equal(c.category, 'edibles');
  assert.equal(c.location.name, 'Dupont Circle');
  assert.equal(c.price_cap, 50);
  assert.equal(c.business_type, null, 'no business type stated — both remain eligible');
});

test('owner example: "show dispensaries open near me"', () => {
  const c = compileDiscoveryCommand('show dispensaries open near me', { now: NOW });
  assert.equal(c.business_type, 'dispensary');
  assert.equal(c.location.kind, 'CURRENT_LOCATION');
  assert.equal(c.time.kind, 'OPEN_NOW');
});

test('owner example: "Blue Dream around Adams Morgan" — unknown strain stays honest', () => {
  const c = compileDiscoveryCommand('Blue Dream around Adams Morgan', { now: NOW });
  assert.equal(c.location.name, 'Adams Morgan');
  // strain graph is future work: the term is preserved as query text, never dropped, never faked
  assert.equal(c.query_text, 'blue dream');
  assert.ok(c.assumptions.some((a) => /free-text/.test(a)));
});

test('owner example: "best current deals near Georgetown"', () => {
  const c = compileDiscoveryCommand('best current deals near Georgetown', { now: NOW });
  assert.equal(c.wants_deals, true);
  assert.equal(c.location.name, 'Georgetown');
});

test('radius phrases compile ("within 10 miles of Petworth")', () => {
  const c = compileDiscoveryCommand('vapes within 10 miles of Petworth', { now: NOW });
  assert.equal(c.category, 'vapes');
  assert.equal(c.radius_miles, 10);
  assert.equal(c.location.name, 'Petworth');
});

test('chips mirror the launcher controls and stay editable', () => {
  const c = compileDiscoveryCommand('flower delivered near Navy Yard tonight', { now: NOW });
  const kinds = c.chips.map((chip) => chip.kind);
  assert.deepEqual(kinds, ['CATEGORY', 'BUSINESS_TYPE', 'LOCATION', 'TIME']);
  assert.ok(c.chips.every((chip) => chip.editable === true));
  assert.ok(c.chips.every((chip) => typeof chip.label === 'string' && chip.label.length > 0));
});

test('verified-truth is the default lens, surfaced as an assumption not a hidden filter', () => {
  const c = compileDiscoveryCommand('edibles near Shaw', { now: NOW });
  assert.equal(c.verified_only, true);
  assert.ok(c.assumptions.some((a) => /licensed|verified/i.test(a)));
});

test('nothing is hallucinated: gibberish compiles to pure free-text with no invented constraints', () => {
  const c = compileDiscoveryCommand('zorplex quantum garden', { now: NOW });
  assert.equal(c.category, null);
  assert.equal(c.business_type, null);
  assert.equal(c.location.kind, 'MARKET_DEFAULT');
  assert.equal(c.query_text, 'zorplex quantum garden');
});

test('category vocabulary matches the marketplace taxonomy', () => {
  for (const cat of ['flower', 'edibles', 'vapes', 'concentrates', 'prerolls']) {
    assert.ok(DISCOVERY_CATEGORIES.includes(cat), cat);
  }
});

test('deterministic: same input same output', () => {
  const a = compileDiscoveryCommand('edibles around Dupont under $50', { now: NOW });
  const b = compileDiscoveryCommand('edibles around Dupont under $50', { now: NOW });
  assert.deepEqual(a, b);
});

/**
 * Law 5 — REMOVAL IS HONEST (owner-courted MM-004 repair, pixels O1/O3/O8):
 * dismissing a chip edits the customer's own words and recompiles. No hidden
 * state mutation. Defaults are not removable because they were never the
 * customer's constraint.
 */

const chipOf = (c, kind) => c.chips.find((chip) => chip.kind === kind);

test('law 5: every customer-stated chip carries removal_sources; the market default carries null', () => {
  const c = compileDiscoveryCommand('flower delivered near Navy Yard tonight under $60 within 5 miles', { now: NOW });
  for (const kind of ['CATEGORY', 'BUSINESS_TYPE', 'TIME', 'PRICE', 'RADIUS', 'LOCATION']) {
    assert.ok(chipOf(c, kind), `${kind} chip present`);
  }
  for (const chip of c.chips) {
    if (chip.kind === 'LOCATION' && c.location.kind === 'MARKET_DEFAULT') continue;
    assert.ok(Array.isArray(chip.removal_sources) && chip.removal_sources.length > 0, `${chip.kind} removable`);
  }
  const def = compileDiscoveryCommand('flower', { now: NOW });
  assert.equal(chipOf(def, 'LOCATION').removal_sources, null, 'market default is not the customer\'s constraint');
});

test('law 5: removing the category chip keeps every other constraint intact', () => {
  const text = 'flower delivered near Navy Yard tonight';
  const c = compileDiscoveryCommand(text, { now: NOW });
  const after = compileDiscoveryCommand(removeChipFromCommand(text, chipOf(c, 'CATEGORY')), { now: NOW });
  assert.equal(after.category, null);
  assert.equal(after.business_type, 'delivery');
  assert.equal(after.location.name, 'Navy Yard');
  assert.equal(after.time.kind, 'TONIGHT');
});

test('law 5: removing the location chip strips the neighborhood AND its glue word', () => {
  const text = 'edibles around Dupont under $50';
  const c = compileDiscoveryCommand(text, { now: NOW });
  const next = removeChipFromCommand(text, chipOf(c, 'LOCATION'));
  assert.ok(!/around/i.test(next), 'glue word removed with its neighborhood');
  const after = compileDiscoveryCommand(next, { now: NOW });
  assert.equal(after.location.kind, 'MARKET_DEFAULT');
  assert.equal(after.category, 'edibles');
  assert.equal(after.price_cap, 50);
});

test('law 5: removing the deals chip strips deals + best/current, keeps the neighborhood', () => {
  const text = 'best current deals near Georgetown';
  const c = compileDiscoveryCommand(text, { now: NOW });
  assert.ok(chipOf(c, 'DEALS'), 'deals intent surfaces as a chip');
  const after = compileDiscoveryCommand(removeChipFromCommand(text, chipOf(c, 'DEALS')), { now: NOW });
  assert.equal(after.wants_deals, false);
  assert.equal(after.location.name, 'Georgetown');
});

test('law 5: free text surfaces as a QUERY chip and its removal drops only the unrecognized words', () => {
  const text = 'Blue Dream around Adams Morgan';
  const c = compileDiscoveryCommand(text, { now: NOW });
  const q = chipOf(c, 'QUERY');
  assert.equal(q.label, 'blue dream');
  const after = compileDiscoveryCommand(removeChipFromCommand(text, q), { now: NOW });
  assert.equal(after.query_text, '');
  assert.equal(after.location.name, 'Adams Morgan');
});

test('law 5: removal is pure and deterministic; a default chip returns the text unchanged', () => {
  const text = 'flower near me';
  const c = compileDiscoveryCommand(text, { now: NOW });
  const loc = chipOf(c, 'LOCATION');
  assert.equal(removeChipFromCommand(text, loc), removeChipFromCommand(text, loc));
  const def = compileDiscoveryCommand('flower', { now: NOW });
  assert.equal(removeChipFromCommand('flower', chipOf(def, 'LOCATION')), 'flower');
});
