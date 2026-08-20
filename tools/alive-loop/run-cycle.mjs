#!/usr/bin/env node
// ALIVE LOOP v1 — live cycle runner. Executes ONE governed cycle against the
// real repository state with a bounded, zero-effect local fixture.
//
// Usage: node tools/alive-loop/run-cycle.mjs --mission <static-court|pure-suites|public-copy>
//
// Every mission here is LEVEL 0/1 (observe + local verification): provider
// route 'none', cost 0, zero external effects. Receipts land append-only in
// .cana-local/alive-loop/ (untracked), one JSONL chain per idempotency key.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { idempotencyKey, runCycle } from './adapter.mjs';
import { LessonStore, lessonsAsFacts } from './winner-memory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const args = process.argv.slice(2);
const missionName = args[args.indexOf('--mission') + 1] ?? 'static-court';
const missionVersion = args.includes('--version') ? Number(args[args.indexOf('--version') + 1]) || 1 : 1;

const HEAD = git('rev-parse', 'HEAD');
const TREE = git('rev-parse', 'HEAD^{tree}');
const NOW = new Date();

/** Bounded local fixtures. Each returns evidence, zero side effects, honest measurement. */
const FIXTURES = {
  'static-court': {
    objective: 'prove the static visual court verdict holds at the pinned tree',
    metric: 'tools/visual-court/run-static.mjs exits 0 with verdict PASS',
    target: 'visual-court',
    allowed_paths: ['tools/visual-court', 'apps/web/src', 'apps/web/tests'],
    subjects: ['visual court'],
    run: () => {
      const proc = spawnSync('node', ['tools/visual-court/run-static.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
      let verdict = 'UNPARSEABLE';
      try { verdict = JSON.parse(proc.stdout).verdict; } catch { /* stays UNPARSEABLE */ }
      const pass = proc.status === 0 && verdict === 'PASS';
      return {
        succeeded: pass,
        failureReason: pass ? undefined : `run-static exit ${proc.status}, verdict ${verdict}`,
        evidence: pass ? [{ observation: `run-static verdict ${verdict} (exit 0)`, ref: 'tools/visual-court/run-static.mjs stdout' }] : [],
        observed_side_effects: 0,
        touched_paths: ['tools/visual-court/run-static.mjs'],
        output: { verdict, exit: proc.status },
        measurement: { source: 'tools/visual-court/run-static.mjs', window: 'single-run', improved: pass, value: verdict },
      };
    },
  },
  'pure-suites': {
    objective: 'prove the transplanted mechanism suites hold at the pinned tree',
    metric: 'seven T-chain suites plus customer-world report zero failures under node --test',
    target: 'mechanism-suites',
    allowed_paths: ['apps/web/tests', 'apps/web/src'],
    subjects: ['mechanism suites'],
    run: () => {
      const suites = ['entity-genome', 'market-graph-projection', 'market-page-compiler', 'service-area',
        'discovery-command', 'discovery-resolution', 'merchant-media-intake', 'customer-world'];
      const files = suites.map((s) => `tests/${s}.test.mjs`);
      const proc = spawnSync('node', ['--test', ...files], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8', timeout: 300000 });
      const fails = Number((proc.stdout.match(/ℹ fail (\d+)/) ?? [])[1] ?? 'NaN');
      const passes = Number((proc.stdout.match(/ℹ pass (\d+)/) ?? [])[1] ?? 'NaN');
      const ok = proc.status === 0 && fails === 0 && passes > 0;
      return {
        succeeded: ok,
        failureReason: ok ? undefined : `node --test exit ${proc.status}, fails=${fails}`,
        evidence: ok ? [{ observation: `${passes} assertions pass, 0 fail across ${suites.length} suites`, ref: 'node --test stdout' }] : [],
        observed_side_effects: 0,
        touched_paths: ['apps/web/tests'],
        output: { passes, fails, exit: proc.status },
        measurement: { source: 'node --test', window: 'single-run', improved: ok, value: `${passes}/0` },
      };
    },
  },
  'public-copy': {
    objective: 'prove consumer surfaces carry no internal vocabulary at the pinned tree',
    metric: 'court A16.public-copy-vocabulary reports PASS',
    target: 'public-copy',
    allowed_paths: ['tools/visual-court', 'apps/web/src'],
    subjects: ['public copy'],
    run: () => {
      const proc = spawnSync('node', ['tools/visual-court/run-static.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
      let a16 = null;
      try { a16 = JSON.parse(proc.stdout).checks.find((c) => c.id.includes('public-copy')); } catch { /* refused below */ }
      const pass = a16?.status === 'PASS';
      return {
        succeeded: pass,
        failureReason: pass ? undefined : `A16 status ${a16?.status ?? 'ABSENT'}`,
        evidence: pass ? [{ observation: `A16 ${a16.status}: ${a16.detail}`, ref: 'tools/visual-court/run-static.mjs stdout' }] : [],
        observed_side_effects: 0,
        touched_paths: ['tools/visual-court/run-static.mjs'],
        output: { a16 },
        measurement: { source: 'visual-court A16', window: 'single-run', improved: pass, value: a16?.status ?? 'ABSENT' },
      };
    },
  },
  'sentinel-sweep': {
    objective: 'observe competitor and own public surfaces and compile drift into triage-ready candidates',
    metric: 'shadow sweep produces a parseable report and every delta compiles through the signal-to-fix court',
    target: 'competitive-sentinel',
    allowed_paths: ['apps/web/scripts', 'tools/sentinel', '.cana-local'],
    subjects: ['competitive sentinel'],
    run: async () => {
      const outDir = path.join(ROOT, '.cana-local', 'sentinel');
      const proc = spawnSync('node', ['apps/web/scripts/competitor-shadow.mjs', `--dir=${outDir}`], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
      const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
      let report = null; let reportFile = null;
      try {
        reportFile = readdirSync(outDir).filter((f) => f.endsWith('.json')).sort().pop() ?? null;
        if (reportFile) report = JSON.parse(readFileSync(path.join(outDir, reportFile), 'utf8'));
      } catch { /* stays null */ }
      const deltas = report?.deltas ?? report?.diff?.deltas ?? [];
      const { compileSentinelProposals } = await import('../sentinel/bridge.mjs');
      const compiled = compileSentinelProposals(deltas, {
        observedAt: new Date().toISOString(),
        reportRef: reportFile ? `.cana-local/sentinel/${reportFile}` : 'no-report',
      });
      if (reportFile) {
        writeFileSync(path.join(outDir, `proposals-${Date.now()}.json`), JSON.stringify(compiled, null, 2));
      }
      const ok = proc.status === 0 && report !== null;
      return {
        succeeded: ok,
        failureReason: ok ? undefined : `shadow exit ${proc.status}, report ${reportFile ?? 'ABSENT'}`,
        evidence: ok ? [{ observation: `sweep report ${reportFile}: ${(report.results ?? []).length} surfaces, ${deltas.length} deltas, ${compiled.proposals.length} proposals, ${compiled.skipped.length} skipped`, ref: `.cana-local/sentinel/${reportFile}` }] : [],
        observed_side_effects: 0,
        touched_paths: ['.cana-local/sentinel'],
        output: { surfaces: (report?.results ?? []).length, deltas: deltas.length, proposals: compiled.proposals.length },
        measurement: { source: 'competitor-shadow + sentinel-bridge', window: 'single-sweep', improved: ok, value: `deltas=${deltas.length}` },
      };
    },
  },
};

const mission = FIXTURES[missionName];
if (!mission) {
  console.error(`unknown mission ${missionName}; known: ${Object.keys(FIXTURES).join(', ')}`);
  process.exit(2);
}

const grant = {
  mission_id: `alive-${missionName}`,
  mission_version: missionVersion,
  issued_at: NOW.toISOString(),
  expires_at: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
  cana_commit: HEAD,
  cana_tree: TREE,
  target: mission.target,
  allowed_paths: mission.allowed_paths,
  objective: mission.objective,
  metric: mission.metric,
  max_attempts: 1,
  max_runtime_ms: 300000,
  max_bytes: 4194304,
  max_cost: 0,
  capabilities: ['RUN_TESTS'],
  evidence_requirements: ['execution receipt', 'measured verdict'],
  policy_version: 'cana-authority/1',
  schema_version: 'cana-alive-loop/1',
  provider_route: 'none',
};
grant.idempotency_key = idempotencyKey(grant);

// RECURSION IN: recall prior admitted lessons and fold them into this cycle's
// context, so the system reasons with its own measured past — not a blank slate.
const lessonStore = new LessonStore(path.join(ROOT, '.cana-local', 'winner-memory', 'lessons.jsonl'));
const priorLessons = lessonStore.recall({ limit: 25 });
const recalledFacts = lessonsAsFacts(priorLessons, { now: NOW });

const facts = [{
  id: `fact-head-${HEAD.slice(0, 12)}`,
  claim: `candidate tree pinned at ${HEAD.slice(0, 12)} for ${mission.target} verification: ${mission.metric}`,
  authority: 'INDEPENDENTLY_VERIFIED_RECEIPT',
  truth_status: 'VERIFIED',
  source: 'git rev-parse HEAD (local clone)',
  observed_at: NOW.toISOString().slice(0, 10),
  valid_for_days: 1,
  tags: [mission.target, 'verification', 'pinned', 'tree', ...mission.subjects],
}, ...recalledFacts];

const result = await runCycle({
  grant,
  facts,
  fixture: mission.run,
  storeDir: path.join(ROOT, '.cana-local', 'alive-loop'),
  now: NOW,
  repoHead: HEAD,
  repoTree: TREE,
  intentSubjects: mission.subjects,
});

// RECURSION OUT: an admitted lesson persists to the durable store (dedupe-safe
// on idempotent re-runs), becoming context for every future cycle.
let persisted = null;
if (result.admitted && result.lesson) {
  try { persisted = lessonStore.persist(result.lesson); } catch (err) { persisted = { error: err.message }; }
}

console.log(JSON.stringify({
  mission: grant.mission_id,
  pinned: HEAD.slice(0, 12),
  final_state: result.final_state,
  resumed: result.resumed,
  admitted: result.admitted ?? null,
  lesson_id: result.lesson?.lesson_id ?? null,
  rejection_reason: result.rejection_reason ?? null,
  recalled_prior_lessons: priorLessons.length,
  lesson_persisted: persisted,
  winner_memory_total: lessonStore.verifyChain().count,
  chain: result.chain ?? null,
  store: path.relative(ROOT, result.store_path),
}, null, 2));
process.exit(result.final_state === 'CLOSED' ? 0 : 1);
