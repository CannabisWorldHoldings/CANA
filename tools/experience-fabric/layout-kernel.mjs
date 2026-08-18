// LAYOUT KERNEL — OWD-EXPERIENCE-FABRIC v2: the Experience Operating System.
// (OWD_ADAPTIVE_EXPERIENCE_LAYOUT_INTELLIGENCE, absorbed per anti-fragmentation:
// this kernel COMPOSES the existing Experience Fabric — IntentPatches, oracle
// courts, quarantine, content-addressed rollback — and adds the layout half.)
//
// LAWS:
//   A LAYOUT IS EXECUTABLE PRODUCT STATE, NOT DECORATION — the LayoutGraph is
//     a BSP-style tree living at design.layout.*, mutated only through the
//     fabric's IntentPatch court. Preview never moves the head; commit needs
//     approval; every historical arrangement is recoverable by content hash.
//   STABLE SEMANTIC IDS — every pane and public module has one; role law
//     gates who may mount what (PANE_FORBIDDEN refuses).
//   STATE-PRESERVING RELOCATION — pane state lives in the ResidualStore keyed
//     by semantic id, structurally separate from the tree. Moving, tabbing,
//     hiding or re-gridding a pane CANNOT touch its state.
//   INTELLIGENCE, NOT JUST DRAG-AND-DROP — utterances compile to layout ops
//     deterministically; missions construct workspaces by explicit rules;
//     unknown words return UNKNOWN, never a guess.
//   CONCURRENCY COURT — disjoint pane ops merge; same-pane, delete-vs-edit,
//     and invariant-breaking op sets QUARANTINE. Never last-writer-wins.
//   GENERATOR ≠ JUDGE · LAYOUT RESULT ≠ LEARNING · ONE WIN ≠ GLOBAL DESIGN LAW.
import { createHash } from 'node:crypto';

import { ExperienceFabric, FabricError, stateAddress } from './kernel.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const text = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (v) => JSON.parse(JSON.stringify(v));

export class LayoutError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'LayoutError'; this.code = code; }
}
const refuse = (code, msg) => { throw new LayoutError(code, msg); };

// ---------------------------------------------------------------------------
// PANE REGISTRY — stable semantic ids, role law.
// ---------------------------------------------------------------------------
export const PANE_REGISTRY = Object.freeze({
  'cana.custody':            { title: 'Custody & chains',        roles: ['owner'] },
  'cana.cycles':             { title: 'Metabolism cycles',       roles: ['owner'] },
  'cana.allocator':          { title: 'Advantage allocator',     roles: ['owner'] },
  'cana.forecasts':          { title: 'Forecast ledger',         roles: ['owner'] },
  'cana.assistant':          { title: 'CANA assistant',          roles: ['owner', 'merchant'] },
  'merchant.demand':         { title: 'Demand intelligence',     roles: ['owner', 'merchant'] },
  'merchant.pricing':        { title: 'Pricing intelligence',    roles: ['owner', 'merchant'] },
  'merchant.competitors':    { title: 'Competitive intelligence',roles: ['owner', 'merchant'] },
  'merchant.campaign':       { title: 'Campaign studio',         roles: ['merchant', 'owner'] },
  'merchant.creative':       { title: 'AI creative studio',      roles: ['merchant', 'owner'] },
  'merchant.composer':       { title: 'Storefront composer',     roles: ['merchant', 'owner'] },
  'merchant.analytics':      { title: 'Analytics & outcomes',    roles: ['merchant', 'owner'] },
  'public.hero':             { title: 'Storefront hero',         roles: ['public'] },
  'public.menu':             { title: 'Menu module',             roles: ['public'] },
  'public.deal':             { title: 'Deal module',             roles: ['public'] },
  'public.hours':            { title: 'Hours module',            roles: ['public'] },
});

export function assertPaneAllowed(id, role) {
  const p = PANE_REGISTRY[id];
  if (!p) refuse('PANE_UNKNOWN', `no pane with semantic id "${id}" — ids are stable and registered, never invented`);
  if (!p.roles.includes(role)) refuse('PANE_FORBIDDEN', `pane "${id}" is not mountable for role "${role}" — merchant freedom is large, merchant authority is bounded`);
}

