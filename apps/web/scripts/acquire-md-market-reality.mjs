#!/usr/bin/env node
// MD MARKET REALITY ACQUISITION — the Maryland acquisition lane.
// Canonical carrier of Maryland's execution version tuple (the provenance
// court reads adapterVersion / authorityPolicyVersion / freshnessPolicyVersion
// from THIS file at the pinned commit). Same laws as the VA lane: operator
// opt-in, clean HEAD, read-only, receipt-only, zero truth mutations.

import { execFileSync } from 'node:child_process';

import { MD_CLAIMS_SCHEMA_VERSION, MD_ENTITY_NORMALIZATION_VERSION, formMdMarketClaims } from '../src/lib/markets/md/md-claims.mjs';
import { MARKET_CLAIM_COURT_VERSION } from '../src/lib/reality/market-claim-court.mjs';
import {
  MD_MCA_LIVE_CONTRACT,
  assertMdMcaLiveAcquisitionAuthority,
  captureMdMcaReality,
} from '../src/lib/reality/live-md-mca-adapter.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main() {
  const tenant = option('--tenant');
  const asOf = option('--as-of');
  if (!tenant) throw new Error('CANA_REALITY_TENANT_REQUIRED');
  if (!asOf) throw new Error('CANA_REALITY_EXPLICIT_AS_OF_REQUIRED');
  assertMdMcaLiveAcquisitionAuthority({ env: process.env });
  if (git('status', '--porcelain')) throw new Error('CANA_LIVE_REALITY_CLEAN_HEAD_REQUIRED');
  const versions = {
    repositoryCommitSha: git('rev-parse', 'HEAD'),
    repositoryTreeSha: git('rev-parse', 'HEAD^{tree}'),
    adapterVersion: 'md-mca-live-v1',
    parserVersion: MD_MCA_LIVE_CONTRACT.schemaVersion,
    compilerVersion: MD_CLAIMS_SCHEMA_VERSION,
    entityResolverVersion: MD_ENTITY_NORMALIZATION_VERSION,
    authorityPolicyVersion: 'md-mca-authority-v1',
    freshnessPolicyVersion: 'md-mca-freshness-v1',
    verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
  };
  const receipt = await captureMdMcaReality({
    fetchImpl: (url, init) => fetch(url, init),
    env: process.env,
  });
  const claims = formMdMarketClaims({
    statements: receipt.records,
    sourceId: receipt.source_id,
    observedAt: receipt.fetched_at,
  });
  return Object.freeze({
    schema_version: 'cana-md-live-reality-acquisition-receipt/v1',
    tenant,
    as_of: asOf,
    versions,
    acquisition: {
      source_id: receipt.source_id,
      source_key: receipt.source_key,
      source_url: receipt.source_url,
      request_digest: receipt.request_digest,
      adapter_contract_digest: receipt.adapter_contract_digest,
      content_sha256: receipt.content_sha256,
      content_stability: receipt.content_stability,
      payload_bytes: receipt.payload_bytes,
      wire_bytes: receipt.wire_bytes,
      record_count: receipt.record_count,
      fetched_at: receipt.fetched_at,
    },
    formed_claims: claims.length,
    verification: 'UNKNOWN',
    decision_eligible: false,
    truth_mutations: 0,
    production_mutations: 0,
    next_step: 'DURABLE_STORE_PERSISTENCE_AND_VERIFICATION_COURT',
  });
}

main()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    const candidateCode = String(error?.code ?? error?.message ?? '');
    console.error(JSON.stringify({
      schema_version: 'cana-md-live-reality-acquisition-receipt/v1',
      state: 'REFUSED',
      error_code: /^CANA_[A-Z0-9_]+$/.test(candidateCode)
        ? candidateCode
        : 'CANA_LIVE_MD_MCA_UNEXPECTED_FAILURE',
      external_effects: 0,
      production_mutations: 0,
    }));
    process.exitCode = 1;
  });
