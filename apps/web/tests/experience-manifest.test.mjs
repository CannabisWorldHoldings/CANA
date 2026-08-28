// EXPERIENCE MANIFEST × FABRIC — the connection court.
//
// These tests exist to prove one measured claim: the Experience Fabric kernel now
// governs real customer-route presentation state, rather than sitting beside the
// application untouched. Each test corresponds to a §6 exit criterion.
//
// The negative cases matter more than the positive one. A seam that can only apply
// changes is a formatter; a seam that can REFUSE a change, leave the page untouched,
// and restore an exact prior address is governance.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  JOURNEY_COPY,
  applyModuleOrder,
  assertManifest,
  buildManifest,
  presentationFor,
} from '../src/lib/experience/manifest.mjs';

import { validateIntentPatch } from '../../../tools/experience-fabric/kernel.mjs';

import {
  applyPresentation,
  manifestAddress,
  openExperience,
  presentationPatch,
  publishPresentation,
} from '../src/lib/experience/fabric.mjs';

const tenant = 'orderweeddc.com';
const base = () => buildManifest({ tenant, journey: 'DISPENSARIES' });

// ---------------------------------------------------------------- shape + purity

test('manifest carries the journey copy that was previously hardcoded in JSX', () => {
  const m = base();
  assertManifest(m);
  assert.equal(m.presentation.copy.title, JOURNEY_COPY.DISPENSARIES.title);
  assert.equal(m.presentation.copy.eyebrow, 'Dispensaries');
  assert.equal(m.presentation.assets.hero, 'marketplace.hero.v2');
});

test('an unknown journey is refused rather than defaulted', () => {
  assert.throws(() => buildManifest({ tenant, journey: 'TELEPORT' }), /MANIFEST_UNKNOWN_JOURNEY/);
});

test('a tenantless manifest is refused — presentation state is tenant-scoped', () => {
  assert.throws(() => buildManifest({ tenant: '  ', journey: 'HOME' }), /MANIFEST_TENANT_REQUIRED/);
});

test('the content address is stable across builds — rollback depends on it', () => {
  // If the address moved with wall-clock time, an exact rollback could never be verified.
  assert.equal(manifestAddress(base()), manifestAddress(base()));
});

test('economics stay UNKNOWN — a manifest cannot assert revenue into existence', () => {
  const m = base();
  m.economics.state = 'PROVEN';
  assert.throws(() => assertManifest(m), /economics must remain UNKNOWN/);
});

// ---------------------------------------------------------------- the round trip

test('E3: an admitted patch changes the rendered presentation and its address', () => {
  const before = base();
  const beforeAddr = manifestAddress(before);

  const patch = presentationPatch({
    goal: 'lead with availability language for a mobile customer',
    scope: 'hero',
    agent: 'test:connection-court',
    mutation: { 'presentation.copy.title': 'Open now, verified today.' },
  });

  const result = applyPresentation(before, patch);
  assert.equal(result.admitted, true, 'a legal presentation mutation must be admitted');
  assert.equal(result.court.verdict, 'PASS');
  assert.equal(result.manifest.presentation.copy.title, 'Open now, verified today.');
  assert.notEqual(manifestAddress(result.manifest), beforeAddr, 'a real change must move the address');
});

test('E4: a refused patch leaves the experience byte-identical', () => {
  const before = base();
  const beforeAddr = manifestAddress(before);

  // Protected path: merchant identity is not a presentation surface. This must be
  // refused by the kernel's own PROTECTED_PATHS list, not merely by our write set —
  // so the refusal survives a future caller widening the declared surface.
  assert.throws(
    () => presentationPatch({
      goal: 'reassign the merchant',
      scope: 'hero',
      agent: 'test:connection-court',
      mutation: { 'merchant.identity.tenant': 'someone-else.com' },
    }),
    /PROTECTED_PATH/,
    'cross-tenant rewriting must be refused by the kernel path list itself',
  );

  // Even with a deliberately over-broad write set, the protected path still refuses.
  assert.throws(
    () => validateIntentPatch({
      goal: 'widen the surface and then reassign the merchant',
      scope: 'hero',
      agent: 'test:connection-court',
      risk: 'R1',
      write_set: ['merchant.*'],
      mutation: { 'merchant.identity.tenant': 'someone-else.com' },
    }),
    /PROTECTED_PATH/,
    'widening the write set must not unlock merchant identity',
  );

  // Escape attempt: a path outside the fixed presentation write set.
  assert.throws(
    () => presentationPatch({
      goal: 'sneak outside the declared surface',
      scope: 'hero',
      agent: 'test:connection-court',
      mutation: { 'manifestVersion': 2 },
    }),
    /WRITE_SET_ESCAPE/,
  );

  assert.equal(manifestAddress(before), beforeAddr, 'the input manifest must be untouched');
});

