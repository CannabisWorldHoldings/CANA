// CENSUS BLIND-SPOT COURT — the capability-census registry was compiled at
// sovereign tip 9d3bd70. Five mechanisms were built in the POST38 lineage
// AFTER that point and appeared in NO registry, so the anti-duplication gate
// promoted by EC-0001 was structurally blind to them: a future agent could
// propose a second Governor / Cockpit / Console / Dual-Forecast /
// Layout-Kernel and be told CLEAR_TO_BUILD by the very court whose job is to
// refuse exactly that.
//
// This file is the standing proof that the blind spot is closed. It runs the
// REAL census and the REAL gate (censusVerdict / loadOwners /
// censusGateForVerify, and the real ./cana dispatcher in a child process) —
// nothing here re-implements matching.
//
// LAW UNDER TEST: ONE CAPABILITY -> ONE CANONICAL OWNER (§74).
// LAW NOT UNDER TEST: who may authorize effects. Capability ownership is not
// root authority — see the ARCHITECTURAL SEPARATION block below.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { censusVerdict, loadOwners } from './capability-census.mjs';
import { censusGateForVerify } from './census-gate.mjs';
import { runHoldout } from './ec-0001.mjs';
import { runHidden } from './es-0001.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * The five capabilities that POST38 created after the registry's compile
 * point. `duplicates` are proposals written the way a future agent would
 * actually write them — independent phrasings, not restatements of the
 * job_terms. Each must be caught.
 */
const BLINDSPOT = [
  {
    capability: 'metabolism-coordination',
    owner_path: 'tools/vanguard/governor.mjs',
    origin_commit: '190c990',
    duplicates: [
      'stand up a resident daemon that runs the governed metabolism on a fixed interval, writing a pulse receipt for every metabolism pulse',
      'a background daemon that keeps the loop alive, running one pulse cycle every twenty minutes',
      'non stop loop process that sweeps custody then runs the flywheel and rebuilds the cockpit each pulse',
      'continuous pulse scheduler for the governed metabolism, resident in the environment',
      'an always-on orchestrator that fires the whole metabolism on an interval and appends a pulse receipt',
    ],
  },
  {
    capability: 'owner-intelligence-cockpit',
    owner_path: 'tools/vanguard/cockpit.mjs',
    origin_commit: '190c990',
    duplicates: [
      'a new owner dashboard that compiles a single html overview page from the hash chained ledgers',
      'compile a cockpit html page showing custody, cycles, forecasts and allocation',
      'an owner cockpit view of every ledger number, regenerated on demand',
      'a god eye owner dashboard, one page, every metric read from the chains',
      'rebuild the intelligence cockpit as a static dashboard from live ledgers',
    ],
  },
  {
    capability: 'governed-operator-console',
    owner_path: 'tools/vanguard/console.mjs',
    origin_commit: '190c990',
    duplicates: [
      'a conversational command interface that compiles owner utterances into governed actions, each command a chained console receipt',
      'a repl where the owner types plain words and gets governed actions, with an intent grammar',
      'an operator console that turns natural language commands into tool runs',
      'console command layer that compiles utterances deterministically and refuses gated intents',
      'a chat interface for the owner: command console with a receipt per command',
    ],
  },
  {
    capability: 'dual-prediction',
    owner_path: 'tools/vanguard/dual-forecast.mjs',
    origin_commit: '190c990',
    duplicates: [
      'register two independent predictors for every target and grade both against reality with brier scores, flagging divergence between champion and baseline',
      'a dual forecast harness: champion versus baseline, both graded by brier',
      'run two predictors per target and let reality pick the winner',
      'predictor duel ledger where divergence signal flags a bad model family',
      'competing predictions from two independent forecasts, both sealed before the outcome',
    ],
  },
  {
    capability: 'layout-intelligence',
    owner_path: 'tools/experience-fabric/layout-kernel.mjs',
    origin_commit: '190c990',
    duplicates: [
      'an adaptive workspace layout engine with a resizable pane tree, where moving or tabbing a pane preserves its pane state',
      'a layout graph for the merchant workspace with draggable panes and stable ids',
      'adaptive layout intelligence that compiles utterances into layout operations',
      'a bsp layout tree of panes where each semantic pane id keeps its own state',
      'let merchants split pane views and tab panes without losing pane state',
    ],
  },
];

const ownerFor = (owners, capability) => owners.find((o) => o.capability === capability);

