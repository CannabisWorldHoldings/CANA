#!/usr/bin/env node
/**
 * CAPABILITY CENSUS — the promoted mutation from EvolutionCase EC-0001
 * (sentinel-duplication, 2026-08-18).
 *
 * THE FAILURE IT PREVENTS: a new capability was built against origin/main's
 * capability universe while the real owner of that capability lived on a
 * recovered local-only lineage. Census makes "who already owns this job?"
 * a deterministic pre-build court instead of a memory the builder may skip.
 *
 * ONE CAPABILITY → ONE CANONICAL OWNER (§74). The census refuses a proposal
 * whose fundamental job matches a registered owner, and refuses to run at
 * all when the owners registry is missing or unparseable (fail closed).
 *
 * Usage:
 *   node tools/federation/capability-census.mjs --propose "fingerprint competitor pages daily"
 *   → exit 1 + owner citation when the job is already owned; exit 0 when clear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * v2 word folding (evaluator succession ES-0001): folds common English
 * inflections so "competitors/fingerprinting/drifts" match
 * "competitor/fingerprint/drift". Deliberately conservative — stems only
 * unambiguous suffixes; short words are left alone to avoid false refusals.
 */
export const foldV2 = (w) => {
  if (w.length <= 4) return w;
  let s = w;
  if (s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ing') && s.length > 6) { s = s.slice(0, -3); if (s.endsWith('nn') || s.endsWith('tt')) s = s.slice(0, -1); }
  else if (s.endsWith('ed') && s.length > 5) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  // terminal-e neutralization so gerund stems meet their base ("storing"->"stor" == "store"->"stor").
  // Repair iteration v2.1 — the ES-0001 holdout caught the e-drop inconsistency (case S3).
  if (s.length >= 5 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
};
const normV2 = (s) => norm(s).map(foldV2);

export function loadOwners(file = path.join(HERE, 'capability-owners.json')) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')); // throws => census cannot run => build cannot proceed
  if (!Array.isArray(raw.owners) || raw.owners.length === 0) throw new Error('owners registry empty — census fails closed');
  for (const o of raw.owners) {
    if (!o.capability || !Array.isArray(o.job_terms) || o.job_terms.length === 0 || !Array.isArray(o.owner_paths) || o.owner_paths.length === 0) {
      throw new Error(`malformed owner entry: ${JSON.stringify(o).slice(0, 80)}`);
    }
  }
  return raw.owners;
}

/** Evaluator versions. CURRENT is set by the committed evaluator registry (ES-0001). */
export function currentEvaluatorVersion(file = path.join(HERE, 'evaluator-registry.json')) {
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cur = (reg.evaluators ?? []).find((e) => e.scope === 'capability-census-term-matching' && e.status === 'INCUMBENT');
  if (!cur) throw new Error('no INCUMBENT census evaluator in registry — census fails closed');
  return cur.version;
}

/**
 * A proposal collides with an owner when it matches >=2 of the owner's job
 * terms (single-term matches are too noisy; zero-term matches are clear).
 * Term matching is versioned: v1 exact words, v2 inflection-folded (ES-0001).
 */
export function censusVerdict(proposal, owners, { repoRoot = path.resolve(HERE, '..', '..'), version = null } = {}) {
  const v = version ?? currentEvaluatorVersion();
  const normalize = v === 'v2' ? normV2 : norm;
  const words = new Set(normalize(proposal));
  const collisions = [];
  for (const o of owners) {
    const hits = o.job_terms.filter((t) => normalize(t).every((w) => words.has(w)));
    if (hits.length >= 2) {
      const existing = o.owner_paths.filter((p) => fs.existsSync(path.join(repoRoot, p)));
      collisions.push({
        capability: o.capability,
        matched_terms: hits,
        owner_paths: o.owner_paths,
        owner_paths_present: existing,
        law: 'ONE CAPABILITY -> ONE CANONICAL OWNER: extend the owner, do not rebuild the job',
      });
    }
  }
  return {
    proposal,
    verdict: collisions.length === 0 ? 'CLEAR_TO_BUILD' : 'REFUSED_DUPLICATE',
    collisions,
  };
}

async function main() {
  const i = process.argv.indexOf('--propose');
  const proposal = i > -1 ? process.argv[i + 1] : null;
  if (!proposal) { console.error('usage: capability-census.mjs --propose "<what you intend to build>"'); process.exit(2); }
  const verdict = censusVerdict(proposal, loadOwners());
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.verdict === 'CLEAR_TO_BUILD' ? 0 : 1);
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(String(e)); process.exit(2); });
}