// ---------------------------------------------------------------------------
// LAYOUT GRAPH — BSP tree. Nodes: split(row|col, ratios, children) | stack | pane.
// ---------------------------------------------------------------------------
export const pane = (id) => ({ type: 'pane', id });
export const split = (dir, children, ratios) => ({ type: 'split', dir, ratios: ratios ?? children.map(() => 1 / children.length), children });
export const stack = (ids, active = 0) => ({ type: 'stack', active, children: ids.map(pane) });

export function panesIn(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node.id);
  else (node.children || []).forEach((c) => panesIn(c, out));
  return out;
}

export function validateTree(node, role) {
  if (!node || typeof node !== 'object') refuse('TREE_INVALID', 'a layout tree is required');
  if (node.type === 'pane') { assertPaneAllowed(node.id, role); return true; }
  if (node.type === 'stack') {
    if (!Array.isArray(node.children) || node.children.length === 0) refuse('TREE_INVALID', 'a stack needs children');
    if (!(Number.isInteger(node.active) && node.active >= 0 && node.active < node.children.length)) refuse('TREE_INVALID', 'stack.active out of range');
    node.children.forEach((c) => validateTree(c, role));
    return true;
  }
  if (node.type === 'split') {
    if (!['row', 'col'].includes(node.dir)) refuse('TREE_INVALID', 'split.dir must be row|col');
    if (!Array.isArray(node.children) || node.children.length < 2) refuse('TREE_INVALID', 'a split needs ≥2 children');
    const s = (node.ratios || []).reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > 0.001) refuse('TREE_INVALID', `split ratios must sum to 1 (got ${s.toFixed(3)})`);
    node.children.forEach((c) => validateTree(c, role));
    const ids = panesIn(node);
    if (new Set(ids).size !== ids.length) refuse('TREE_INVALID', 'a pane may appear once — duplicates break state identity');
    return true;
  }
  refuse('TREE_INVALID', `unknown node type ${node.type}`);
}

/** Responsive law: every desktop tree projects to an ordered mobile flow. */
export const projectMobile = (tree) => ({ type: 'stackflow', order: panesIn(tree) });

// ---------------------------------------------------------------------------
// OPERATIONS — pure tree → tree. Residuals are never parameters: relocation
// cannot touch state by construction.
// ---------------------------------------------------------------------------
const removePane = (node, id) => {
  if (!node) return null;
  if (node.type === 'pane') return node.id === id ? null : node;
  const children = node.children.map((c) => removePane(c, id)).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1 && node.type === 'split') return children[0];
  const ratios = node.type === 'split' ? children.map(() => 1 / children.length) : undefined;
  return { ...node, children, ...(ratios ? { ratios } : {}) };
};

export const OPS = {
  split_pane: (tree, { target, id, dir = 'row', at = 'after' }) => mapPane(tree, target, (p) =>
    split(dir, at === 'before' ? [pane(id), p] : [p, pane(id)])),
  move_pane: (tree, { id, target, dir = 'row', at = 'after' }) => {
    const without = removePane(tree, id);
    if (!without) refuse('TREE_INVALID', 'cannot move the only pane');
    return OPS.split_pane(without, { target, id, dir, at });
  },
  resize_split: (tree, { path = [], ratios }) => {
    const t = clone(tree); let n = t;
    for (const i of path) n = n.children[i];
    if (n.type !== 'split') refuse('TREE_INVALID', 'resize target is not a split');
    if (ratios.length !== n.children.length) refuse('TREE_INVALID', 'ratio count mismatch');
    n.ratios = ratios; return t;
  },
  tab_panes: (tree, { ids }) => {
    let t = clone(tree);
    for (const id of ids.slice(1)) { const w = removePane(t, id); if (w) t = w; }
    return mapPane(t, ids[0], () => stack(ids));
  },
  remove_pane: (tree, { id }) => {
    const w = removePane(tree, id);
    if (!w) refuse('TREE_INVALID', 'cannot remove the last pane');
    return w;
  },
  new_grid: (_tree, { ids, cols = 2 }) => {
    const rows = [];
    for (let i = 0; i < ids.length; i += cols) rows.push(ids.slice(i, i + cols));
    return split('col', rows.map((r) => (r.length === 1 ? pane(r[0]) : split('row', r.map(pane)))));
  },
  focus: (_tree, { id }) => pane(id),
  replace: (_tree, { tree: next }) => next,
};

