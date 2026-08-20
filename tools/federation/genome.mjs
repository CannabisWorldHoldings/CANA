#!/usr/bin/env node
/**
 * CANA FEDERATION — GATE A: CAPABILITY GENOME (executable schemas)
 *
 * CapabilityGene / GeneComplex / DonorGenome / DonorPreservationContract as
 * fail-closed validating constructors in the house style of
 * skills-src/cana-signal-to-fix.mjs: invalid objects are returned marked
 * invalid with reasons — never silently accepted, never thrown away.
 *
 * Truth-state vocabulary maps onto the repo's canonical labels; no duplicate
 * vocabulary is invented (§70 of the federation directive).
 */
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => Array.isArray(v) && v.length > 0;
const joinParts = (...parts) => parts.map((p) => { const t = String(p ?? ''); return `${t.length}:${t}`; }).join('|');

/** Canonical proof states (repo vocabulary; see AGENTS.md + court reports). */
export const PROOF_STATES = [
  'VERIFIED_IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'PLANNED',
  'RESEARCH_ONLY', 'BLOCKED', 'FALSIFIED', 'UNKNOWN', 'NOT_ESTABLISHED',
];

/** Evidence grades for donor reconstruction (§15). */
export const EVIDENCE_GRADES = [
  'DIRECT_OBSERVATION', 'SOURCE_VERIFIED', 'CORROBORATED', 'SUPPORTED_INFERENCE',
  'ARCHITECTURAL_HYPOTHESIS', 'RECONSTRUCTED_MECHANISM', 'DONOR_CLAIM',
  'EXPERIMENTALLY_SUPPORTED', 'FALSIFIED', 'UNKNOWN', 'NOT_ESTABLISHED',
];

/** A single causal capability mechanism extracted from a donor. */
export function makeCapabilityGene(g) {
  const errors = [];
  if (!text(g?.mechanism)) errors.push('mechanism required — a gene names a causal mechanism, not a feature');
  if (!text(g?.fundamentalJob)) errors.push('fundamentalJob required');
  if (!text(g?.capabilityContribution)) errors.push('capabilityContribution required');
  if (!list(g?.evidence)) errors.push('evidence[] required — a gene without evidence is a slogan');
  for (const e of g?.evidence ?? []) {
    if (!text(e?.ref)) errors.push('every evidence item needs a retrievable ref');
    if (!EVIDENCE_GRADES.includes(e?.grade)) errors.push(`evidence grade must be one of the canonical grades (got ${e?.grade})`);
  }
  if (!PROOF_STATES.includes(g?.currentState)) errors.push(`currentState must be a canonical proof state (got ${g?.currentState})`);
  if (g?.currentState === 'VERIFIED_IMPLEMENTED'
      && !(g?.evidence ?? []).some((e) => ['DIRECT_OBSERVATION', 'SOURCE_VERIFIED', 'EXPERIMENTALLY_SUPPORTED'].includes(e?.grade))) {
    errors.push('VERIFIED_IMPLEMENTED requires at least one DIRECT_OBSERVATION / SOURCE_VERIFIED / EXPERIMENTALLY_SUPPORTED evidence item');
  }
  if (!Array.isArray(g?.failureModes)) errors.push('failureModes[] required (may be empty only if explicitly asserted)');
  const gene = {
    gene_id: 'gene_' + sha(joinParts(g?.mechanism, g?.fundamentalJob)).slice(0, 16),
    mechanism: g?.mechanism ?? null,
    fundamental_job: g?.fundamentalJob ?? null,
    capability_contribution: g?.capabilityContribution ?? null,
    inputs: g?.inputs ?? [],
    outputs: g?.outputs ?? [],
    dependencies: g?.dependencies ?? [],
    co_dependent_genes: g?.coDependentGenes ?? [],
    substitutes: g?.substitutes ?? [],
    failure_modes: g?.failureModes ?? [],
    authority_implications: g?.authorityImplications ?? 'NONE_DECLARED',
    evidence: g?.evidence ?? [],
    source_lineage: g?.sourceLineage ?? null,
    ablation_status: g?.ablationStatus ?? 'NOT_ABLATED',
    transfer_conditions: g?.transferConditions ?? [],
    current_state: g?.currentState ?? 'UNKNOWN',
    valid: errors.length === 0,
    errors,
  };
  return gene;
}

/** Genes whose effects are causally entangled must transfer together (§16). */
export function makeGeneComplex({ genes, entanglement }) {
  const errors = [];
  if (!Array.isArray(genes) || genes.length < 2) errors.push('a complex needs >=2 genes');
  if ((genes ?? []).some((g) => !g?.valid)) errors.push('a complex may only bind VALID genes');
  if (!text(entanglement)) errors.push('entanglement required — state WHY these genes cannot transfer separately');
  return {
    complex_id: 'cplx_' + sha(joinParts(...(genes ?? []).map((g) => g?.gene_id))).slice(0, 16),
    gene_ids: (genes ?? []).map((g) => g?.gene_id ?? null),
    entanglement: entanglement ?? null,
    valid: errors.length === 0,
    errors,
  };
}

/** What must NOT be lost when assimilating from a donor. */
export function makeDonorPreservationContract({ donorId, mustPreserve }) {
  const errors = [];
  if (!text(donorId)) errors.push('donorId required');
  if (!list(mustPreserve)) errors.push('mustPreserve[] required — an empty preservation contract is not a contract');
  for (const m of mustPreserve ?? []) {
    if (!text(m?.property)) errors.push('each preserved item needs a property');
    if (!text(m?.checkedBy)) errors.push(`preserved property "${m?.property}" needs a checkedBy (test/court/receipt) — unverifiable preservation is a wish`);
  }
  return {
    contract_id: 'dpc_' + sha(joinParts(donorId, ...(mustPreserve ?? []).map((m) => m?.property))).slice(0, 16),
    donor_id: donorId ?? null,
    must_preserve: mustPreserve ?? [],
    valid: errors.length === 0,
    errors,
  };
}

/** Typed reconstruction of a donor system (§15). Never asserts private internals as fact. */
export function makeDonorGenome(d) {
  const errors = [];
  if (!text(d?.donorId)) errors.push('donorId required');
  if (!text(d?.fundamentalJob)) errors.push('fundamentalJob required');
  if (!list(d?.genes)) errors.push('genes[] required');
  if ((d?.genes ?? []).some((g) => !g?.valid)) errors.push('all genes must be valid');
  if (!Array.isArray(d?.unknowns)) errors.push('unknowns[] required — UNKNOWN is an asset; a genome with no declared unknowns is suspect');
  if (!text(d?.sourceProvenance)) errors.push('sourceProvenance required');
  return {
    genome_id: 'dg_' + sha(joinParts(d?.donorId, d?.donorVersion)).slice(0, 16),
    donor_id: d?.donorId ?? null,
    donor_version: d?.donorVersion ?? 'UNKNOWN',
    fundamental_job: d?.fundamentalJob ?? null,
    genes: d?.genes ?? [],
    gene_complexes: d?.geneComplexes ?? [],
    unknowns: d?.unknowns ?? [],
    contradictions: d?.contradictions ?? [],
    governing_bottleneck: d?.governingBottleneck ?? 'NOT_ESTABLISHED',
    preservation_contract: d?.preservationContract ?? null,
    source_provenance: d?.sourceProvenance ?? null,
    valid: errors.length === 0,
    errors,
  };
}
