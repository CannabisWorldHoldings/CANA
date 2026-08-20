// EXPERIENCE FABRIC courts — the safe workshop must default-deny, protect
// market truth, quarantine same-fact conflicts, gate promotion on approval,
// roll back exactly, and survive a sustained mutation assault.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExperienceFabric, FabricError, analyzeConflict, runOracles,
  stateAddress, validateIntentPatch,
} from './kernel.mjs';

const baseState = () => ({
  merchant: { id: 'meridian-house-demo', identity: 'Meridian House (Demo)', brand: { green: '#22582f' } },
  inventory: { 'blue-dream-3.5': { units: 18, binding: 'canonical' } },
  fulfillment: { verified_availability: { 'blue-dream-3.5': 'IN_STOCK_VERIFIED' } },
  contract: { accessibility: { min_contrast: 4.5, focus_visible: true, reduced_motion: true } },
  economics: { conversion: 'UNKNOWN', revenue: 'UNKNOWN' },
  design: {
    components: {
      hero: { variant: 'editorial', headline_scale: 64 },
      productRail: { variant: 'balanced', peek: true },
      fulfillmentPanel: { variant: 'honest_coverage' },
    },
  },
});

const heroPatch = (over = {}) => ({
  goal: 'visual_premium', scope: 'hero', risk: 'R2', agent: 'hermes-visual-architect',
  write_set: ['design.components.hero.*'],
  mutation: { 'design.components.hero.variant': 'cinematic' },
  ...over,
});

test('intent patches fail closed: undeclared writes, protected paths, anonymous agents all refused', () => {
  assert.equal(validateIntentPatch(heroPatch()), true);
  assert.throws(() => validateIntentPatch(heroPatch({ mutation: { 'design.components.productRail.variant': 'x' } })), /WRITE_SET_ESCAPE/);
  assert.throws(() => validateIntentPatch(heroPatch({ write_set: ['merchant.identity'] })), /PROTECTED_PATH/);
  assert.throws(() => validateIntentPatch(heroPatch({ mutation: { 'inventory.blue-dream-3.5.units': 999 } })), /PROTECTED_PATH|WRITE_SET_ESCAPE/);
  assert.throws(() => validateIntentPatch(heroPatch({ agent: '' })), /PATCH_FIELD/);
  assert.throws(() => validateIntentPatch(heroPatch({ risk: 'R9' })), /PATCH_RISK/);
});

test('a lawful private mutation passes the oracle court and never moves the head by itself', () => {
  const fabric = new ExperienceFabric(baseState());
  const head0 = fabric.head;
  const { candidate, court } = fabric.mutatePrivate(heroPatch());
  assert.equal(court.verdict, 'PASS');
  assert.ok(candidate);
  assert.equal(fabric.head, head0, 'private mutation does not publish');
  assert.equal(fabric.current().design.components.hero.variant, 'editorial', 'live experience unchanged');
});

test('oracles catch identity theft, truth mutation, a11y loss, and economic wishful thinking', () => {
  const before = baseState();
  // identity theft via a sneaky after-state
  const stolen = JSON.parse(JSON.stringify(before)); stolen.merchant.identity = 'ORDERWEEDDC House Brand';
  assert.equal(runOracles(before, stolen, heroPatch()).results.find((r) => r.oracle === 'BRAND').status, 'FAIL');
  // availability mutation
  const lied = JSON.parse(JSON.stringify(before)); lied.fulfillment.verified_availability['blue-dream-3.5'] = 'IN_STOCK_VERIFIED_FOREVER';
  assert.equal(runOracles(before, lied, heroPatch()).results.find((r) => r.oracle === 'DATA-TRUTH').status, 'FAIL');
  // accessibility stripped
  const inaccessible = JSON.parse(JSON.stringify(before)); inaccessible.contract.accessibility.focus_visible = false;
  assert.equal(runOracles(before, inaccessible, heroPatch()).results.find((r) => r.oracle === 'ACCESSIBILITY').status, 'FAIL');
  // economics asserted
  const wishful = JSON.parse(JSON.stringify(before)); wishful.economics.revenue = '+18%';
  assert.equal(runOracles(before, wishful, heroPatch()).results.find((r) => r.oracle === 'ECONOMIC-TRUTH').status, 'FAIL');
});

