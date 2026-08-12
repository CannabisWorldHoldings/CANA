#!/usr/bin/env node
// VA MARKET REALITY ACQUISITION — the Virginia acquisition lane.
//
// This script is the canonical carrier of Virginia's execution version tuple
// (adjudicateExecutionProvenance reads adapterVersion / authorityPolicyVersion /
// freshnessPolicyVersion from THIS file at the pinned commit). It performs a
// bounded, operator-opted, read-only acquisition of the CCA dispensary
// registry and emits an immutable evidence receipt.
//
// LAWS:
//   - OPERATOR-RUN ONLY: requires CANA_LIVE_VA_CCA_ACQUISITION=OPERATOR_APPROVED
//     (refused otherwise) and a clean git HEAD.
//   - Zero truth mutations, zero production mutations: this lane emits an
//     acquisition receipt; verification/promotion happens exclusively in the
//     market-claim court against durable stores.
//   - Version tuple is explicit and provenance-bound to HEAD.

import { execFileSync } from 'node:child_process';

import { VA_CLAIMS_SCHEMA_VERSION, VA_ENTITY_NORMALIZATION_VERSION, formVaMarketClaims } from '../src/lib/markets/va/va-claims.mjs';
import { MARKET_CLAIM_COURT_VERSION } from '../src/lib/reality/market-claim-court.mjs';
import {
  VA_CCA_LIVE_CONTRACT,
  assertVaCcaLiveAcquisitionAuthority,
  captureVaCcaReality,
} from '../src/lib/reality/live-va-cca-adapter.mjs';

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
  assertVaCcaLiveAcquisitionAuthority({ env: process.env });
  if (git('status', '--porcelain')) throw new Error('CANA_LIVE_REALITY_CLEAN_HEAD_REQUIRED');
  const versions = {
    repositoryCommitSha: git('rev-parse', 'HEAD'),
    repositoryTreeSha: git('rev-parse', 'HEAD^{tree}'),
    adapterVersion: 'va-cca-live-v1',
    parserVersion: VA_CCA_LIVE_CONTRACT.schemaVersion,
    compilerVersion: VA_CLAIMS_SCHEMA_VERSION,
    entityResolverVersion: VA_ENTITY_NORMALIZATION_VERSION,
    authorityPolicyVersion: 'va-cca-authority-v1',
    freshnessPolicyVersion: 'va-cca-freshness-v1',
    verificationCourtVersion: MARKET_CLAIM_COURT_VERSION,
  };
  const receipt = await captureVaCcaReality({
    fetchImpl: (url, init) => fetch(url, init),
    env: process.env,
  });
  const claims = formVaMarketClaims({
    statements: receipt.records,
    sourceId: receipt.source_id,
    observedAt: receipt.fetched_at,
  });
  return Object.freeze({
    schema_version: 'cana-va-live-reality-acquisition-receipt/v1',
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
      schema_version: 'cana-va-live-reality-acquisition-receipt/v1',
      state: 'REFUSED',
      error_code: /^CANA_[A-Z0-9_]+$/.test(candidateCode)
        ? candidateCode
        : 'CANA_LIVE_VA_CCA_UNEXPECTED_FAILURE',
      external_effects: 0,
      production_mutations: 0,
    }));
    process.exitCode = 1;
  });
