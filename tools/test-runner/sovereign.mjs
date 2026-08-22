/**
 * ./cana verify sovereign — THE SOVEREIGN VERIFICATION COMPOSITION
 * ================================================================
 *
 * This is NOT an alias for an existing profile. It is a deliberate fifteen-stage
 * composition that runs in a fixed order, fails closed, classifies every stage
 * independently, and emits exactly one SHA-256 receipt.
 *
 *   01 clean-checkout            committed bytes only, in an isolated worktree
 *   02 source-identity           the three source SHAs and their common base, exactly
 *   03 capability-census         the Federation gate (registry / holdout / declarations)
 *   04 authority-court           13 adversarial authority courts vs a frozen baseline
 *   05 migrations                schema manifest statically + prisma migrate deploy live
 *   06 deterministic-courts      the shared base courts, pure node
 *   07 federation-courts         tools/federation — census, evolution, evaluators, memory
 *   08 post38-courts             alive-loop, vanguard, experience-fabric, sentinel
 *   09 web-courts                apps/web/tests — every file, classified per file
 *   10 typescript-lint           tsc --noEmit and the eslint court
 *   11 production-build          next build + stale-build + zero-warning diagnostics
 *   12 browser-courts            visual court static floor + rendered CDP harness
 *   13 security-adversarial      boundary courts + a live sabotage/restore probe
 *   14 reconstruction            bundle -> clone -> fsck -> identity equality
 *   15 artifact-hashes           a deterministic sha256 manifest of what was produced
 *
 * HONESTY CONTRACT
 * ----------------
 *  - A stage whose environment is absent reports ENVIRONMENT_MISSING. It is never
 *    skipped, never omitted, and never counted as a pass.
 *  - The overall verdict is SOVEREIGN_VERIFIED only when EVERY stage is VERIFIED.
 *    Anything else is REFUSED, and the exit code is non-zero.
 *  - A HARD-gate stage returning REAL_REGRESSION aborts the composition; the
 *    remaining stages are recorded as NOT_RUN, not as passes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Bytes, sha256File, writeReceipt } from './receipt.mjs';
import { classifyFailure, worstClassification, CLASSIFICATIONS } from './sovereign-classify.mjs';
import { probeAll } from './sovereign-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IDENTITY_FILE = path.join(ROOT, 'tools', 'test-runner', 'SOVEREIGN_SOURCE_IDENTITY.json');
// Merged tree: stage 04 runs the tools/authority courts directly (no frozen-baseline receipt), so the
// phase5 AUTHORITY_BASELINE pin is intentionally gone — see stage 04.
const DEFAULT_MIRROR = process.env.CANA_SOURCE_MIRROR ?? '/agent/workspace/CANA.git';
const UNIT_TIMEOUT_MS = Number(process.env.CANA_SOVEREIGN_UNIT_TIMEOUT_MS ?? 180_000);

// ---------------------------------------------------------------------------
// primitive helpers
// ---------------------------------------------------------------------------

function run(command, args, {
  cwd = ROOT,
  env = process.env,
  timeout = 120_000,
  input,
  maxBuffer = 64 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, {
    cwd, env, timeout, input, maxBuffer, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const startupError = result.error
    ? `${command} failed to start: ${result.error.code ?? ''} ${result.error.message}`
    : null;
  return {
    command: `${command} ${args.join(' ')}`,
    status: result.status,
    signal: result.signal,
    timedOut: result.signal === 'SIGTERM' && result.status === null,
    stdout,
    stderr,
    combined: `${stdout}${stderr}${startupError ? `\n${startupError}` : ''}`,
    startupError,
    ok: !result.error && result.status === 0,
  };
}

function git(args, opts = {}) {
  return run('git', args, opts);
}

function gitOut(args, opts = {}) {
  const r = git(args, opts);
  if (!r.ok) throw Object.assign(new Error(`git ${args.join(' ')} failed: ${r.combined.trim()}`), { result: r });
  return r.stdout.trim();
}

function tail(value, limit = 6000) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `...[${text.length - limit} bytes elided]...\n${text.slice(-limit)}`;
}

/**
 * Diagnostic-only, complete error-level listing for the eslint court.
 *
 * The default (human) formatter is emitted longest-tail-first, so a large
 * failure buries the error-level rules above the receipt's tail budget. This
 * runs eslint ONCE MORE with the JSON formatter — purely to record evidence —
 * and returns `path:line:col rule — message` for every severity-2 (error)
 * result. It never influences a verdict: the gate is the human run's exit code.
 * Returns '' if eslint cannot produce parseable JSON (then the caller falls
 * back to the tailed human output, exactly as before).
 */
