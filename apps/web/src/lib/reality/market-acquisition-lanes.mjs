// MARKET ACQUISITION LANES — one durable reality store, three market lanes.
//
// The Prisma persistence layer was inspected (not assumed) and found already
// market-neutral: every model keys by sourceKey+tenant with content-hash
// unique constraints (idempotent reuse). What was NOT neutral was the
// orchestrator's hardcoded ABCA contract/capture/authority — this registry
// closes that gap. Each lane binds:
//   marketId · sourceKey · contractDigest · predicateScope
//   assertAuthority (operator opt-in law)
//   capture (persistence-shaped: manifest, raw snapshot bytes, revisions)
//
// LAWS:
//   - HTML sources have NO revision identifiers: pre/post_revision stay null
//     (UNKNOWN). A content hash is NEVER promoted into a fake revision.
//   - The raw artifact (full page text) is bound into snapshot bytes — the
//     rawArtifactReference law.
//   - ACQUISITION ≠ VERIFICATION: lanes acquire; only the court promotes.

import {
  ABCA_LIVE_CONTRACT,
  ABCA_LIVE_CONTRACT_DIGEST,
  assertLiveAcquisitionAuthority,
  captureAbcaReality,
} from './live-abca-adapter.mjs';
import {
  VA_CCA_LIVE_CONTRACT,
  VA_CCA_LIVE_CONTRACT_DIGEST,
  assertVaCcaLiveAcquisitionAuthority,
  captureVaCcaReality,
} from './live-va-cca-adapter.mjs';
import {
  MD_MCA_LIVE_CONTRACT,
  MD_MCA_LIVE_CONTRACT_DIGEST,
  assertMdMcaLiveAcquisitionAuthority,
  captureMdMcaReality,
} from './live-md-mca-adapter.mjs';
import { canonicalJson } from './bounded-html-acquisition.mjs';

function htmlLane({ marketId, contract, digest, capture, assertAuthority, predicateScope }) {
  return Object.freeze({
    marketId,
    sourceKey: contract.sourceKey,
    contractDigest: digest,
    predicateScope,
    assertAuthority,
    async capture({ fetchImpl, clock = () => new Date(), onStage = async () => {}, env = process.env } = {}) {
      const receipt = await capture({ fetchImpl, env, clock });
      const manifest = Object.freeze({
        schema_version: receipt.schema_version,
        query: contract.pageUrl,
      });
      // Mandatory state-machine transitions with exact-ISO times.
      await onStage('CAPTURED', {
        fetched_at: receipt.fetched_at,
        content_sha256: receipt.content_sha256,
        payload_bytes: receipt.wire_bytes,
      });
      await onStage('POSTFLIGHT_VALIDATED', {
        fetched_at: receipt.fetched_at,
        record_count: receipt.record_count,
      });
      return Object.freeze({
        ...receipt,
        manifest,
        manifest_bytes: Buffer.from(canonicalJson(manifest), 'utf8'),
        snapshot_bytes: Buffer.from(receipt.payload_text, 'utf8'),
        source_modified_at: null,
        pre_revision: null,
        post_revision: null,
        pre_count: receipt.record_count,
        post_count: receipt.record_count,
        response: Object.freeze({
          http_status: 200,
          content_type: contract.contentType,
          etag: null,
          last_modified: null,
        }),
        capability: Object.freeze({
          ...receipt.capability,
          limits: Object.freeze({
            max_response_bytes: contract.maxResponseBytes,
            max_run_bytes: contract.maxRunBytes,
            max_records: contract.maxRecords,
          }),
          schema_digest: digest,
        }),
      });
    },
  });
}

export const DC_ABCA_LANE = Object.freeze({
  marketId: 'US-DC',
  sourceKey: ABCA_LIVE_CONTRACT.sourceKey,
  contractDigest: ABCA_LIVE_CONTRACT_DIGEST,
  predicateScope: 'licensed_retailer_identity,status,address,coordinates',
  assertAuthority: assertLiveAcquisitionAuthority,
  capture: captureAbcaReality,
});

export const VA_CCA_LANE = htmlLane({
  marketId: 'US-VA',
  contract: VA_CCA_LIVE_CONTRACT,
  digest: VA_CCA_LIVE_CONTRACT_DIGEST,
  capture: captureVaCcaReality,
  assertAuthority: assertVaCcaLiveAcquisitionAuthority,
  predicateScope: 'licensed_dispensary_identity,address,contact',
});

export const MD_MCA_LANE = htmlLane({
  marketId: 'US-MD',
  contract: MD_MCA_LIVE_CONTRACT,
  digest: MD_MCA_LIVE_CONTRACT_DIGEST,
  capture: captureMdMcaReality,
  assertAuthority: assertMdMcaLiveAcquisitionAuthority,
  predicateScope: 'licensed_dispensary_identity,address,contact',
});

export const MARKET_ACQUISITION_LANES = Object.freeze([DC_ABCA_LANE, VA_CCA_LANE, MD_MCA_LANE]);

/** Admitted lane lookup: unregistered source keys resolve to null = refusal. */
export function acquisitionLaneForSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string' || sourceKey.length === 0) return null;
  return MARKET_ACQUISITION_LANES.find((lane) => lane.sourceKey === sourceKey) ?? null;
}