test('conflict court: disjoint writes merge-safe; same fact with different values quarantines', () => {
  const railPatch = {
    goal: 'commerce_first', scope: 'product_rail', risk: 'R2', agent: 'hermes-commerce',
    write_set: ['design.components.productRail.*'],
    mutation: { 'design.components.productRail.variant': 'product_first' },
  };
  const disjoint = analyzeConflict(heroPatch(), railPatch);
  assert.equal(disjoint.relation, 'STRUCTURAL_DISJOINT');
  assert.equal(disjoint.quarantine, false);

  const rival = heroPatch({ agent: 'hermes-minimalist', mutation: { 'design.components.hero.variant': 'minimal' } });
  const clash = analyzeConflict(heroPatch(), rival);
  assert.equal(clash.relation, 'SAME_FACT');
  assert.equal(clash.quarantine, true, 'the kernel never silently picks a winner');

  const idempotent = analyzeConflict(heroPatch(), heroPatch({ agent: 'other' }));
  assert.equal(idempotent.relation, 'SAME_FACT');
  assert.equal(idempotent.quarantine, false, 'identical value overlap is idempotent, not a fight');
});

test('promotion is refused without merchant approval; approved promotion moves the head; rollback is exact', () => {
  const fabric = new ExperienceFabric(baseState());
  const origin = fabric.head;
  const { candidate } = fabric.mutatePrivate(heroPatch());
  assert.throws(() => fabric.promote(candidate), /APPROVAL_REQUIRED/);
  fabric.approve(candidate, { merchant: 'meridian-house-demo' });
  const promo = fabric.promote(candidate);
  assert.equal(promo.head, candidate);
  assert.equal(fabric.current().design.components.hero.variant, 'cinematic');
  const back = fabric.rollback(origin);
  assert.equal(back.head, origin);
  assert.equal(fabric.current().design.components.hero.variant, 'editorial', 'exact state restored by content address');
  assert.equal(fabric.verifyReceipts().valid, true);
});

test('receipts are proof-carrying and tamper-evident', () => {
  const fabric = new ExperienceFabric(baseState());
  fabric.mutatePrivate(heroPatch());
  assert.equal(fabric.verifyReceipts().valid, true);
  fabric.receipts[0].goal = 'rewritten_history';
  assert.equal(fabric.verifyReceipts().valid, false, 'a rewritten receipt breaks the chain');
});

test('sustained assault: 300 sequential lawful mutations across three families preserve every invariant', () => {
  const fabric = new ExperienceFabric(baseState());
  const families = [
    (i) => heroPatch({ mutation: { 'design.components.hero.variant': `style_${i % 7}`, 'design.components.hero.headline_scale': 48 + (i % 5) * 8 } , write_set: ['design.components.hero.*']}),
    (i) => ({ goal: 'rail_tune', scope: 'product_rail', risk: 'R1', agent: 'hermes-commerce', write_set: ['design.components.productRail.*'], mutation: { 'design.components.productRail.variant': `rail_${i % 5}` } }),
    (i) => ({ goal: 'fulfillment_clarity', scope: 'fulfillment', risk: 'R1', agent: 'hermes-ops', write_set: ['design.components.fulfillmentPanel.*'], mutation: { 'design.components.fulfillmentPanel.variant': `cov_${i % 3}` } }),
  ];
  let passes = 0;
  for (let i = 0; i < 300; i += 1) {
    const { court, candidate } = fabric.mutatePrivate(families[i % 3](i));
    if (court.verdict === 'PASS' && candidate) passes += 1;
    const s = fabric.states.get(candidate);
    assert.equal(s.merchant.identity, 'Meridian House (Demo)');
    assert.equal(s.inventory['blue-dream-3.5'].units, 18);
    assert.equal(s.fulfillment.verified_availability['blue-dream-3.5'], 'IN_STOCK_VERIFIED');
    assert.equal(s.contract.accessibility.min_contrast, 4.5);
    assert.equal(s.economics.conversion, 'UNKNOWN');
    assert.equal(s.economics.revenue, 'UNKNOWN');
  }
  assert.equal(passes, 300, 'all 300 lawful mutations pass while every invariant holds');
  assert.equal(fabric.verifyReceipts().valid, true);
  assert.equal(fabric.verifyReceipts().count, 300);
});

test('the assault court also proves the negative: one unlawful mutation in the stream is refused', () => {
  const fabric = new ExperienceFabric(baseState());
  fabric.mutatePrivate(heroPatch());
  assert.throws(() => fabric.mutatePrivate(heroPatch({
    write_set: ['design.components.hero.*', 'fulfillment.verified_availability.blue-dream-3.5'],
  })), /PROTECTED_PATH/);
  assert.throws(() => fabric.mutatePrivate({
    goal: 'sneak', scope: 'hero', risk: 'R2', agent: 'rogue',
    write_set: ['design.components.hero.*'],
    mutation: { 'design.components.hero.variant': 'x', 'merchant.identity': 'stolen' },
  }), /PROTECTED_PATH/);
});
