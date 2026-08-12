// LIVE MD MCA ADAPTER — bounded, fixed-origin, read-only acquisition of the
// Maryland Cannabis Administration's public dispensary registry page.
//
// Third instance of the bounded-acquisition law set (DC ArcGIS, VA HTML,
// MD HTML) and the SECOND HTML fork — transfer telemetry records this as the
// evidence threshold for extracting a shared bounded-HTML acquisition core
// in a future courted lane. Laws identical to live-va-cca-adapter.mjs:
// fixed origin, operator opt-in, pinned lookup, byte/time bounds,
// double-fetch content-stability proof, read-only.

import { createHash } from 'node:crypto';

import { parseMcaRegistryPage } from '../markets/md/md-mca-registry-parser.mjs';

export const MD_MCA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MD_MCA_MAX_RUN_BYTES = 4 * 1024 * 1024;
export const MD_MCA_MAX_RECORDS = 500;
export const MD_MCA_CONNECT_TIMEOUT_MS = 10_000;
export const MD_MCA_BODY_TIMEOUT_MS = 15_000;
export const MD_MCA_RUN_TIMEOUT_MS = 30_000;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

export const MD_MCA_LIVE_CONTRACT_DIGEST = sha256(canonicalJson(MD_MCA_LIVE_CONTRACT));

export function buildMdMcaRequestUrl(overrides) {
  if (overrides !== undefined) {
    throw new Error('CANA_LIVE_MD_MCA_REQUEST_OVERRIDE_REFUSED');
  }
  return new URL(MD_MCA_LIVE_CONTRACT.pageUrl);
}

export function assertMdMcaLiveAcquisitionAuthority({ env = process.env } = {}) {
  if (env?.CANA_LIVE_MD_MCA_ACQUISITION !== 'OPERATOR_APPROVED') {
    throw new Error('CANA_LIVE_MD_MCA_ACQUISITION_NOT_AUTHORIZED');
  }
  return Object.freeze({
    authorized: true,
    source_id: MD_MCA_LIVE_CONTRACT.sourceId,
    source_key: MD_MCA_LIVE_CONTRACT.sourceKey,
    effects: Object.freeze({
      read_only_public_requests: true,
      truth_mutations: 0,
      production_mutations: 0,
    }),
  });
}

export function createMdMcaPinnedLookup(address) {
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('CANA_LIVE_MD_MCA_PINNED_ADDRESS_REQUIRED');
  }
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (hostname !== MD_MCA_LIVE_CONTRACT.hostname) {
      done(new Error('CANA_LIVE_MD_MCA_HOSTNAME_REFUSED'));
      return;
    }
    done(null, address, address.includes(':') ? 6 : 4);
  };
}

export async function readBoundedTextResponse(response, {
  maxBytes = MD_MCA_LIVE_CONTRACT.maxResponseBytes,
  timeoutMs = MD_MCA_LIVE_CONTRACT.bodyTimeoutMs,
} = {}) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw new Error('CANA_LIVE_MD_MCA_RESPONSE_TOO_LARGE');
    return { text, bytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      await reader.cancel().catch(() => {});
      throw new Error('CANA_LIVE_MD_MCA_BODY_TIMEOUT');
    }
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('CANA_LIVE_MD_MCA_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

async function fetchPage(fetchImpl, url) {
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'text/html' },
  });
  if (!response || response.status !== 200) {
    throw new Error(`CANA_LIVE_MD_MCA_HTTP_ERROR:${response?.status ?? 'NO_RESPONSE'}`);
  }
  return readBoundedTextResponse(response);
}

export async function captureMdMcaReality({
  fetchImpl,
  env = process.env,
  clock = () => new Date(),
  onStage = async () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('CANA_LIVE_MD_MCA_FETCH_IMPL_REQUIRED');
  }
  const capability = assertMdMcaLiveAcquisitionAuthority({ env });
  const startedAt = clock();
  const deadline = startedAt.getTime() + MD_MCA_LIVE_CONTRACT.runTimeoutMs;
  const url = buildMdMcaRequestUrl();

  await onStage('PRE_FETCH');
  const pre = await fetchPage(fetchImpl, url);
  const preSha = sha256(pre.text);
  if (clock().getTime() > deadline) throw new Error('CANA_LIVE_MD_MCA_RUN_TIMEOUT');

  await onStage('POST_FETCH');
  const post = await fetchPage(fetchImpl, url);
  const postSha = sha256(post.text);
  if (clock().getTime() > deadline) throw new Error('CANA_LIVE_MD_MCA_RUN_TIMEOUT');
  if (pre.bytes + post.bytes > MD_MCA_LIVE_CONTRACT.maxRunBytes) {
    throw new Error('CANA_LIVE_MD_MCA_RUN_BYTES_EXCEEDED');
  }
  if (preSha !== postSha) {
    throw new Error('CANA_LIVE_MD_MCA_CONTENT_UNSTABLE');
  }

  await onStage('EXTRACT');
  const { records, rejects } = parseMcaRegistryPage(post.text, {
    url: MD_MCA_LIVE_CONTRACT.pageUrl,
    pageSha256: postSha,
  });
  if (records.length === 0) throw new Error('CANA_LIVE_MD_MCA_EXTRACTION_EMPTY');
  if (records.length > MD_MCA_LIVE_CONTRACT.maxRecords) {
    throw new Error('CANA_LIVE_MD_MCA_RECORD_CEILING_EXCEEDED');
  }

  const fetchedAt = clock();
  return Object.freeze({
    schema_version: MD_MCA_LIVE_CONTRACT.schemaVersion,
    source_id: MD_MCA_LIVE_CONTRACT.sourceId,
    source_key: MD_MCA_LIVE_CONTRACT.sourceKey,
    source_url: MD_MCA_LIVE_CONTRACT.pageUrl,
    request_digest: MD_MCA_LIVE_CONTRACT_DIGEST,
    adapter_contract_digest: MD_MCA_LIVE_CONTRACT_DIGEST,
    content_sha256: postSha,
    pre_content_sha256: preSha,
    post_content_sha256: postSha,
    content_stability: 'CONTENT_STABLE',
    payload_bytes: post.bytes,
    wire_bytes: pre.bytes + post.bytes,
    record_count: records.length,
    records,
    rejects,
    fetched_at: fetchedAt.toISOString(),
    started_at: startedAt.toISOString(),
    capability,
  });
}