function mapPane(node, id, fn) {
  if (node.type === 'pane') return node.id === id ? fn(node) : node;
  return { ...node, children: node.children.map((c) => mapPane(c, id, fn)) };
}

export const affectedIds = (op) => {
  const a = new Set();
  if (op.args?.id) a.add(op.args.id);
  if (op.args?.target) a.add(op.args.target);
  (op.args?.ids || []).forEach((i) => a.add(i));
  if (op.op === 'replace') panesIn(op.args.tree).forEach((i) => a.add(i));
  return [...a];
};

/** Concurrency court: disjoint merges; same-pane / delete-vs-edit quarantine. */
export function analyzeLayoutConflict(opsA, opsB) {
  const A = new Set(opsA.flatMap(affectedIds));
  const B = new Set(opsB.flatMap(affectedIds));
  const shared = [...A].filter((x) => B.has(x));
  if (shared.length === 0) return { relation: 'STRUCTURAL_DISJOINT', quarantine: false, shared };
  const deletes = (ops) => new Set(ops.filter((o) => o.op === 'remove_pane').flatMap(affectedIds));
  const dA = deletes(opsA), dB = deletes(opsB);
  const dve = shared.some((id) => (dA.has(id) && B.has(id)) || (dB.has(id) && A.has(id)));
  return {
    relation: dve ? 'DELETE_VS_EDIT' : 'SAME_FACT',
    quarantine: true, shared,
    note: dve ? 'one actor deletes what another edits — quarantined for a human' : 'two actors touch the same pane — the kernel never silently picks a winner',
  };
}

// ---------------------------------------------------------------------------
// LAYOUT INTELLIGENCE — deterministic, honest.
// ---------------------------------------------------------------------------
const NL_PANES = [
  [/demand/, 'merchant.demand'], [/pric/, 'merchant.pricing'], [/competit/, 'merchant.competitors'],
  [/campaign/, 'merchant.campaign'], [/creative|studio/, 'merchant.creative'], [/composer|storefront/, 'merchant.composer'],
  [/analytic|outcome/, 'merchant.analytics'], [/assistant|cana\b/, 'cana.assistant'],
  [/custody|chain/, 'cana.custody'], [/cycle|metabol/, 'cana.cycles'], [/allocat/, 'cana.allocator'], [/forecast/, 'cana.forecasts'],
  [/menu/, 'public.menu'], [/deal/, 'public.deal'], [/hour/, 'public.hours'], [/hero/, 'public.hero'],
];

/** "demand left, pricing and campaign stacked right" → tree. Unknown words → UNKNOWN. */
export function compileLayoutUtterance(utterance, role) {
  const u = String(utterance || '').toLowerCase();
  const found = [];
  for (const [re, id] of NL_PANES) { const m = u.match(re); if (m && !found.some((f) => f.id === id)) found.push({ id, i: m.index }); }
  if (found.length === 0) return { kind: 'UNKNOWN', note: 'no registered panes recognized — panes are semantic ids, never guessed', known: Object.keys(PANE_REGISTRY) };
  found.forEach((f) => assertPaneAllowed(f.id, role));
  const fm = u.match(/focus(?: on)? (\w+)/);
  if (fm) { const f = found.find((x) => u.indexOf(x.id.split('.')[1]) >= 0 || true); return { kind: 'TREE', tree: pane(found[0].id), explanation: `focus mode on ${found[0].id}` }; }
  const zone = (name) => found.filter((f) => { const zi = u.indexOf(name); return zi >= 0 && Math.abs(f.i - zi) < 40 && f.i < zi; }).map((f) => f.id);
  const left = zone('left'), right = zone('right');
  const stacked = /stack/.test(u);
  const rest = found.map((f) => f.id).filter((id) => !left.includes(id) && !right.includes(id));
  let tree;
  if (left.length && (right.length || rest.length)) {
    const rightIds = right.length ? right : rest;
    const L = left.length === 1 ? pane(left[0]) : split('col', left.map(pane));
    const R = stacked && rightIds.length > 1 ? stack(rightIds) : (rightIds.length === 1 ? pane(rightIds[0]) : split('col', rightIds.map(pane)));
    tree = split('row', [L, R]);
  } else if (stacked && found.length > 1) tree = stack(found.map((f) => f.id));
  else if (found.length === 1) tree = pane(found[0].id);
  else tree = OPS.new_grid(null, { ids: found.map((f) => f.id), cols: 2 });
  validateTree(tree, role);
  return { kind: 'TREE', tree, explanation: `compiled ${found.length} pane(s)${left.length ? `, ${left.length} left` : ''}${stacked ? ', stacked' : ''}` };
}

