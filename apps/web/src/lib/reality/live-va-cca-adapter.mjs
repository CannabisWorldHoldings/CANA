// LIVE VA CCA ADAPTER — Virginia's bounded HTML acquisition lane, expressed
// as a contract over the shared bounded-html-acquisition core (extracted at
// fork ×2; see docs/markets/MARKET_CORE_GENERALIZATION.md). All laws —
// fixed origin, operator opt-in, pinned lookup, byte/time bounds,
// double-fetch content stability, read-only — live in the core; this file
// owns only Virginia's identity.
//
// NOTE: the execution-provenance court reads this file's schemaVersion
// literal at the pinned commit — the contract stays defined here.

import { parseCcaRegistryPage } from '../markets/va/va-cca-registry-parser.mjs';
import { createBoundedHtmlAcquisition } from './bounded-html-acquisition.mjs';

export const VA_CCA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const VA_CCA_MAX_RUN_BYTES = 4 * 1024 * 1024;
export const VA_CCA_MAX_RECORDS = 500;
export const VA_CCA_CONNECT_TIMEOUT_MS = 10_000;
export const VA_CCA_BODY_TIMEOUT_MS = 15_000;
export const VA_CCA_RUN_TIMEOUT_MS = 30_000;

export const VA_CCA_LIVE_CONTRACT = Object.freeze({
  schemaVersion: 'cana-va-cca-registry-snapshot-v1',
  sourceId: 'va-cca-dispensaries',
  sourceKey: 'cca-virginia:medicalcannabis:dispensaries',
  protocol: 'https:',
  hostname: 'www.cca.virginia.gov',
  port: 443,
  pageUrl: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries',
  contentType: 'text/html',
  maxResponseBytes: VA_CCA_MAX_RESPONSE_BYTES,
  maxRunBytes: VA_CCA_MAX_RUN_BYTES,
  maxRecords: VA_CCA_MAX_RECORDS,
  connectTimeoutMs: VA_CCA_CONNECT_TIMEOUT_MS,
  bodyTimeoutMs: VA_CCA_BODY_TIMEOUT_MS,
  runTimeoutMs: VA_CCA_RUN_TIMEOUT_MS,
});

const lane = createBoundedHtmlAcquisition({
  contract: VA_CCA_LIVE_CONTRACT,
  extract: parseCcaRegistryPage,
  errorPrefix: 'CANA_LIVE_VA_CCA',
  envGrantKey: 'CANA_LIVE_VA_CCA_ACQUISITION',
});

export const VA_CCA_LIVE_CONTRACT_DIGEST = lane.contractDigest;
export const buildVaCcaRequestUrl = lane.buildRequestUrl;
export const assertVaCcaLiveAcquisitionAuthority = lane.assertAcquisitionAuthority;
export const createVaCcaPinnedLookup = lane.createPinnedLookup;
export const readBoundedTextResponse = lane.readBoundedTextResponse;
export const captureVaCcaReality = lane.capture;
