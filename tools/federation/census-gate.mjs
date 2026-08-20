#!/usr/bin/env node
/**
 * CENSUS GATE — enforcement wiring for the capability census (EC-0001's
 * promoted mutation) into the ./cana verify path.
 *
 * Semantics (deterministic, fail-closed):
 *  1. REGISTRY INTEGRITY — the owners registry must load and every owner
 *     must have at least one owner path present on disk. A census that
 *     cannot see its registry refuses, and so does verify.
 *  2. HOLDOUT REPLAY — the EC-0001 measured holdout must still pass at
 *     verify time. If the census regresses (an evasion the holdout covers
 *     starts slipping through, or a false refusal appears), verify refuses.
 *  3. DECLARATION COURT — builders declare new capabilities via
 *     `./cana census declare "<what you intend to build>"`. Declarations are
 *     recorded (append-only) under .cana-local/federation/declarations.jsonl.
 *     Any declaration whose verdict is REFUSED_DUPLICATE and which has not
 *     been explicitly resolved (`./cana census resolve <id> --as <how>`)
 *     blocks verify. Extend-the-owner is the expected resolution.
 *
 * This module is invoked by the `cana` dispatcher BEFORE the verification
 * court runs; it never modifies the court itself (tools/test-runner stays
 * untouched). Exit codes: 0 clear, 1 refused, 2 usage/integrity error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusVerdict, loadOwners } from './capability-census.mjs';
import { runHoldout } from './ec-0001.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DECLS = path.join(ROOT, '.cana-local', 'federation', 'declarations.jsonl');

const readDecls = () => (fs.existsSync(DECLS)
  ? fs.readFileSync(DECLS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);
const appendDecl = (row) => {
  fs.mkdirSync(path.dirname(DECLS), { recursive: true });
  fs.appendFileSync(DECLS, JSON.stringify(row) + '\n');
};

/** Current state per declaration id (append-only; last row wins). */
const currentDecls = () => {
  const m = new Map();
  for (const r of readDecls()) m.set(r.id, r);
  return [...m.values()];
};

/** The verify-time gate. Returns { ok, findings } and never throws for refusals. */
export function censusGateForVerify() {
  const findings = [];
  let owners;
  try {
    owners = loadOwners();
  } catch (e) {
    return { ok: false, findings: [{ check: 'registry_integrity', ok: false, why: String(e.message ?? e) }] };
  }
  const missing = owners.filter((o) => !o.owner_paths.some((p) => fs.existsSync(path.join(ROOT, p))));
  if (missing.length > 0) findings.push({ check: 'registry_integrity', ok: false, why: `owners with no path on disk: ${missing.map((o) => o.capability).join(', ')}` });
  else findings.push({ check: 'registry_integrity', ok: true });

  const holdout = runHoldout();
  const failed = holdout.filter((h) => !h.pass);
  if (failed.length > 0) findings.push({ check: 'holdout_replay', ok: false, why: failed.map((f) => `${f.case}: expected ${f.expected} observed ${f.observed}`).join('; ') });
  else findings.push({ check: 'holdout_replay', ok: true, cases: holdout.length });

  const unresolved = currentDecls().filter((d) => d.verdict === 'REFUSED_DUPLICATE' && !d.resolved);
  if (unresolved.length > 0) {
    findings.push({
      check: 'declaration_court',
      ok: false,
      why: unresolved.map((d) => `${d.id} "${d.proposal.slice(0, 60)}" collides with ${d.collisions.join(', ')} — resolve with ./cana census resolve ${d.id} --as "<extend-the-owner plan>"`).join(' | '),
    });
  } else findings.push({ check: 'declaration_court', ok: true, declarations: currentDecls().length });

  return { ok: findings.every((f) => f.ok), findings };
}

export async function runCensus(action, rest) {
  if (action === 'declare') {
    const proposal = rest.join(' ').trim();
    if (!proposal) { process.stderr.write('usage: ./cana census declare "<what you intend to build>"\n'); process.exitCode = 2; return; }
    const v = censusVerdict(proposal, loadOwners());
    const id = 'decl_' + Date.now().toString(36);
    const row = { id, at: new Date().toISOString(), proposal, verdict: v.verdict, collisions: v.collisions.map((c) => c.capability), resolved: false };
    appendDecl(row);
    process.stdout.write(JSON.stringify({ ...row, detail: v.collisions }, null, 2) + '\n');
    process.exitCode = v.verdict === 'CLEAR_TO_BUILD' ? 0 : 1;
    return;
  }
  if (action === 'resolve') {
    const id = rest[0];
    const asIdx = rest.indexOf('--as');
    const resolution = asIdx > -1 ? rest.slice(asIdx + 1).join(' ').trim() : '';
    const decl = currentDecls().find((d) => d.id === id);
    if (!decl) { process.stderr.write(`unknown declaration ${id}\n`); process.exitCode = 2; return; }
    if (!resolution) { process.stderr.write('resolution requires --as "<how the collision was resolved>" — silence is not a resolution\n'); process.exitCode = 2; return; }
    appendDecl({ ...decl, resolved: true, resolution, resolved_at: new Date().toISOString() });
    process.stdout.write(JSON.stringify({ id, resolved: true, resolution }, null, 2) + '\n');
    return;
  }
  if (action === 'status' || action === 'check') {
    const gate = censusGateForVerify();
    process.stdout.write(JSON.stringify(gate, null, 2) + '\n');
    process.exitCode = gate.ok ? 0 : 1;
    return;
  }
  process.stderr.write('usage: ./cana census declare|resolve|status\n');
  process.exitCode = 2;
}
