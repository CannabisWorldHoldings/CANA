/**
 * Courts for the sovereign classification contract and the stage registry.
 * These run inside stage 06 of the composition they describe, so the contract
 * that decides "this failure is not the code's fault" is itself under court.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLASSIFICATIONS,
  NON_PASS,
  RULES,
  classifyFailure,
  worstClassification,
  severityOf,
} from './sovereign-classify.mjs';
import { SOVEREIGN_STAGES } from './sovereign.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the classification vocabulary is closed and contains the six non-pass classes', () => {
  assert.deepEqual(CLASSIFICATIONS, [
    'VERIFIED',
    'REAL_REGRESSION',
    'ENVIRONMENT_MISSING',
    'HISTORICAL_CONTEXT_MISMATCH',
    'OWNERSHIP_MANIFEST_CONTEXT',
    'LIVE_LEDGER_CONTEXT',
    'NOT_RUN',
  ]);
  assert.equal(NON_PASS.length, 6);
  assert.ok(!NON_PASS.includes('VERIFIED'));
});

test('no rule can classify a failure as VERIFIED — a failure is never a pass', () => {
  for (const rule of RULES) {
    assert.notEqual(rule.classification, 'VERIFIED');
    assert.ok(CLASSIFICATIONS.includes(rule.classification), `${rule.classification} is outside the vocabulary`);
    assert.ok(rule.patterns.length > 0);
    assert.ok(typeof rule.reason === 'string' && rule.reason.length > 0);
  }
});

test('an unexplained failure defaults to REAL_REGRESSION — nothing is excused by accident', () => {
  const verdict = classifyFailure('AssertionError: expected 3 to equal 4\n  at Object.<anonymous>');
  assert.equal(verdict.classification, 'REAL_REGRESSION');
  assert.equal(verdict.matched, null);
});

test('a missing docker daemon is ENVIRONMENT_MISSING, exactly as the handoff observed', () => {
  const verdict = classifyFailure('docker failed to start: spawnSync docker ENOENT');
  assert.equal(verdict.classification, 'ENVIRONMENT_MISSING');
});

test('a missing dependency tree is ENVIRONMENT_MISSING, not a broken court', () => {
  for (const text of [
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@prisma/client' imported from /x/y.mjs",
    "Cannot find module 'next/server'",
    '@prisma/client did not initialize yet. Please run "prisma generate"',
  ]) {
    assert.equal(classifyFailure(text).classification, 'ENVIRONMENT_MISSING', text);
  }
});

test('an unreachable PostgreSQL and a missing PostGIS/H3 extension are ENVIRONMENT_MISSING', () => {
  for (const text of [
    'Error: connect ECONNREFUSED 127.0.0.1:5432',
    'DATABASE_URL is required for this court',
    'ERROR: extension "h3" is not available',
    'ERROR: extension "postgis" is not available',
  ]) {
    assert.equal(classifyFailure(text).classification, 'ENVIRONMENT_MISSING', text);
  }
});

test('the ownership manifest failures the phase-1 court run found stay their own class', () => {
  for (const text of [
    'Error: ownership manifest has unknown or missing assignments',
    'changed-file ownership patterns failed the owner-approved scope digest',
    'analysis reports prohibitedSourceChanged: true',
  ]) {
    assert.equal(classifyFailure(text).classification, 'OWNERSHIP_MANIFEST_CONTEXT', text);
  }
});

test('a reference this checkout does not carry is HISTORICAL_CONTEXT_MISMATCH', () => {
  const text = "fatal: ambiguous argument 'recover/competitive-ui-day-night': unknown revision or path not in the working tree.";
  assert.equal(classifyFailure(text).classification, 'HISTORICAL_CONTEXT_MISMATCH');
});

test('absent live ledger state is LIVE_LEDGER_CONTEXT, never a pass and never a regression', () => {
  for (const text of [
    "ENOENT: no such file or directory, open '/repo/.cana-local/federation/declarations.jsonl'",
    'Error: invalid CANA receipt session',
  ]) {
    assert.equal(classifyFailure(text).classification, 'LIVE_LEDGER_CONTEXT', text);
  }
});

test('environment faults outrank content explanations in the precedence order', () => {
  // A court that cannot even load its dependencies has no trustworthy opinion about
  // the ownership manifest, so the environment classification must win.
  const text = "Cannot find package '@prisma/client'\nownership manifest has unknown or missing assignments";
  assert.equal(classifyFailure(text).classification, 'ENVIRONMENT_MISSING');
});

test('an environment excuse is refused when the environment is actually present', () => {
  const bare = { nodeModules: { root: false }, postgres: { present: false }, appServer: { present: false }, chromium: { present: false } };
  const full = { nodeModules: { root: true }, postgres: { present: true }, appServer: { present: true }, chromium: { present: true } };
  const cases = [
    "Cannot find package '@prisma/client'",
    'Error: prisma CLI not found',
    'Error: connect ECONNREFUSED 127.0.0.1:5432',
    'Error: server did not become ready',
  ];
  for (const text of cases) {
    assert.equal(classifyFailure(text, { env: bare }).classification, 'ENVIRONMENT_MISSING', `bare: ${text}`);
    assert.equal(classifyFailure(text, { env: full }).classification, 'REAL_REGRESSION', `provisioned: ${text}`);
  }
  // Unconditional rules stay unconditional: a missing binary is never ambiguous.
  assert.equal(
    classifyFailure('docker failed to start: spawnSync docker ENOENT', { env: full }).classification,
    'ENVIRONMENT_MISSING',
  );
  // Content classes are never softened by a rich environment.
  assert.equal(
    classifyFailure('ownership manifest has unknown or missing assignments', { env: full }).classification,
    'OWNERSHIP_MANIFEST_CONTEXT',
  );
});

test('worst-of aggregation never lets a failing unit hide behind passing units', () => {
  assert.equal(worstClassification(['VERIFIED', 'VERIFIED']), 'VERIFIED');
  assert.equal(worstClassification(['VERIFIED', 'ENVIRONMENT_MISSING']), 'ENVIRONMENT_MISSING');
  assert.equal(worstClassification(['ENVIRONMENT_MISSING', 'REAL_REGRESSION']), 'REAL_REGRESSION');
  assert.equal(worstClassification(['NOT_RUN', 'VERIFIED']), 'NOT_RUN');
  assert.equal(worstClassification([]), 'VERIFIED');
  assert.throws(() => worstClassification(['PROBABLY_FINE']), /unknown classification/);
});

test('severity is total over the vocabulary and REAL_REGRESSION is the maximum', () => {
  const severities = CLASSIFICATIONS.map((c) => severityOf(c));
  assert.equal(new Set(severities).size, CLASSIFICATIONS.length);
  assert.equal(severityOf('VERIFIED'), 0);
  assert.equal(Math.max(...severities), severityOf('REAL_REGRESSION'));
});

test('the stage registry is the fifteen-stage composition, in the declared order', () => {
  assert.equal(SOVEREIGN_STAGES.length, 15);
  assert.deepEqual(SOVEREIGN_STAGES.map((s) => s.key), [
    'clean-checkout',
    'source-identity',
    'capability-census',
    'authority-court',
    'migrations',
    'deterministic-courts',
    'federation-courts',
    'post38-courts',
    'web-courts',
    'typescript-lint',
    'production-build',
    'browser-courts',
    'security-adversarial',
    'reconstruction',
    'artifact-hashes',
  ]);
  assert.deepEqual(
    SOVEREIGN_STAGES.map((s) => s.id),
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'],
  );
  for (const stage of SOVEREIGN_STAGES) {
    assert.ok(stage.proves.length > 40, `${stage.key} must say what it proves`);
    assert.ok(['HARD', 'SOFT'].includes(stage.gate));
  }
});

test('the first three stages are HARD gates — identity and the census cannot be soft', () => {
  assert.deepEqual(
    SOVEREIGN_STAGES.filter((s) => s.gate === 'HARD').map((s) => s.key),
    ['clean-checkout', 'source-identity', 'capability-census'],
  );
});

test('Stage 13 and the authoritative H3 workflow require the exact Linux custody courts', () => {
  const sovereign = fs.readFileSync(path.join(ROOT, 'tools', 'test-runner', 'sovereign.mjs'), 'utf8');
  for (const relative of [
    'tools/visual-court/linux-custody.test.mjs',
    'tools/visual-court/output-custody.test.mjs',
    'tools/visual-court/process-custody.test.mjs',
    'tools/visual-court/screenshot-harness.test.mjs',
  ]) {
    assert.ok(sovereign.includes(`'${relative}'`), `${relative} must be a Stage 13 unit`);
  }
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'cana-verify-sovereign.yml'),
    'utf8',
  );
  assert.match(workflow, /node-version: 24\.14\.1/);
  assert.match(workflow, /cc -std=c11 -O2 -Wall -Wextra -Werror/);
  assert.match(workflow, /CANA_LINUX_CUSTODY_SOURCE_SHA256=/);
  assert.match(workflow, /CANA_LINUX_CUSTODY_BINARY_SHA256=/);
  assert.match(workflow, /\.\/cana verify sovereign/);
});

test('Stage 06 dispatches only the current ES-0004 courts and freezes ES-0003', () => {
  const sovereign = fs.readFileSync(path.join(ROOT, 'tools', 'test-runner', 'sovereign.mjs'), 'utf8');
  const dispatch = /function promotionGateSuccessorCourts\(\) \{([\s\S]*?)\n\}/.exec(sovereign)?.[1] ?? '';
  assert.match(dispatch, /es-0004\.court\.test\.mjs/);
  assert.match(dispatch, /es-0004\.holdout\.court\.test\.mjs/);
  assert.doesNotMatch(dispatch, /es-0003\.court\.test\.mjs/);
  assert.match(sovereign, /V3 -> frozen 99ef replay only/);
});

test('the converged dispatcher keeps the Federation census gate ahead of every verify', () => {
  const dispatcher = fs.readFileSync(path.join(ROOT, 'cana'), 'utf8');
  const verifyIndex = dispatcher.indexOf("scope === 'verify'");
  const gateIndex = dispatcher.indexOf('censusGateForVerify');
  const runnerIndex = dispatcher.indexOf('runVerification');
  assert.ok(verifyIndex > -1, 'the dispatcher must handle verify');
  assert.ok(gateIndex > verifyIndex, 'the census gate must sit inside the verify branch');
  assert.ok(gateIndex < runnerIndex, 'the census gate must run BEFORE the court, not after');
  assert.match(dispatcher, /\.\/cana verify sovereign/);
});

test('sovereign is routed as a composition, not registered as an alias of a standard profile', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'tools', 'test-runner', 'runner.mjs'), 'utf8');
  const standard = /const STANDARD_PROFILES = new Set\(\[([^\]]*)\]\)/.exec(runner);
  assert.ok(standard, 'STANDARD_PROFILES must still exist');
  assert.ok(!standard[1].includes('sovereign'), 'sovereign must not be aliased into a container profile');
  assert.match(runner, /runSovereignVerification/);
});