function eslintErrorListing() {
  try {
    const web = path.join(ROOT, 'apps', 'web');
    const r = run('npx', ['--no-install', 'eslint', '.', '--format', 'json'], {
      cwd: web, timeout: 900_000,
    });
    const start = r.stdout.indexOf('[');
    if (start < 0) return '';
    const files = JSON.parse(r.stdout.slice(start));
    const lines = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file.filePath) || file.filePath;
      for (const m of file.messages ?? []) {
        if (m.severity !== 2) continue; // errors only; warnings remain in the human tail
        lines.push(`${rel}:${m.line}:${m.column}  ${m.ruleId ?? '(core)'} — ${String(m.message).replace(/\s+/g, ' ').trim()}`);
      }
    }
    if (lines.length === 0) return '';
    return `ESLINT ERRORS (${lines.length}, severity=2, full enumeration):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

function counts(output) {
  const pass = /^ℹ pass (\d+)$/m.exec(output);
  const fail = /^ℹ fail (\d+)$/m.exec(output);
  const tests = /^ℹ tests (\d+)$/m.exec(output);
  return {
    tests: tests ? Number(tests[1]) : null,
    pass: pass ? Number(pass[1]) : null,
    fail: fail ? Number(fail[1]) : null,
  };
}

/**
 * The live environment probes, published so classifyFailure can refuse to grant an
 * environment excuse in an environment that is actually present. Set once per run.
 */
let PROBES = null;
const classify = (text) => classifyFailure(text, { env: PROBES });

/** Run one `node --test <file>` and classify it from its own output. */
function courtUnit(file, {
  env = process.env,
  timeout = UNIT_TIMEOUT_MS,
  extraArgs = [],
  cwd = ROOT,
  label = null,
} = {}) {
  const absolute = path.join(ROOT, file);
  const name = label ?? file;
  if (!fs.existsSync(absolute)) {
    return {
      unit: name,
      classification: 'NOT_RUN',
      why: 'court file does not exist in this tree',
      counts: { tests: null, pass: null, fail: null },
    };
  }
  const started = Date.now();
  const target = path.relative(cwd, absolute) || file;
  const result = run(process.execPath, ['--test', ...extraArgs, target], { env, timeout, cwd });
  const tally = counts(result.combined);
  if (result.ok) {
    return { unit: name, classification: 'VERIFIED', counts: tally, durationMs: Date.now() - started };
  }
  if (result.timedOut) {
    return {
      unit: name,
      classification: 'REAL_REGRESSION',
      why: `exceeded the ${timeout}ms per-court timeout`,
      counts: tally,
      durationMs: Date.now() - started,
      output: tail(result.combined, 2000),
    };
  }
  const verdict = classify(result.combined);
  return {
    unit: name,
    classification: verdict.classification,
    why: verdict.reason,
    matched: verdict.matched,
    counts: tally,
    durationMs: Date.now() - started,
    output: tail(result.combined, 2500),
  };
}

function unitsToStage(units, evidencePrefix) {
  const classification = worstClassification(units.map((u) => u.classification));
  const byClass = {};
  for (const u of units) byClass[u.classification] = (byClass[u.classification] ?? 0) + 1;
  const evidence = [
    `${evidencePrefix}: ${units.length} court files — `
    + Object.entries(byClass).map(([k, v]) => `${v} ${k}`).join(', '),
  ];
  for (const u of units) {
    if (u.classification !== 'VERIFIED') {
      evidence.push(`${u.classification} ${u.unit}${u.why ? ` — ${u.why}` : ''}`);
    }
  }
  const tally = units.reduce((acc, u) => ({
    tests: acc.tests + (u.counts?.tests ?? 0),
    pass: acc.pass + (u.counts?.pass ?? 0),
    fail: acc.fail + (u.counts?.fail ?? 0),
  }), { tests: 0, pass: 0, fail: 0 });
  return { classification, evidence, units, detail: { byClass, assertions: tally } };
}

function glob(dir, predicate) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute)
    .filter((name) => predicate(name))
    .map((name) => path.posix.join(dir, name))
    .sort();
}

function environmentMissing(why, extra = {}) {
  return { classification: 'ENVIRONMENT_MISSING', evidence: [why], detail: extra };
}

/**
 * PROMOTION-GATE EXPLICIT CONTRACT DISPATCH (ES-0003, OWNER LAW #9).
 *
 * The promotion evaluator that judges the SUCCESSOR lineage is selected by an explicit,
 * stable contract — never by a blind `tools/promotion-gate/*.test.mjs` glob. This returns the
 * exact current courts. V1 runs only through historical replay and V2 runs only through the
 * byte-identical ES-0002 archive bridge inside the V3 court. Neither frozen evaluator is
 * blind-globbed against the current manifest-succession lane.
 */
function promotionGateSuccessorCourts() {
  return [
    'tools/promotion-gate/evidence-chain.test.mjs',
    'tools/promotion-gate/es-0003.court.test.mjs',
    'tools/promotion-gate/es-0003.holdout.court.test.mjs',
  ];
}

// ---------------------------------------------------------------------------
// STAGES
// ---------------------------------------------------------------------------

