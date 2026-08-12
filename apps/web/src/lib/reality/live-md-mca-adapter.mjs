// LIVE MD MCA ADAPTER — Maryland's bounded HTML acquisition lane, expressed
// as a contract over the shared bounded-html-acquisition core (extracted at
// fork ×2). This file owns only Maryland's identity; all acquisition laws
// live in the core.
//
// NOTE: the execution-provenance court reads this file's schemaVersion
// literal at the pinned commit — the contract stays defined here.

import { parseMcaRegistryPage } from '../markets/md/md-mca-registry-parser.mjs';
import { createBoundedHtmlAcquisition } from './bounded-html-acquisition.mjs';

export const MD_MCA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MD_MCA_MAX_RUN_BYTES = 4 * 1024 * 1024;
export const MD_MCA_MAX_RECORDS = 500;
export const MD_MCA_CONNECT_TIMEOUT_MS = 10_000;
export const MD_MCA_BODY_TIMEOUT_MS = 15_000;
export const MD_MCA_RUN_TIMEOUT_MS = 30_000;

export const MD_MCA_LIVE_CONTRACT = Object.freeze({
  schemaVersion: 'cana-md-mca-registry-snapshot-v1',
  sourceId: 'md-mca-dispensaries',
  sourceKey: 'mca-maryland:pages:dispensaries',
  protocol: 'https:',
  hostname: 'cannabis.maryland.gov',
  port: 443,
  pageUrl: 'https://cannabis.maryland.gov/Pages/Dispensaries.aspx',
  contentType: 'text/html',
  maxResponseBytes: MD_MCA_MAX_RESPONSE_BYTES,
  maxRunBytes: MD_MCA_MAX_RUN_BYTES,
  maxRecords: MD_MCA_MAX_RECORDS,
  connectTimeoutMs: MD_MCA_CONNECT_TIMEOUT_MS,
  bodyTimeoutMs: MD_MCA_BODY_TIMEOUT_MS,
  runTimeoutMs: MD_MCA_RUN_TIMEOUT_MS,
});

const lane = createBoundedHtmlAcquisition({
  contract: MD_MCA_LIVE_CONTRACT,
  extract: parseMcaRegistryPage,
  errorPrefix: 'CANA_LIVE_MD_MCA',
  envGrantKey: 'CANA_LIVE_MD_MCA_ACQUISITION',
});

export const MD_MCA_LIVE_CONTRACT_DIGEST = lane.contractDigest;
export const buildMdMcaRequestUrl = lane.buildRequestUrl;
export const assertMdMcaLiveAcquisitionAuthority = lane.assertAcquisitionAuthority;
export const createMdMcaPinnedLookup = lane.createPinnedLookup;
export const readBoundedTextResponse = lane.readBoundedTextResponse;
export const captureMdMcaReality = lane.capture;
