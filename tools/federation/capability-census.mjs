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

/**
 * A proposal collides with an owner when it matches >=2 of the owner's job
 * terms (single-term matches are too noisy; zero-term matches are clear).
 */
export function censusVerdict(proposal, owners, { repoRoot = path.resolve(HERE, '..', '..') } = {}) {
  const words = new Set(norm(proposal));
  const collisions = [];
  for (const o of owners) {
    const hits = o.job_terms.filter((t) => norm(t).every((w) => words.has(w)));
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