test('an anonymous mutation is refused — attribution is not optional', () => {
  assert.throws(
    () => presentationPatch({
      goal: 'change the title',
      scope: 'hero',
      agent: '',
      mutation: { 'presentation.copy.title': 'x' },
    }),
    /PATCH_FIELD/,
  );
});

test('publishing requires explicit merchant approval — an agent cannot ship alone', () => {
  const before = base();
  const patch = presentationPatch({
    goal: 'compact the page for a dense viewport',
    scope: 'density',
    agent: 'test:connection-court',
    mutation: { 'presentation.density': 'compact' },
  });
  const result = applyPresentation(before, patch);
  assert.equal(result.admitted, true);

  // The private mutation must NOT have moved HEAD.
  assert.equal(result.session.head, result.rollbackTo, 'preview must not publish');

  // Promotion without approval is refused.
  assert.throws(() => result.session.promote(result.candidate), /APPROVAL_REQUIRED/);

  // With approval it publishes, and HEAD moves to the candidate.
  const { head } = publishPresentation(result, 'orderweeddc-owner');
  assert.equal(head, result.candidate);
});

test('E5: exact rollback restores the byte-identical prior state', () => {
  const before = base();
  const beforeAddr = manifestAddress(before);

  const patch = presentationPatch({
    goal: 'reorder the page',
    scope: 'modules',
    agent: 'test:connection-court',
    mutation: { 'presentation.moduleOrder': ['deals', 'dispensaries'] },
  });

  const result = applyPresentation(before, patch);
  publishPresentation(result, 'orderweeddc-owner');
  assert.notEqual(result.session.head, beforeAddr, 'head moved on publish');

  result.session.rollback(beforeAddr);
  assert.equal(result.session.head, beforeAddr, 'head restored to the exact prior address');

  const restored = result.session.current();
  assert.equal(manifestAddress(restored), beforeAddr, 'restored state is byte-identical');
  assert.deepEqual(restored.presentation.moduleOrder, []);
});

test('the receipt chain verifies after a full mutate → publish → rollback cycle', () => {
  const before = base();
  const patch = presentationPatch({
    goal: 'swap the hero asset',
    scope: 'hero',
    agent: 'test:connection-court',
    mutation: { 'presentation.assets.hero': 'marketplace.hero.v3' },
  });
  const result = applyPresentation(before, patch);
  publishPresentation(result, 'orderweeddc-owner');
  result.session.rollback(result.rollbackTo);
  assert.equal(result.session.verifyReceipts().valid, true);
});

// ---------------------------------------------------------------- module ordering

test('module order never drops a module it did not mention', () => {
  const modules = [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }];
  const out = applyModuleOrder(modules, ['c']);
  assert.deepEqual(out.map((m) => m.kind), ['c', 'a', 'b']);
  assert.equal(out.length, modules.length, 'silently losing a module is a truth failure');
});

test('an empty order preserves the data layer ordering exactly', () => {
  const modules = [{ kind: 'a' }, { kind: 'b' }];
  assert.deepEqual(applyModuleOrder(modules, []).map((m) => m.kind), ['a', 'b']);
});

// ---------------------------------------------------------------- adoption seam

test('presentationFor falls back to a built manifest, not scattered defaults', () => {
  const viaManifest = presentationFor(base(), { tenant, journey: 'DISPENSARIES' });
  const viaFallback = presentationFor(null, { tenant, journey: 'DISPENSARIES' });
  assert.deepEqual(viaFallback, viaManifest, 'one source of presentation during incremental adoption');
});

test('presentationFor refuses a malformed manifest instead of silently falling back', () => {
  const broken = base();
  delete broken.presentation.copy;
  assert.throws(() => presentationFor(broken, { tenant, journey: 'HOME' }), /MANIFEST_INVALID/);
});

// ---------------------------------------------------------------- the measured claim

test('E1: the application imports the Experience Fabric kernel', async () => {
  const fabric = await import('../src/lib/experience/fabric.mjs');
  assert.equal(typeof fabric.applyPresentation, 'function');
  const session = openExperience(base());
  assert.equal(typeof session.head, 'string');
  assert.match(session.head, /^xs_/, 'head is a kernel content address');
});