/** Mission-aware workspace construction — explicit rules, receipted rationale. */
export const MISSIONS = Object.freeze({
  'ship-release':        { role: 'owner',    panes: ['cana.custody', 'cana.cycles', 'cana.allocator', 'cana.assistant'], why: 'shipping needs chains green, cycles visible, orders ranked, the assistant at hand' },
  'investigate-drift':   { role: 'owner',    panes: ['cana.custody', 'cana.forecasts', 'cana.cycles'], why: 'drift is found in chains, graded predictions, and cycle history' },
  'grow-business-today': { role: 'merchant', panes: ['merchant.demand', 'merchant.pricing', 'merchant.analytics', 'cana.assistant'], why: 'growth starts from unmet demand, price position, measured outcomes, and a hand to act' },
  'run-storefront':      { role: 'merchant', panes: ['merchant.composer', 'merchant.creative', 'merchant.campaign'], why: 'composition, creative and campaigns are one act' },
});

export function workspaceForMission(mission, role) {
  const m = MISSIONS[mission];
  if (!m) refuse('MISSION_UNKNOWN', `no mission "${mission}" — missions are registered rules, not vibes`);
  if (m.role !== role && role !== 'owner') refuse('PANE_FORBIDDEN', `mission "${mission}" is a ${m.role} mission`);
  m.panes.forEach((p) => assertPaneAllowed(p, role === 'owner' ? (PANE_REGISTRY[p].roles.includes('owner') ? 'owner' : role) : role));
  const tree = OPS.new_grid(null, { ids: m.panes, cols: 2 });
  return { tree, rationale: m.why, mobile: projectMobile(tree) };
}

// ---------------------------------------------------------------------------
// THE KERNEL — composes ExperienceFabric: preview/commit/rollback, templates,
// residual store, receipts. Layout writes live at design.layout.*; everything
// protected stays protected by the fabric's own law.
// ---------------------------------------------------------------------------
export const BUILTIN_TEMPLATES = Object.freeze({
  'Focus':     (role) => pane(role === 'merchant' ? 'merchant.composer' : 'cana.cycles'),
  'Operate-2': (role) => split('row', role === 'merchant' ? [pane('merchant.demand'), pane('merchant.composer')] : [pane('cana.custody'), pane('cana.cycles')]),
  'Command':   (role) => role === 'merchant'
    ? split('row', [split('col', [pane('merchant.demand'), pane('merchant.pricing')]), split('col', [pane('merchant.composer'), pane('merchant.analytics')])])
    : split('row', [split('col', [pane('cana.custody'), pane('cana.forecasts')]), split('col', [pane('cana.cycles'), pane('cana.allocator')])]),
});

export class LayoutKernel {
  constructor({ role, user = 'anon', device = 'desktop', protectedContext = {} }) {
    if (!['owner', 'merchant', 'public'].includes(role)) refuse('ROLE_INVALID', 'role must be owner|merchant|public');
    this.role = role; this.user = user; this.device = device;
    const baseTree = BUILTIN_TEMPLATES['Operate-2'](role === 'public' ? 'merchant' : role);
    const tree = role === 'public' ? split('col', [pane('public.hero'), pane('public.menu'), pane('public.deal')], [0.4, 0.4, 0.2]) : baseTree;
    this.fabric = new ExperienceFabric({
      merchant: protectedContext.merchant ?? { id: 'context', identity: 'Context', brand: {} },
      inventory: protectedContext.inventory ?? {},
      fulfillment: protectedContext.fulfillment ?? { verified_availability: {} },
      contract: protectedContext.contract ?? { accessibility: { min_contrast: 4.5, focus_visible: true, reduced_motion: true } },
      economics: { conversion: 'UNKNOWN', revenue: 'UNKNOWN' },
      design: { layout: { tree, hidden: [], templates: {}, persistence: { user, role, device } } },
      residuals: {},
    });
    this.previous = null; // for Reset/unfocus
  }