const STAGES = [
  // -------------------------------------------------------------------- 01
  {
    id: '01',
    key: 'clean-checkout',
    title: 'Clean checkout',
    gate: 'HARD',
    proves:
      'The bytes being verified are committed bytes. The working tree is clean, HEAD resolves, '
      + 'and an isolated detached worktree of HEAD reproduces the same commit and tree object.',
    run(ctx) {
      if (!ctx.env.git.present) return environmentMissing(`git is not available: ${ctx.env.git.why}`);
      const inside = git(['rev-parse', '--is-inside-work-tree']);
      if (!inside.ok) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [`${ROOT} is not a git work tree — a sovereign verification cannot verify uncommitted bytes`],
        };
      }
      const status = gitOut(['status', '--porcelain']);
      if (status !== '') {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [
            'refusing a dirty working tree; the sovereign scope verifies committed bytes only',
            ...status.split('\n').slice(0, 25),
          ],
          detail: { dirtyEntries: status.split('\n').length },
        };
      }
      const commit = gitOut(['rev-parse', 'HEAD']);
      const tree = gitOut(['rev-parse', 'HEAD^{tree}']);
      const worktree = path.join(ctx.runRoot, 'clean-worktree');
      const added = git(['worktree', 'add', '--detach', worktree, commit], { timeout: 300_000 });
      if (!added.ok) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [`git worktree add refused: ${tail(added.combined, 800)}`],
        };
      }
      let wtCommit = null;
      let wtTree = null;
      let wtStatus = null;
      try {
        wtCommit = gitOut(['rev-parse', 'HEAD'], { cwd: worktree });
        wtTree = gitOut(['rev-parse', 'HEAD^{tree}'], { cwd: worktree });
        wtStatus = gitOut(['status', '--porcelain'], { cwd: worktree });
      } finally {
        git(['worktree', 'remove', '--force', worktree], { timeout: 300_000 });
      }
      const removed = !fs.existsSync(worktree);
      const identical = wtCommit === commit && wtTree === tree && wtStatus === '';
      if (!identical || !removed) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [`isolated worktree did not reproduce HEAD exactly (commit=${wtCommit} tree=${wtTree} dirty=${wtStatus !== ''} removed=${removed})`],
          detail: { commit, tree, wtCommit, wtTree, removed },
        };
      }
      ctx.source = { commit, tree, branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) };
      return {
        classification: 'VERIFIED',
        evidence: [
          `working tree clean at ${commit}`,
          `isolated detached worktree reproduced commit ${wtCommit} tree ${wtTree} and was removed`,
        ],
        detail: { commit, tree, worktreeRemoved: removed },
      };
    },
  },

  // -------------------------------------------------------------------- 02
  {
    id: '02',
    key: 'source-identity',
    title: 'Exact source identity (four anchors, by ancestry)',
    gate: 'HARD',
    proves:
      'The tree under verification descends from four named anchor commits by ANCESTRY, not by tip '
      + 'equality: ONLINE_MAIN 3a340f3 -> COMMON_BASE 9d3bd70 -> {POST38_HEAD 190c990, FEDERATION_HEAD '
      + 'e63529e}, whose merge base is exactly COMMON_BASE, and the current HEAD descends from BOTH '
      + 'lineage heads. New commits landed after the two heads (the authority facade, the census '
      + 'convergence) are EXPECTED — the anchors are asserted as ancestors, so the tip may move '
      + 'forward without breaking identity, but it can never drop a lineage.',
    run(ctx) {
      if (!fs.existsSync(IDENTITY_FILE)) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [`source identity pin missing: ${IDENTITY_FILE}`],
        };
      }
      const pin = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
      ctx.identityPin = pin;
      const evidence = [];
      const hex40 = /^[0-9a-f]{40}$/;
      for (const [name, sha] of Object.entries(pin.sources)) {
        if (!hex40.test(sha)) {
          return { classification: 'REAL_REGRESSION', evidence: [`pinned ${name} is not a 40-hex sha: ${sha}`] };
        }
      }
      // RECONCILIATION (merged tree): the anchors resolve in THIS repository's own object database as
      // well as the reference mirror, because the merged branch descends from both lineage heads. Prefer
      // the mirror when reachable (it also carries the canonical remote main), but fall back to the local
      // object database rather than reporting ENVIRONMENT_MISSING when the anchors are locally present —
      // a sovereign checkout that already contains its own anchors does not need a network fetch to prove
      // its ancestry.
      const mirror = pin.referenceObjectDatabase ?? DEFAULT_MIRROR;
      const mirrorReachable = fs.existsSync(mirror) && git(['rev-parse', '--git-dir'], { cwd: mirror }).ok;
      const anchorsLocal = Object.values(pin.sources).every((sha) => git(['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT }).ok);
      const dbRoot = mirrorReachable ? mirror : (anchorsLocal ? ROOT : null);
      if (!dbRoot) {
        return environmentMissing(
          `neither the reference object database ${mirror} nor the local repository carries the four `
          + 'anchor commits, so their ancestry cannot be proved here (set CANA_SOURCE_MIRROR, or fetch '
          + 'the canonical remote)',
          { pinned: pin.sources, mirror },
        );
      }
      evidence.push(`anchor object database: ${dbRoot === ROOT ? 'local repository (anchors present in HEAD history)' : mirror}`);
      const g = (args) => git(args, { cwd: dbRoot, timeout: 300_000 });
      const failures = [];
      for (const [name, sha] of Object.entries(pin.sources)) {
        const exists = g(['cat-file', '-e', `${sha}^{commit}`]).ok;
        evidence.push(`anchor ${name} ${sha} resolves: ${exists}`);
        if (!exists) failures.push(`${name} ${sha} is not reachable in ${dbRoot}`);
      }
      // merge-base(POST38_HEAD, FEDERATION_HEAD) === COMMON_BASE — the two lineages diverge exactly here.
      const mergeBase = g(['merge-base', pin.sources.POST38_HEAD, pin.sources.FEDERATION_HEAD]);
      const observedBase = mergeBase.ok ? mergeBase.stdout.trim() : null;
      evidence.push(`merge-base(POST38_HEAD, FEDERATION_HEAD) = ${observedBase ?? 'unresolved'} (pinned COMMON_BASE ${pin.sources.COMMON_BASE})`);
      if (observedBase !== pin.sources.COMMON_BASE) {
        failures.push(`common base mismatch: observed ${observedBase}, pinned ${pin.sources.COMMON_BASE}`);
      }
      // Declared anchor-to-anchor ancestry (each [child, parent]: parent must be reachable from child).
      for (const [child, parent] of pin.ancestry) {
        const ok = g(['merge-base', '--is-ancestor', pin.sources[parent], pin.sources[child]]).status === 0;
        evidence.push(`${parent} is an ancestor of ${child}: ${ok}`);
        if (!ok) failures.push(`declared ancestry ${parent} -> ${child} does not hold`);
      }
      // THE CORE OF THE RECONCILIATION: the current HEAD must descend from BOTH lineage heads. This is
      // asserted against the LOCAL repository (HEAD only exists here), and it is what replaces the old
      // "tip must equal 190c990" expectation. A tip that has moved forward (new authority/census commits)
      // still passes; a tip that has abandoned a lineage cannot.
      const head = git(['rev-parse', 'HEAD'], { cwd: ROOT });
      const headSha = head.ok ? head.stdout.trim() : null;
      const descendFrom = pin.headMustDescendFrom ?? ['POST38_HEAD', 'FEDERATION_HEAD'];
      for (const name of descendFrom) {
        const anchor = pin.sources[name];
        const ok = git(['merge-base', '--is-ancestor', anchor, 'HEAD'], { cwd: ROOT }).status === 0;
        evidence.push(`HEAD ${headSha} descends from ${name} ${anchor}: ${ok}`);
        if (!ok) failures.push(`HEAD does not descend from ${name} ${anchor} — a sovereign lineage has been dropped`);
      }
      ctx.source = ctx.source ?? {};
      ctx.sourceIdentity = { anchors: pin.sources, head: headSha, observedBase };
      if (failures.length > 0) {
        return { classification: 'REAL_REGRESSION', evidence: [...evidence, ...failures], detail: { failures, anchors: pin.sources } };
      }
      return { classification: 'VERIFIED', evidence, detail: { anchors: pin.sources, head: headSha, mergeBase: observedBase } };
    },
  },

  // -------------------------------------------------------------------- 03
  {
    id: '03',
    key: 'capability-census',
    title: 'Capability census (Federation gate)',
    gate: 'HARD',
    proves:
      'The anti-duplication law is live: the owner registry loads and every capability has a real '
      + 'path on disk, the EC-0001 holdout still replays to its recorded verdicts, and no '
      + 'unresolved REFUSED_DUPLICATE declaration is outstanding. This is the gate POST38 lacks.',
    async run() {
      const gateModule = path.join(ROOT, 'tools', 'federation', 'census-gate.mjs');
      if (!fs.existsSync(gateModule)) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: ['tools/federation/census-gate.mjs is absent — the converged dispatcher must keep the Federation gate'],
        };
      }
      const { censusGateForVerify } = await import(gateModule);
      const gate = censusGateForVerify();
      const evidence = gate.findings.map((f) => `${f.ok ? 'ok' : 'REFUSED'} ${f.check}${f.why ? ` — ${f.why}` : ''}${f.cases ? ` (${f.cases} holdout cases)` : ''}${f.declarations !== undefined ? ` (${f.declarations} declarations)` : ''}`);
      if (!gate.ok) {
        const text = JSON.stringify(gate.findings);
        const verdict = classify(text);
        return { classification: verdict.classification, evidence, detail: gate };
      }
      return { classification: 'VERIFIED', evidence, detail: gate };
    },
  },

  // -------------------------------------------------------------------- 04
  {
    id: '04',
    key: 'authority-court',
    title: 'Authority court (conservation vs frozen baseline)',
    gate: 'SOFT',
    proves:
      'The CANA Authority single seat holds under adversarial courts, each concern reported on its own '
      + 'line: (1) authority UNIQUENESS — exactly one module mints a makeGrant-accepted authorization; '
      + '(2) OWNER GATES — a consumed owner nonce is refused on replay and the Node containment port '
      + 'matches the Python governor-kernel verdicts; (3) the HERMES BOUNDARY — a forged issuedBy, a '
      + 'self-authored objective, self-verification and a cross-tenant grant are all refused; (4) '
      + 'LEASE/RECLAIM — ACTIVE -> EXPIRED -> RECLAIMED fences the stale holder; (5) NONCE CONCURRENCY '
      + '— parallel processes racing one owner nonce yield exactly one winner. Each is classified '
      + 'independently; the tree needs python3 for the governor-kernel parity court.',
    run(ctx) {
      // RECONCILIATION (merged tree): phase5 stage 04 compared a tools/authority-court receipt to a
      // frozen baseline. This tree has no such receipt-emitting court and no baseline; the authority
      // plane lives in tools/authority. We run the five named authority concerns as INDIVIDUALLY
      // reported units against the real modules — never a single boolean — using the same courtUnit /
      // classification machinery every other stage uses.
      const AUTH_DIR = 'tools/authority';
      if (!fs.existsSync(path.join(ROOT, AUTH_DIR, 'authority.mjs'))) {
        return { classification: 'NOT_RUN', evidence: [`${AUTH_DIR}/authority.mjs is not present in this tree`] };
      }
      const slice = (name, file, pattern) => courtUnit(file, {
        label: name,
        extraArgs: pattern ? [`--test-name-pattern=${pattern}`] : [],
        timeout: 600_000,
      });
      const units = [
        // (1) authority uniqueness — the single seat.
        slice('authority uniqueness (single authorize seat)', 'tools/authority/single-seat.test.mjs'),
        // (2) owner gates — owner-nonce single-use + governor-kernel parity (owner-gate semantics).
        slice('owner gates: consumed owner nonce refused on replay', 'tools/authority/authority-court.test.mjs', 'owner nonce'),
        slice('owner gates: Node containment matches the Python governor-kernel', 'tools/authority/gk-compat.test.mjs'),
        // (3) the Hermes boundary — the whole boundary court.
        slice('Hermes boundary (forged issuedBy / self-authored / self-verify / cross-tenant refused)', 'tools/authority/hermes-boundary.test.mjs'),
        // (4) lease / reclaim.
        slice('lease/reclaim: ACTIVE -> EXPIRED -> RECLAIMED fences the stale holder', 'tools/authority/authority-court.test.mjs', 'lease reclaim'),
        // (5) nonce concurrency — the parallel-consumers race.
        slice('nonce concurrency: parallel processes racing one owner nonce yield exactly one winner', 'tools/authority/authority-court.test.mjs', 'parallel'),
      ];
      const stage = unitsToStage(units, 'authority courts');
      // Report EVERY named concern on its own line (not only the failing ones), so the owner's required
      // stage list is individually visible in the receipt whether it passed or not.
      stage.evidence = [
        stage.evidence[0],
        ...units.map((u) => `${u.classification} — ${u.unit}`
          + (u.counts && u.counts.pass != null ? ` (${u.counts.pass} pass${u.counts.fail ? `, ${u.counts.fail} fail` : ''})` : '')),
      ];
      return stage;
    },
  },

  // -------------------------------------------------------------------- 05
  {
    id: '05',
    key: 'migrations',
    title: 'Migrations',
    gate: 'SOFT',
    proves:
      'Statically: the migration manifest and the portability canary agree with the shipped '
      + 'prisma schema. Live: `prisma migrate deploy` applies the whole migration chain to a real '
      + 'PostgreSQL/PostGIS server, which is the only way the geo/PostGIS DDL is ever exercised.',
    run(ctx) {
      const units = [];
      units.push(courtUnit('apps/web/tests/migration-manifest.test.mjs'));
      units.push(courtUnit('apps/web/tests/migration-court.test.mjs', {
        extraArgs: ['--test-name-pattern=^PORTABILITY CANARY:'],
        label: 'apps/web/tests/migration-court.test.mjs [PORTABILITY CANARY]',
      }));
      const live = { unit: 'prisma migrate deploy (live PostgreSQL/PostGIS)' };
      if (!ctx.env.postgres.present) {
        Object.assign(live, {
          classification: 'ENVIRONMENT_MISSING',
          why: `no reachable PostgreSQL: ${ctx.env.postgres.why}`,
        });
      } else if (!ctx.env.prisma.present) {
        Object.assign(live, {
          classification: 'ENVIRONMENT_MISSING',
          why: `prisma is not installed: ${ctx.env.prisma.why}`,
        });
      } else {
        const r = run('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
          cwd: path.join(ROOT, 'apps', 'web'),
          timeout: 600_000,
        });
        if (r.ok) Object.assign(live, { classification: 'VERIFIED', output: tail(r.stdout, 1500) });
        else {
          const v = classify(r.combined);
          Object.assign(live, { classification: v.classification, why: v.reason, output: tail(r.combined, 2000) });
        }
      }
      units.push(live);
      return unitsToStage(units, 'migration courts');
    },
  },

  // -------------------------------------------------------------------- 06
  {
    id: '06',
    key: 'deterministic-courts',
    title: 'Deterministic courts (shared base)',
    gate: 'SOFT',
    proves:
      'The courts both sovereign lineages inherit from the common base still hold: the verifier '
      + 'itself, provenance sabotage, mission-2 lifecycle, market state, reality packets, github '
      + 'import, durability, the promotion gate and the cPanel/MariaDB simulators. '
      + 'PROMOTION-GATE DISPATCH (ES-0003): the current evaluator is selected by an EXPLICIT '
      + 'V1/V2/V3 contract, never a *.test.mjs glob. V3 plus its independent holdout judge the '
      + 'single manifest succession; frozen V2 runs only through the byte-identical e03 replay '
      + 'bridge, and V1 runs only in its disposable historical replay context.',
    run() {
      const files = [
        ...glob('tools/test-runner', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/provenance-court', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/mission-2', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/market-state', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/reality', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/github-import', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/durability', (n) => n.endsWith('.test.mjs')),
        // PROMOTION-GATE: EXPLICIT CONTRACT DISPATCH, not a blind glob (OWNER LAW #9).
        // Current promotion courts are exact-name enumerated. V1 and V2 execute only through
        // the bridge lanes inside ES-0003; no frozen or future court can join by filename.
        ...promotionGateSuccessorCourts(),
        ...glob('tools/cpanel-sim', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/mariadb-sim', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/growth-foundry/m001', (n) => n.endsWith('.test.mjs')),
      ];
      const units = files.map((f) => courtUnit(f));
      // Report the promotion-gate dispatch decision as its own evidence line so the receipt
      // shows V3 ran and both frozen evaluators were routed to replay, not current-globbed.
      const stage = unitsToStage(units, 'deterministic courts');
      stage.evidence.push(
        `promotion-gate dispatch: current lineage -> CANA_PROMOTION_IDENTITY_V3 `
        + `(${promotionGateSuccessorCourts().join(', ')}); V2 -> frozen e03 replay only; `
        + `V1 -> disposable historical replay only; neither is stage-06 globbed`,
      );
      return stage;
    },
  },

  // -------------------------------------------------------------------- 07
  {
    id: '07',
    key: 'federation-courts',
    title: 'Federation courts',
    gate: 'SOFT',
    proves:
      'The Federation lineage still holds: capability census semantics, the EC-0001 evolution case, '
      + 'the ES-0001 evaluator succession, federation contracts, memory settlement, and the '
      + 'blind-spot closure that registers the five POST38 mechanisms.',
    run() {
      return unitsToStage(
        glob('tools/federation', (n) => n.endsWith('.test.mjs')).map((f) => courtUnit(f)),
        'federation courts',
      );
    },
  },

  // -------------------------------------------------------------------- 08
  {
    id: '08',
    key: 'post38-courts',
    title: 'POST38 courts',
    gate: 'SOFT',
    proves:
      'The POST38 lineage still holds: alive loop, flywheel, custody sweep, Goodhart guard, slow '
      + 'and winner memory, forecast ledger, sentinel, the experience fabric and layout kernels, '
      + 'and the vanguard console / dual-forecast / economic layer / victory board.',
    run() {
      const files = [
        ...glob('tools/alive-loop', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/sentinel', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/experience-fabric', (n) => n.endsWith('.test.mjs')),
        ...glob('tools/vanguard', (n) => n.endsWith('.test.mjs')),
      ];
      return unitsToStage(files.map((f) => courtUnit(f)), 'POST38 courts');
    },
  },

  // -------------------------------------------------------------------- 09
  {
    id: '09',
    key: 'web-courts',
    title: 'Web courts',
    gate: 'SOFT',
    proves:
      'Every court under apps/web/tests is executed and classified on its own. Courts that only '
      + 'need node run here; courts that need the dependency tree, a build or a database say so by '
      + 'name instead of disappearing from the count.',
    run() {
      const files = glob('apps/web/tests', (n) => n.endsWith('.test.mjs'));
      if (files.length === 0) {
        return { classification: 'REAL_REGRESSION', evidence: ['apps/web/tests contains no court files'] };
      }
      // apps/web courts are cwd-sensitive; the package's own `test` script runs them
      // from apps/web (`node --test tests/*.test.mjs`), and container-verify.sh does
      // the same. Running them from the repository root would fabricate failures.
      const web = path.join(ROOT, 'apps', 'web');
      return unitsToStage(files.map((f) => courtUnit(f, { cwd: web })), 'web courts');
    },
  },

  // -------------------------------------------------------------------- 10
  {
    id: '10',
    key: 'typescript-lint',
    title: 'TypeScript and lint',
    gate: 'SOFT',
    proves:
      'The web application type-checks with no emit and passes the repository eslint configuration. '
      + 'Both require the installed dependency tree; neither can be simulated.',
    run(ctx) {
      const units = [];
      if (!ctx.env.typescript.present) {
        units.push({ unit: 'tsc --noEmit', classification: 'ENVIRONMENT_MISSING', why: ctx.env.typescript.why });
      } else {
        const r = run('npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
          cwd: path.join(ROOT, 'apps', 'web'), timeout: 900_000,
        });
        units.push(r.ok
          ? { unit: 'tsc --noEmit', classification: 'VERIFIED' }
          : { unit: 'tsc --noEmit', ...classify(r.combined), output: tail(r.combined, 3000) });
      }
      if (!ctx.env.eslint.present) {
        units.push({ unit: 'npm run lint -w apps/web', classification: 'ENVIRONMENT_MISSING', why: ctx.env.eslint.why });
      } else {
        const r = run('npm', ['run', 'lint', '-w', 'apps/web'], { timeout: 900_000 });
        if (r.ok) {
          units.push({ unit: 'npm run lint -w apps/web', classification: 'VERIFIED' });
        } else {
          // The human-formatted lint output is emitted longest-tail-first, so on a
          // failure carrying more than ~3 KB the error-level rules (the ones that
          // fail the gate) scroll off the top of the tailed receipt and are never
          // recorded — the triage could not enumerate the 8 errors from any
          // available evidence. Re-run eslint with the JSON formatter (a
          // diagnostic-only second invocation; the GATE is still `r.ok` above) and
          // append a complete, deterministic error-level listing so the receipt
          // carries file:line:col:rule for every error. Warnings stay in the
          // tailed human output. This changes NO verdict — it only surfaces the
          // already-failing rules. (WEB_COURT_TRIAGE R6 enumeration.)
          const errorListing = eslintErrorListing();
          const output = errorListing
            ? `${errorListing}\n--- human-formatted tail ---\n${tail(r.combined, 3000)}`
            : tail(r.combined, 3000);
          units.push({ unit: 'npm run lint -w apps/web', ...classify(r.combined), output });
        }
      }
      return unitsToStage(units.map((u) => ({ why: u.reason, ...u })), 'typescript/lint');
    },
  },

  // -------------------------------------------------------------------- 11
  {
    id: '11',
    key: 'production-build',
    title: 'Production build',
    gate: 'SOFT',
    proves:
      'apps/web builds for production from scratch, the BUILD_ID is newer than the start of the '
      + 'build (so a stale .next cannot masquerade as a build), and the build log carries zero '
      + 'entries from the forbidden-diagnostics policy.',
    run(ctx) {
      if (!ctx.env.next.present) {
        return environmentMissing(`next is not installed: ${ctx.env.next.why}`);
      }
      const web = path.join(ROOT, 'apps', 'web');
      const started = Math.floor(Date.now() / 1000);
      fs.rmSync(path.join(web, '.next'), { recursive: true, force: true });
      const build = run('npm', ['run', 'build', '--', '--webpack'], {
        cwd: web,
        timeout: 1_800_000,
        env: { ...process.env, CANA_RELEASE_SHA: ctx.source?.commit ?? '' },
      });
      const logFile = path.join(ctx.runRoot, 'build.log');
      fs.writeFileSync(logFile, build.combined);
      const units = [];
      units.push(build.ok
        ? { unit: 'next build', classification: 'VERIFIED' }
        : { unit: 'next build', ...classify(build.combined), output: tail(build.combined, 4000) });
      const buildIdFile = path.join(web, '.next', 'BUILD_ID');
      if (!fs.existsSync(buildIdFile)) {
        units.push({ unit: 'stale-build check', classification: 'REAL_REGRESSION', why: 'no .next/BUILD_ID was produced' });
      } else {
        const mtime = Math.floor(fs.statSync(buildIdFile).mtimeMs / 1000);
        units.push(mtime >= started
          ? { unit: 'stale-build check', classification: 'VERIFIED' }
          : { unit: 'stale-build check', classification: 'REAL_REGRESSION', why: `BUILD_ID mtime ${mtime} predates build start ${started}` });
        ctx.buildId = fs.readFileSync(buildIdFile, 'utf8').trim();
      }
      const diagnostics = run(process.execPath, ['tools/test-runner/build-output.mjs', logFile], { timeout: 120_000 });
      units.push(diagnostics.ok
        ? { unit: 'build diagnostics policy', classification: 'VERIFIED' }
        : { unit: 'build diagnostics policy', ...classify(diagnostics.combined), output: tail(diagnostics.combined, 2000) });
      return unitsToStage(units.map((u) => ({ why: u.reason, ...u })), 'production build');
    },
  },

  // -------------------------------------------------------------------- 12
  {
    id: '12',
    key: 'browser-courts',
    title: 'Browser / visual courts',
    gate: 'SOFT',
    proves:
      'The visual court laws hold twice: statically over the shipped source (the CI floor) and, '
      + 'when a Chromium binary and a running build exist, over real rendered geometry driven '
      + 'through the Chrome DevTools Protocol at eleven widths in both colour schemes.',
    run(ctx) {
      const units = [];
      const staticRunner = 'tools/visual-court/run-static.mjs';
      if (!fs.existsSync(path.join(ROOT, staticRunner))) {
        units.push({ unit: staticRunner, classification: 'NOT_RUN', why: 'the static visual court is absent from this tree' });
      } else {
        const r = run(process.execPath, [staticRunner], { timeout: 300_000 });
        units.push(r.ok
          ? { unit: `${staticRunner} (static floor)`, classification: 'VERIFIED' }
          : { unit: `${staticRunner} (static floor)`, ...classify(r.combined), output: tail(r.combined, 2500) });
      }
      units.push(courtUnit('apps/web/tests/visual-court.test.mjs'));
      const rendered = { unit: 'tools/visual-court/screenshot-harness.mjs (rendered CDP court)' };
      if (!ctx.env.chromium.present) {
        Object.assign(rendered, { classification: 'ENVIRONMENT_MISSING', why: ctx.env.chromium.why });
      } else if (!ctx.serverBaseUrl) {
        Object.assign(rendered, {
          classification: 'ENVIRONMENT_MISSING',
          why: 'a Chromium binary is present but no running production build was served to it '
            + '(set CANA_VISUAL_BASE_URL to a live `next start` of apps/web)',
        });
      } else {
        const r = run(process.execPath, [
          'tools/visual-court/screenshot-harness.mjs',
          '--base-url', ctx.serverBaseUrl,
          '--chromium', ctx.env.chromium.binary,
          '--out', path.join(ctx.runRoot, 'visual-court'),
        ], { timeout: 1_200_000 });
        Object.assign(rendered, r.ok
          ? { classification: 'VERIFIED' }
          : { ...classify(r.combined), output: tail(r.combined, 2500) });
      }
      units.push({ why: rendered.reason, ...rendered });
      return unitsToStage(units, 'browser/visual courts');
    },
  },

  // -------------------------------------------------------------------- 13
  {
    id: '13',
    key: 'security-adversarial',
    title: 'Security and adversarial courts',
    gate: 'SOFT',
    proves:
      'The boundary courts hold (security boundary, auth policy and throttle, education boundary, '
      + 'dependency security, verification laundering, provenance sabotage), and a live '
      + 'sabotage/restore probe shows the tree detects a one-line mutation of a tracked source '
      + 'file and restores it to the exact canonical blob.',
    run(ctx) {
      const files = [
        'apps/web/tests/security-boundary.test.mjs',
        'apps/web/tests/auth-policy.test.mjs',
        'apps/web/tests/auth-throttle.test.mjs',
        'apps/web/tests/education-boundary.test.mjs',
        'apps/web/tests/dependency-security.test.mjs',
        'apps/web/tests/verification-laundering.test.mjs',
        'apps/web/tests/interaction-proof.test.mjs',
        'tools/provenance-court/sabotage.test.mjs',
      ];
      const web = path.join(ROOT, 'apps', 'web');
      const units = files.map((f) => courtUnit(f, { cwd: f.startsWith('apps/web/') ? web : ROOT }));
      // live sabotage / exact-restore probe
      const probe = { unit: 'sabotage/restore probe (live mutation of a tracked source file)' };
      const relative = 'apps/web/src/lib/release-identity.mjs';
      const target = path.join(ROOT, relative);
      if (!ctx.source?.commit || !fs.existsSync(target)) {
        Object.assign(probe, { classification: 'NOT_RUN', why: `${relative} is not present, or HEAD is unknown` });
      } else {
        const before = sha256File(target);
        let restored = null;
        let sabotaged = null;
        let dirty = null;
        try {
          fs.appendFileSync(target, '\n// CANA sovereign verification-only sabotage probe\n');
          sabotaged = sha256File(target);
          dirty = gitOut(['status', '--porcelain', '--', relative]);
          const canonical = run('git', ['cat-file', 'blob', `${ctx.source.commit}:${relative}`], { maxBuffer: 32 * 1024 * 1024 });
          fs.writeFileSync(target, canonical.stdout);
          restored = sha256File(target);
        } finally {
          if (restored !== before) {
            const canonical = run('git', ['cat-file', 'blob', `${ctx.source.commit}:${relative}`], { maxBuffer: 32 * 1024 * 1024 });
            if (canonical.ok) fs.writeFileSync(target, canonical.stdout);
            restored = sha256File(target);
          }
        }
        const cleanAgain = gitOut(['status', '--porcelain']) === '';
        const detected = sabotaged !== before && dirty !== '';
        const exact = restored === before && cleanAgain;
        Object.assign(probe, detected && exact
          ? { classification: 'VERIFIED', detail: { before, sabotaged, restored } }
          : { classification: 'REAL_REGRESSION', why: `mutationDetected=${detected} restorationExact=${exact}`, detail: { before, sabotaged, restored, dirty, cleanAgain } });
      }
      units.push(probe);
      return unitsToStage(units, 'security/adversarial courts');
    },
  },

  // -------------------------------------------------------------------- 14
  {
    id: '14',
    key: 'reconstruction',
    title: 'Reconstruction / bundle proof',
    gate: 'SOFT',
    proves:
      'The whole history can be reconstituted from a single self-contained bundle: bundle -> clone '
      + '-> checkout -> `git fsck --full` -> the reconstructed commit and tree objects are '
      + 'identical to the source. Survivability, proved rather than asserted.',
    run(ctx) {
      if (!ctx.source?.commit) {
        return { classification: 'NOT_RUN', why: 'stage 01 did not establish a source commit', evidence: ['no source commit'] };
      }
      const bundle = path.join(ctx.runRoot, 'sovereign-source.bundle');
      const created = git(['bundle', 'create', bundle, 'HEAD'], { timeout: 600_000 });
      if (!created.ok) {
        return { classification: 'REAL_REGRESSION', evidence: [`git bundle create failed: ${tail(created.combined, 800)}`] };
      }
      const clone = path.join(ctx.runRoot, 'reconstructed');
      const cloned = git(['clone', '--quiet', '--no-checkout', bundle, clone], { timeout: 600_000 });
      if (!cloned.ok) {
        return { classification: 'REAL_REGRESSION', evidence: [`clone from bundle failed: ${tail(cloned.combined, 800)}`] };
      }
      const checkedOut = git(['checkout', '--quiet', ctx.source.commit], { cwd: clone, timeout: 600_000 });
      const fsck = git(['fsck', '--full', '--no-progress'], { cwd: clone, timeout: 900_000 });
      const commit = git(['rev-parse', 'HEAD'], { cwd: clone }).stdout.trim();
      const tree = git(['rev-parse', 'HEAD^{tree}'], { cwd: clone }).stdout.trim();
      const bundleSha256 = sha256File(bundle);
      ctx.bundle = { file: bundle, sha256: bundleSha256, bytes: fs.statSync(bundle).size };
      const identical = commit === ctx.source.commit && tree === ctx.source.tree;
      const evidence = [
        `bundle sha256 ${bundleSha256} (${ctx.bundle.bytes} bytes)`,
        `reconstructed commit ${commit} tree ${tree}`,
        `git fsck --full: ${fsck.ok ? 'clean' : `FAILED — ${tail(fsck.combined, 600)}`}`,
        `identity equality with the source checkout: ${identical}`,
      ];
      if (!checkedOut.ok || !fsck.ok || !identical) {
        return { classification: 'REAL_REGRESSION', evidence, detail: { commit, tree, expected: ctx.source } };
      }
      return { classification: 'VERIFIED', evidence, detail: { bundleSha256, commit, tree } };
    },
  },

  // -------------------------------------------------------------------- 15
  {
    id: '15',
    key: 'artifact-hashes',
    title: 'Artifact hashes',
    gate: 'SOFT',
    proves:
      'Everything this run depends on or produced is pinned by SHA-256 in one manifest: the '
      + 'dispatcher, the sovereign composition itself, the classification contract, the census '
      + 'registry, the source-identity pin, the CI workflow, the reconstruction bundle and any '
      + 'build output. The manifest digest is what the receipt commits to.',
    run(ctx) {
      const wanted = [
        'cana',
        'tools/test-runner/sovereign.mjs',
        'tools/test-runner/sovereign-classify.mjs',
        'tools/test-runner/sovereign-env.mjs',
        'tools/test-runner/runner.mjs',
        'tools/test-runner/receipt.mjs',
        'tools/test-runner/container-verify.sh',
        'tools/test-runner/Dockerfile',
        'tools/test-runner/SOVEREIGN_SOURCE_IDENTITY.json',
        // RECONCILIATION (merged tree): phase5 pinned tools/authority-court/AUTHORITY_BASELINE.json,
        // which does not exist here. This tree's authority plane is tools/authority; pin the single
        // seat and its two headline courts so the artifact manifest commits to the real authority code.
        'tools/authority/authority.mjs',
        'tools/authority/single-seat.test.mjs',
        'tools/authority/hermes-boundary.test.mjs',
        'tools/federation/census-gate.mjs',
        'tools/federation/capability-owners.json',
        'apps/web/prisma/schema.prisma',
        '.github/workflows/cana-verify-sovereign.yml',
      ];
      const artifacts = [];
      const missing = [];
      for (const rel of wanted) {
        const absolute = path.join(ROOT, rel);
        if (!fs.existsSync(absolute)) { missing.push(rel); continue; }
        artifacts.push({ path: rel, sha256: sha256File(absolute), bytes: fs.statSync(absolute).size });
      }
      if (ctx.bundle) {
        artifacts.push({ path: 'reconstruction.bundle (ephemeral)', sha256: ctx.bundle.sha256, bytes: ctx.bundle.bytes });
      }
      const buildId = path.join(ROOT, 'apps', 'web', '.next', 'BUILD_ID');
      if (fs.existsSync(buildId)) {
        artifacts.push({ path: 'apps/web/.next/BUILD_ID', sha256: sha256File(buildId), bytes: fs.statSync(buildId).size });
      }
      artifacts.sort((a, b) => a.path.localeCompare(b.path));
      const manifestDigest = sha256Bytes(artifacts.map((a) => `${a.sha256}  ${a.path}\n`).join(''));
      ctx.artifactManifest = { artifacts, manifestDigest, missing };
      const evidence = [
        `${artifacts.length} artifacts hashed; manifest digest ${manifestDigest}`,
        ...artifacts.map((a) => `${a.sha256}  ${a.path}`),
      ];
      if (missing.length > 0) {
        return {
          classification: 'REAL_REGRESSION',
          evidence: [...evidence, `artifacts the sovereign scope requires but could not find: ${missing.join(', ')}`],
          detail: ctx.artifactManifest,
        };
      }
      return { classification: 'VERIFIED', evidence, detail: ctx.artifactManifest };
    },
  },
];

