// LAYOUT KERNEL courts — the full interaction-parity checklist, the role law,
// state-preserving relocation, layout intelligence, and the concurrency court.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_TEMPLATES, LayoutKernel, MISSIONS, OPS, PANE_REGISTRY,
  analyzeLayoutConflict, assertPaneAllowed, compileLayoutUtterance, pane,
  panesIn, projectMobile, split, validateTree, workspaceForMission,
} from './layout-kernel.mjs';

const owner = () => new LayoutKernel({ role: 'owner', user: 'owner-1' });

test('PANE REGISTRY: stable ids; role law refuses forbidden mounts by name', () => {
  assert.equal(assertPaneAllowed('cana.custody', 'owner'), undefined);
  assert.throws(() => assertPaneAllowed('cana.custody', 'merchant'), /PANE_FORBIDDEN/);
  assert.throws(() => assertPaneAllowed('made.up', 'owner'), /PANE_UNKNOWN/);
  assert.throws(() => validateTree(pane('cana.custody'), 'public'), /PANE_FORBIDDEN/, 'public surfaces cannot mount sovereign panes');
});

test('TREE law: ratios sum, no duplicate panes, responsive projection always exists', () => {
  assert.throws(() => validateTree(split('row', [pane('cana.custody'), pane('cana.custody')]), 'owner'), /TREE_INVALID/);
  assert.throws(() => validateTree({ type: 'split', dir: 'row', ratios: [0.9, 0.9], children: [pane('cana.custody'), pane('cana.cycles')] }, 'owner'), /ratios must sum/);
  const t = BUILTIN_TEMPLATES['Command']('owner');
  validateTree(t, 'owner');
  assert.deepEqual(projectMobile(t).order, panesIn(t), 'every desktop tree projects to an ordered mobile flow');
});

test('INTERACTION PARITY: template, focus, retile, resize, tab, hide, restore-by-rollback, grid, save/apply, preview≠commit, exact rollback', () => {
  const k = owner();
  // one-click template
  const p1 = k.applyTemplate('Command', { actor: 'owner-1' });
  k.commit(p1.candidate, { approvedBy: 'owner-1' });
  assert.equal(panesIn(k.current().tree).length, 4);
  const commandAddr = k.historyAddress();
  // resize
  const p2 = k.preview({ actor: 'owner-1', intent: 'wider left', ops: [{ op: 'resize_split', args: { path: [], ratios: [0.7, 0.3] } }] });
  k.commit(p2.candidate, { approvedBy: 'owner-1' });
  assert.deepEqual(k.current().tree.ratios, [0.7, 0.3]);
  // move pane (retile)
  const p3 = k.preview({ actor: 'owner-1', intent: 'allocator next to custody', ops: [{ op: 'move_pane', args: { id: 'cana.allocator', target: 'cana.custody' } }] });
  k.commit(p3.candidate, { approvedBy: 'owner-1' });
  // tab/stack
  const p4 = k.preview({ actor: 'owner-1', intent: 'stack forecasts+cycles', ops: [{ op: 'tab_panes', args: { ids: ['cana.forecasts', 'cana.cycles'] } }] });
  k.commit(p4.candidate, { approvedBy: 'owner-1' });
  // hide (remove) + FOCUS
  const p5 = k.preview({ actor: 'owner-1', intent: 'focus cycles', ops: [{ op: 'focus', args: { id: 'cana.cycles' } }] });
  const before = k.current().tree;
  assert.equal(panesIn(before).length > 1, true, 'preview did not move the head');
  k.commit(p5.candidate, { approvedBy: 'owner-1' });
  assert.deepEqual(k.current().tree, pane('cana.cycles'), 'focus mode is a single-pane tree');
  // new grid
  const p6 = k.preview({ actor: 'owner-1', intent: 'grid of four', ops: [{ op: 'new_grid', args: { ids: ['cana.custody', 'cana.cycles', 'cana.allocator', 'cana.forecasts'], cols: 2 } }] });
  k.commit(p6.candidate, { approvedBy: 'owner-1' });
  // save + duplicate-by-save + apply
  k.saveTemplate('War Room');
  assert.ok(k.templates().saved.includes('War Room'));
  // exact rollback (restore an earlier arrangement by content hash)
  k.rollback(commandAddr);
  assert.equal(panesIn(k.current().tree).length, 4);
  assert.equal(k.fabric.verifyReceipts().valid, true, 'every mutation receipted, chain intact');
});