  current() { return this.fabric.current().design.layout; }
  residuals() { // semantic ids contain dots; storage keys are dot-escaped — translate back
    const raw = this.fabric.current().residuals ?? {};
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replaceAll('·', '.'), v]));
  }
  historyAddress() { return this.fabric.head; }

  /** Pane state writes go to the ResidualStore — independent of the tree. */
  setResidual(paneId, state) {
    assertPaneAllowed(paneId, this.role === 'public' ? 'public' : this.role);
    const rkey = paneId.replaceAll('.', '·'); // dot-safe: the fabric's path-setter must never split a semantic id
    const { candidate } = this.#mutate({ [`residuals.${rkey}`]: state }, ['residuals.*'], `residual:${paneId}`, 'R0');
    this.fabric.approve(candidate, { merchant: this.user });
    this.fabric.promote(candidate);
    return candidate;
  }

  /** Preview a layout change (ops or full tree) — head does NOT move. */
  preview({ actor, intent, ops = [], tree = null, risk = 'R1' }) {
    if (!text(actor)) refuse('PATCH_FIELD', 'actor required — anonymous layout mutation is refused');
    if (!text(intent)) refuse('PATCH_FIELD', 'intent required — what is this arrangement FOR?');
    let next = tree ?? this.current().tree;
    for (const o of ops) {
      if (!OPS[o.op]) refuse('OP_UNKNOWN', `no layout op "${o.op}"`);
      next = OPS[o.op](next, o.args ?? {});
    }
    validateTree(next, this.role === 'public' ? 'public' : this.role);
    projectMobile(next); // responsive law: projection must exist
    const before = JSON.stringify(this.fabric.current().residuals ?? {}); // raw store, same keyspace
    const { candidate, court, receipt_hash } = this.#mutate(
      { 'design.layout.tree': next }, ['design.layout.*'], intent, risk, actor,
    );
    // STATE-PRESERVATION COURT: residuals byte-identical across relocation.
    const after = JSON.stringify(this.fabric.states.get(candidate)?.residuals ?? {});
    if (before !== after) refuse('STATE_DESTROYED', 'relocation touched pane state — forbidden');
    return {
      candidate, court, receipt_hash,
      affected: ops.flatMap(affectedIds),
      base: this.historyAddress(),
      mobile: projectMobile(next),
      note: 'preview only — the live layout has not moved',
    };
  }

  /** Commit = approval + promotion. Exact rollback by content address, forever. */
  commit(candidate, { approvedBy }) {
    this.previous = this.historyAddress();
    this.fabric.approve(candidate, { merchant: approvedBy ?? this.user });
    return this.fabric.promote(candidate);
  }

  rollback(address) { return this.fabric.rollback(address); }

  saveTemplate(name) {
    if (!text(name)) refuse('TEMPLATE_INVALID', 'a template needs a name');
    const layout = clone(this.current());
    const { candidate } = this.#mutate({ [`design.layout.templates.${name}`]: layout.tree }, ['design.layout.*'], `save template ${name}`, 'R0');
    this.commit(candidate, { approvedBy: this.user });
    return { saved: name };
  }

  templates() { return { builtin: Object.keys(BUILTIN_TEMPLATES), saved: Object.keys(this.current().templates ?? {}) }; }

  applyTemplate(name, { actor }) {
    const t = BUILTIN_TEMPLATES[name]?.(this.role === 'public' ? 'merchant' : this.role) ?? this.current().templates?.[name];
    if (!t) refuse('TEMPLATE_UNKNOWN', `no template "${name}"`);
    return this.preview({ actor, intent: `apply template ${name}`, tree: clone(t) });
  }

  #mutate(mutation, writeSet, goal, risk = 'R1', actor = this.user) {
    try {
      return this.fabric.mutatePrivate({ goal, scope: 'layout', risk, agent: actor, write_set: writeSet, mutation });
    } catch (e) {
      if (e instanceof FabricError) throw e;
      throw e;
    }
  }
}

export { stateAddress };