/* ------------------------------------------------------------------------ */
/* 1. THE BLIND SPOT IS CLOSED: every POST38 mechanism is a registered owner  */
/* ------------------------------------------------------------------------ */

test('all five POST38 mechanisms are registered capabilities (the census can finally see them)', () => {
  const owners = loadOwners();
  for (const b of BLINDSPOT) {
    const o = ownerFor(owners, b.capability);
    assert.ok(o, `capability "${b.capability}" is missing from capability-owners.json — the census is blind to ${b.owner_path} again`);
    assert.ok(
      o.owner_paths.includes(b.owner_path),
      `capability "${b.capability}" must cite ${b.owner_path} as its owner path (got ${JSON.stringify(o.owner_paths)})`,
    );
    assert.ok(o.job_terms.length >= 2, `"${b.capability}" needs >=2 job terms: the gate requires two matched terms before it will refuse, so a one-term owner can never collide`);
  }
});

/* ------------------------------------------------------------------------ */
/* 2. A SECOND IMPLEMENTATION IS DETECTED AS AN OVERLAP (the actual gate)     */
/* ------------------------------------------------------------------------ */

for (const b of BLINDSPOT) {
  test(`proposing a SECOND ${b.capability} is refused as a duplicate, citing ${b.owner_path}`, () => {
    const owners = loadOwners();
    for (const proposal of b.duplicates) {
      const v = censusVerdict(proposal, owners); // real census, INCUMBENT evaluator
      assert.equal(
        v.verdict, 'REFUSED_DUPLICATE',
        `census cleared a rebuild of ${b.capability}: "${proposal}"`,
      );
      const hit = v.collisions.find((c) => c.capability === b.capability);
      assert.ok(
        hit,
        `census refused "${proposal}" but cited ${JSON.stringify(v.collisions.map((c) => c.capability))} instead of ${b.capability}`,
      );
      assert.ok(hit.matched_terms.length >= 2, 'the gate refuses only at >=2 matched terms');
      assert.ok(hit.owner_paths.includes(b.owner_path), 'the refusal must name the real owner so the builder can extend it');
      assert.ok(
        hit.owner_paths_present.includes(b.owner_path),
        `${b.owner_path} is cited but absent from this tree — the builder would be sent to a file that does not exist`,
      );
      assert.equal(hit.law, 'ONE CAPABILITY -> ONE CANONICAL OWNER: extend the owner, do not rebuild the job');
    }
  });
}