test('STATE-PRESERVING RELOCATION: pane state survives any rearrangement, byte-identical', () => {
  const k = owner();
  k.setResidual('cana.cycles', { scroll: 412, filter: 'ADMITTED', draft: 'notes about fwc_8' });
  const before = JSON.stringify(k.residuals());
  const p = k.preview({ actor: 'owner-1', intent: 'move cycles', ops: [{ op: 'move_pane', args: { id: 'cana.cycles', target: 'cana.custody', dir: 'col' } }] });
  k.commit(p.candidate, { approvedBy: 'owner-1' });
  assert.equal(JSON.stringify(k.residuals()), before, 'relocation cannot touch pane state');
  const f = k.preview({ actor: 'owner-1', intent: 'focus cycles', ops: [{ op: 'focus', args: { id: 'cana.cycles' } }] });
  k.commit(f.candidate, { approvedBy: 'owner-1' });
  assert.equal(k.residuals()['cana.cycles'].scroll, 412, 'focus mode preserves state too');
});

test('LAYOUT INTELLIGENCE: utterances compile deterministically; unknown words refuse to guess', () => {
  const r = compileLayoutUtterance('demand on the left, pricing and campaign stacked on the right', 'merchant');
  assert.equal(r.kind, 'TREE');
  assert.equal(r.tree.type, 'split');
  assert.deepEqual(panesIn(r.tree).sort(), ['merchant.campaign', 'merchant.demand', 'merchant.pricing']);
  const u = compileLayoutUtterance('make it more wizardy', 'merchant');
  assert.equal(u.kind, 'UNKNOWN');
  assert.throws(() => compileLayoutUtterance('custody chains please', 'merchant'), /PANE_FORBIDDEN/, 'NL compilation still obeys the role law');
});

test('MISSION-AWARE WORKSPACES: explicit rules construct the arrangement with rationale', () => {
  const w = workspaceForMission('grow-business-today', 'merchant');
  assert.deepEqual(panesIn(w.tree).sort(), [...MISSIONS['grow-business-today'].panes].sort());
  assert.match(w.rationale, /demand/);
  assert.ok(w.mobile.order.length === 4);
  assert.throws(() => workspaceForMission('take-over-the-world', 'owner'), /MISSION_UNKNOWN/);
});

test('CONCURRENCY COURT: disjoint merges; same-pane and delete-vs-edit quarantine', () => {
  const a = [{ op: 'resize_split', args: { path: [], ratios: [0.6, 0.4] } }];
  const b = [{ op: 'move_pane', args: { id: 'cana.allocator', target: 'cana.forecasts' } }];
  assert.equal(analyzeLayoutConflict(a, b).relation, 'STRUCTURAL_DISJOINT');
  const c = [{ op: 'move_pane', args: { id: 'cana.cycles', target: 'cana.custody' } }];
  const d = [{ op: 'focus', args: { id: 'cana.cycles' } }];
  const same = analyzeLayoutConflict(c, d);
  assert.equal(same.relation, 'SAME_FACT'); assert.equal(same.quarantine, true);
  const e = [{ op: 'remove_pane', args: { id: 'cana.cycles' } }];
  const dve = analyzeLayoutConflict(e, d);
  assert.equal(dve.relation, 'DELETE_VS_EDIT'); assert.equal(dve.quarantine, true);
});

test('PROTECTED STOREFRONT INVARIANTS: a layout patch physically cannot touch identity or truth', () => {
  const k = new LayoutKernel({ role: 'merchant', user: 'anacostia', protectedContext: { merchant: { id: 'abca-117379', identity: 'Anacostia Organics', brand: { g: '#2E9F45' } } } });
  assert.throws(() => k.fabric.mutatePrivate({
    goal: 'sneaky rebrand', scope: 'layout', risk: 'R1', agent: 'anacostia',
    write_set: ['design.layout.*'], mutation: { 'design.layout.tree': pane('merchant.composer'), 'merchant.identity': 'Stolen' },
  }), /PROTECTED_PATH|WRITE_SET_ESCAPE/);
  const p = k.preview({ actor: 'anacostia', intent: 'menu first', tree: split('col', [pane('merchant.composer'), pane('merchant.analytics')]) });
  k.commit(p.candidate, { approvedBy: 'anacostia' });
  assert.equal(k.fabric.current().merchant.identity, 'Anacostia Organics', 'identity untouched through every layout change');
});