export const SOVEREIGN_STAGES = STAGES.map((s) => ({
  id: s.id, key: s.key, title: s.title, gate: s.gate, proves: s.proves,
}));

// ---------------------------------------------------------------------------
// the composition
// ---------------------------------------------------------------------------

export async function runSovereignVerification(args = []) {
  const only = new Set(
    args.filter((a) => a.startsWith('--only=')).flatMap((a) => a.slice('--only='.length).split(',')),
  );
  const startedAt = new Date().toISOString();
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-sovereign-'));
  const env = probeAll(ROOT);
  PROBES = env;
  const ctx = {
    runRoot,
    env,
    results: [],
    source: null,
    serverBaseUrl: env.appServer.present ? env.appServer.baseUrl : null,
  };
  const results = [];
  let aborted = null;

  process.stdout.write(`\nCANA SOVEREIGN VERIFICATION — ${STAGES.length} stages\n`);
  process.stdout.write(`run root: ${runRoot}\n\n`);

  for (const stage of STAGES) {
    const head = `[${stage.id}] ${stage.title}`;
    if (aborted) {
      results.push({
        id: stage.id, key: stage.key, title: stage.title, gate: stage.gate, proves: stage.proves,
        classification: 'NOT_RUN',
        evidence: [`the composition failed closed at stage ${aborted.id} (${aborted.key}) with ${aborted.classification}`],
        durationMs: 0,
      });
      process.stdout.write(`${head.padEnd(52)} NOT_RUN\n`);
      continue;
    }
    const t0 = Date.now();
    let outcome;
    try {
      outcome = await stage.run(ctx);
    } catch (error) {
      const text = `${error?.stack ?? error?.message ?? error}`;
      const verdict = classify(text);
      outcome = {
        classification: verdict.classification,
        evidence: [`the stage threw: ${String(error?.message ?? error).slice(0, 400)}`, `classified as ${verdict.classification} — ${verdict.reason}`],
        detail: { stack: tail(text, 2000) },
      };
    }
    if (!CLASSIFICATIONS.includes(outcome.classification)) {
      throw new Error(`stage ${stage.key} returned an unknown classification: ${outcome.classification}`);
    }
    const record = {
      id: stage.id,
      key: stage.key,
      title: stage.title,
      gate: stage.gate,
      proves: stage.proves,
      classification: outcome.classification,
      evidence: outcome.evidence ?? [],
      units: outcome.units ?? null,
      detail: outcome.detail ?? null,
      durationMs: Date.now() - t0,
    };
    results.push(record);
    ctx.results = results;
    process.stdout.write(`${head.padEnd(52)} ${record.classification}  (${record.durationMs}ms)\n`);
    for (const line of record.evidence.slice(0, 4)) {
      process.stdout.write(`       ${String(line).slice(0, 160)}\n`);
    }
    if (stage.gate === 'HARD' && record.classification === 'REAL_REGRESSION') {
      aborted = record;
    }
  }

  const tally = {};
  for (const c of CLASSIFICATIONS) tally[c] = 0;
  for (const r of results) tally[r.classification] += 1;
  const verdict = results.every((r) => r.classification === 'VERIFIED')
    ? 'SOVEREIGN_VERIFIED'
    : 'REFUSED';
  const refusalReasons = results
    .filter((r) => r.classification !== 'VERIFIED')
    .map((r) => `${r.id} ${r.key}: ${r.classification}`);

  const stagesDigest = sha256Bytes(
    results.map((r) => `${r.id}\t${r.key}\t${r.classification}\n`).join(''),
  );

  const payload = {
    scope: 'sovereign',
    verdict,
    startedAt,
    finishedAt: new Date().toISOString(),
    repositoryRoot: ROOT,
    source: ctx.source,
    sourceIdentityPin: ctx.identityPin?.sources ?? null,
    stageCount: results.length,
    classificationVocabulary: CLASSIFICATIONS,
    tally,
    stagesDigest,
    refusalReasons,
    environment: env,
    stages: results,
    artifactManifest: ctx.artifactManifest ?? null,
    honesty: {
      contract:
        'A stage whose environment is absent reports ENVIRONMENT_MISSING; it is never skipped and '
        + 'never counted as a pass. The verdict is SOVEREIGN_VERIFIED only when every stage is VERIFIED.',
      environmentMissingStages: results.filter((r) => r.classification === 'ENVIRONMENT_MISSING').map((r) => r.key),
      notRunStages: results.filter((r) => r.classification === 'NOT_RUN').map((r) => r.key),
      realRegressionStages: results.filter((r) => r.classification === 'REAL_REGRESSION').map((r) => r.key),
    },
  };

  const receipt = writeReceipt('verify-sovereign', payload);
  fs.rmSync(runRoot, { recursive: true, force: true });

  process.stdout.write('\n--- SOVEREIGN VERDICT -------------------------------------------------\n');
  for (const [k, v] of Object.entries(tally)) {
    if (v > 0) process.stdout.write(`  ${String(v).padStart(3)}  ${k}\n`);
  }
  process.stdout.write(`  stages digest : ${stagesDigest}\n`);
  process.stdout.write(`  receipt       : ${receipt.file}\n`);
  process.stdout.write(`  receipt sha256: ${receipt.sha256}\n`);
  process.stdout.write(`  VERDICT       : ${verdict}\n`);
  if (verdict !== 'SOVEREIGN_VERIFIED') {
    process.stdout.write(`  refused because: ${refusalReasons.join('; ')}\n`);
  }
  process.stdout.write('-----------------------------------------------------------------------\n');

  if (process.env.CANA_SOVEREIGN_RECEIPT_COPY) {
    fs.mkdirSync(path.dirname(process.env.CANA_SOVEREIGN_RECEIPT_COPY), { recursive: true });
    fs.copyFileSync(receipt.file, process.env.CANA_SOVEREIGN_RECEIPT_COPY);
  }

  if (verdict !== 'SOVEREIGN_VERIFIED') process.exitCode = 1;
  return { ...receipt.body, receiptFile: receipt.file, receiptSha256: receipt.sha256 };
}