test('the refusal survives the real ./cana dispatcher (census-gate declaration court, child process)', () => {
  // The gate is wired at cana:47-53 (verify) and cana:58-61 (census). Exercise
  // the real dispatcher, in an isolated temp root so the append-only
  // declarations ledger of THIS repo is never written to.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'census-blindspot-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools'), { recursive: true });
    fs.cpSync(HERE, path.join(tmp, 'tools', 'federation'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'cana'), path.join(tmp, 'cana'));

    for (const b of BLINDSPOT) {
      const r = spawnSync(process.execPath, ['cana', 'census', 'declare', b.duplicates[0]], {
        cwd: tmp, encoding: 'utf8',
      });
      assert.equal(r.status, 1, `./cana census declare must exit 1 for a duplicate ${b.capability} (stderr: ${r.stderr})`);
      const row = JSON.parse(r.stdout);
      assert.equal(row.verdict, 'REFUSED_DUPLICATE');
      assert.ok(row.collisions.includes(b.capability), `declaration cited ${JSON.stringify(row.collisions)}, expected ${b.capability}`);
      assert.equal(row.resolved, false, 'an unresolved duplicate declaration must block verify until it is resolved');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------ */
/* 3. ARCHITECTURAL SEPARATION: capability ownership != root authority        */
/* ------------------------------------------------------------------------ */

test('the governor is filed as a metabolism COORDINATOR, never as an authorizer', () => {
  const owners = loadOwners();
  const auth = ownerFor(owners, 'authorization-governor');
  assert.ok(auth, 'the pre-existing authorization-governor entry must be untouched');
  assert.ok(
    !auth.owner_paths.includes('tools/vanguard/governor.mjs'),
    'tools/vanguard/governor.mjs must NOT be filed under authorization-governor: its only export is pulse(n), which spawns subprocesses and appends a receipt. Root authorization is unsettled and registry repair must not decide it.',
  );
  assert.deepEqual(ownerFor(owners, 'metabolism-coordination').owner_paths, ['tools/vanguard/governor.mjs']);
});

test('a metabolism-coordinator rebuild collides with metabolism-coordination and NOT with authorization-governor', () => {
  const owners = loadOwners();
  for (const proposal of [...BLINDSPOT[0].duplicates, 'a second governor daemon that pulses the metabolism non stop']) {
    const caps = censusVerdict(proposal, owners).collisions.map((c) => c.capability);
    assert.ok(caps.includes('metabolism-coordination'), `not caught: "${proposal}"`);
    assert.ok(
      !caps.includes('authorization-governor'),
      `"${proposal}" was routed to authorization-governor — the registry is deciding architecture it has no authority to decide`,
    );
  }
});

test('conversely, a real authorization proposal still lands on authorization-governor and not on the metabolism owner', () => {
  const owners = loadOwners();
  const caps = censusVerdict(
    'an authorization governor that validates a signed grant validation before any action contract executes',
    owners,
  ).collisions.map((c) => c.capability);
  assert.ok(caps.includes('authorization-governor'));
  assert.ok(!caps.includes('metabolism-coordination'), 'the two governors must not be conflated in either direction');
});

/* ------------------------------------------------------------------------ */
/* 4. THE REGISTRY IS NOT FICTION — strict path court                         */
/* ------------------------------------------------------------------------ */

/**
 * Stricter than the shipped gate: EVERY cited path must be a real file in the
 * converged capability set, unless the entry explicitly declares that its
 * owner still lives in the sibling lineage and has not been converged yet.
 * "Not yet merged" is a legitimate state; "fictional citation" is not, and
 * without the marker the two are indistinguishable.
 */
test('every owner_path in the registry is a real file, or is explicitly marked as sibling-lineage', () => {
  const owners = loadOwners();
  const deferred = [];
  for (const o of owners) {
    if (o.sibling_lineage_only === true) {
      assert.ok(typeof o.lineage === 'string' && o.lineage.length > 0, `${o.capability}: sibling_lineage_only requires a named lineage`);
      assert.ok(typeof o.origin_commit === 'string' && o.origin_commit.length > 0, `${o.capability}: sibling_lineage_only requires origin_commit so the claim is checkable`);
      deferred.push(o.capability);
      continue;
    }
    for (const p of o.owner_paths) {
      assert.ok(
        fs.existsSync(path.join(ROOT, p)),
        `${o.capability} cites ${p}, which does not exist in this tree. Either converge the file, or mark the entry "sibling_lineage_only": true with lineage + origin_commit.`,
      );
    }
  }
  // In the converged tree nothing should be deferred; the escape hatch exists
  // so the registry stays honest DURING convergence, not as a parking lot.
  assert.deepEqual(deferred, [], `capabilities still awaiting convergence: ${deferred.join(', ')}`);
});

test('the five converged POST38 owners record where they came from', () => {
  const owners = loadOwners();
  for (const b of BLINDSPOT) {
    const o = ownerFor(owners, b.capability);
    assert.equal(o.lineage, 'post38', `${b.capability} must record its POST38 provenance`);
    assert.equal(o.origin_commit, b.origin_commit);
    assert.ok(fs.existsSync(path.join(ROOT, b.owner_path)), `${b.owner_path} must be converged into this tree`);
  }
});

/**
 * GAP CHARACTERIZATION (not an endorsement). The shipped gate's
 * registry_integrity check is `owner_paths.some(exists)` (census-gate.mjs:58),
 * so an owner with one real path and one fictional path passes it. The strict
 * court above is what actually catches that. If the gate is later tightened to
 * `.every(...)`, this test will fail — delete it then, and update
 * CENSUS_BLINDSPOT_CLOSURE.md.
 */
test('GAP: the shipped gate accepts a partly-fictional owner (only .some() of the paths must exist)', () => {
  const owners = loadOwners();
  const real = owners.find((o) => o.owner_paths.every((p) => fs.existsSync(path.join(ROOT, p))));
  assert.ok(real, 'at least one fully-present owner is needed to characterize the gap');
  const partlyFictional = { ...real, owner_paths: [...real.owner_paths, 'tools/federation/does-not-exist.mjs'] };
  const gateSemantics = (o) => o.owner_paths.some((p) => fs.existsSync(path.join(ROOT, p)));
  const strictSemantics = (o) => o.owner_paths.every((p) => fs.existsSync(path.join(ROOT, p)));
  assert.equal(gateSemantics(partlyFictional), true, 'shipped gate tolerates the fictional path');
  assert.equal(strictSemantics(partlyFictional), false, 'the strict court above does not');
});

/**
 * GAP CHARACTERIZATION — HYPHENATION EVASION (found while closing this blind
 * spot; NOT in the INCUMBENT evaluator's declared known_blind_spots).
 *
 * norm() keeps "-" inside its allowed character class
 * (capability-census.mjs:25), so "pulse-cycle" is ONE token and never meets
 * the job term "pulse cycle". The same sentence, unhyphenated, is refused.
 * This repo names things with hyphens by house style (dual-forecast,
 * layout-kernel, non-stop, god's-eye), so this is a live evasion, not a
 * theoretical one.
 *
 * Deliberately NOT fixed here: changing norm() is an evaluator change and
 * requires an EvaluatorSuccessionCase (ES-0002) with criteria fixed before the
 * candidate, per the Gate E law. Registry repair must not quietly re-cut the
 * evaluator. When ES-0002 lands, this test flips and should be deleted.
 */
test('GAP: hyphenating a proposal defeats the census (unlisted blind spot of census-term-v2)', () => {
  const owners = loadOwners();
  assert.equal(censusVerdict('a non stop pulse cycle daemon', owners).verdict, 'REFUSED_DUPLICATE');
  assert.equal(
    censusVerdict('a non-stop pulse-cycle daemon', owners).verdict, 'CLEAR_TO_BUILD',
    'if this now refuses, ES-0002 has landed: delete this test and update CENSUS_BLINDSPOT_CLOSURE.md',
  );
});

/**
 * GAP CHARACTERIZATION — UNENFORCEABLE OWNERS. loadOwners only requires
 * job_terms.length >= 1 (capability-census.mjs:51), but censusVerdict refuses
 * only at >= 2 matched terms (capability-census.mjs:78). A one-term owner is
 * therefore well-formed, loads cleanly, passes the gate — and can never refuse
 * anything. The registry cannot currently tell you it is inert.
 */
test('GAP: a single-job-term owner is well-formed but can never refuse anything', () => {
  const inert = [{ capability: 'inert', job_terms: ['singleton term'], owner_paths: ['cana'] }];
  assert.equal(censusVerdict('build a singleton term thing', inert).verdict, 'CLEAR_TO_BUILD');
  // Guard the real registry against shipping one:
  for (const o of loadOwners()) {
    assert.ok(o.job_terms.length >= 2, `${o.capability} has only ${o.job_terms.length} job term(s) and is unenforceable`);
  }
});

/* ------------------------------------------------------------------------ */
/* 5. NO COLLATERAL DAMAGE: the new entries must not create false refusals    */
/* ------------------------------------------------------------------------ */

test('the EC-0001 holdout and the ES-0001 hidden corpus are unchanged by the five new owners', () => {
  for (const r of runHoldout()) assert.equal(r.pass, true, `${r.case}: expected ${r.expected}, observed ${r.observed}`);
  for (const h of runHidden()) {
    assert.equal(h.candidateCorrect, true, `${h.case}: incumbent evaluator now returns ${h.v2}, expected ${h.correct}`);
    if (h.case.startsWith('S1') || h.case.startsWith('S2') || h.case.startsWith('S3')) {
      assert.equal(h.v1, 'CLEAR_TO_BUILD', `${h.case}: the retired v1 defect must remain forensically reproducible`);
    }
  }
});

test('genuinely different jobs adjacent to the five new owners stay CLEAR_TO_BUILD', () => {
  const owners = loadOwners();
  const clears = [
    'a merchant analytics dashboard page reading from the orders ledger',
    'a public storefront page builder for dispensary menus',
    'a static site generator that renders one html page per merchant',
    'a cron job that emails the owner a weekly digest',
    'a single prediction of next week demand for one dispensary',
    'a customer facing product search interface with natural filters',
    'a mobile responsive css grid for the marketing site',
    'workforce compiler that maps a mission to a minimum sufficient worker set',
  ];
  for (const p of clears) {
    const v = censusVerdict(p, owners);
    assert.equal(
      v.verdict, 'CLEAR_TO_BUILD',
      `false refusal: "${p}" -> ${v.collisions.map((c) => `${c.capability}${JSON.stringify(c.matched_terms)}`).join(', ')}`,
    );
  }
});

test('the verify-time census gate stays green with the extended registry', () => {
  const gate = censusGateForVerify();
  assert.equal(gate.ok, true, JSON.stringify(gate.findings));
  const integrity = gate.findings.find((f) => f.check === 'registry_integrity');
  assert.equal(integrity.ok, true);
});
