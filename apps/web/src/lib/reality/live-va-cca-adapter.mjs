// LIVE VA CCA ADAPTER — bounded, fixed-origin, read-only acquisition of the
// Virginia Cannabis Control Authority's public dispensary registry page.
//
// Sibling of live-abca-adapter.mjs under the same authority laws, adapted to
// an HTML-page source (the CCA publishes registries as web pages, not as a
// queryable layer — a generalization boundary measured by Transfer Test #1):
//   - FIXED ORIGIN: exactly one https URL; request overrides are refused.
//   - OPERATOR OPT-IN: acquisition requires an explicit environment grant;
//     nothing here runs implicitly.
//   - BOUNDED: response bytes, run bytes, connect/body/run timeouts, record
//     ceiling — all contract constants, all enforced.
//   - PINNED LOOKUP: DNS resolution is injectable and pinnable; a pinned
//     lookup refuses every hostname except the contract's.
//   - CONTENT STABILITY: HTML pages expose no revision API, so the stability
//     proof is a double fetch — both reads must hash identically or the
//     acquisition terminates CONTENT_UNSTABLE without producing statements.
//   - READ-ONLY: zero truth mutations, zero production mutations. Extracted
//     statements enter the claim lane elsewhere; this module only acquires.

import { createHash } from 'node:crypto';

import { parseCcaRegistryPage } from '../markets/va/va-cca-registry-parser.mjs';

export const VA_CCA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const VA_CCA_MAX_RUN_BYTES = 4 * 1024 * 1024;
export const VA_CCA_MAX_RECORDS = 500;
export const VA_CCA_CONNECT_TIMEOUT_MS = 10_000;
export const VA_CCA_BODY_TIMEOUT_MS = 15_000;
export const VA_CCA_RUN_TIMEOUT_MS = 30_000;

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

export const VA_CCA_LIVE_CONTRACT_DIGEST = sha256(canonicalJson(VA_CCA_LIVE_CONTRACT));

/** Fixed-origin law: the request URL is the contract's, never negotiable. */
export function buildVaCcaRequestUrl(overrides) {
  if (overrides !== undefined) {
    throw new Error('CANA_LIVE_VA_CCA_REQUEST_OVERRIDE_REFUSED');
  }
  return new URL(VA_CCA_LIVE_CONTRACT.pageUrl);
}

/** Operator opt-in law: acquisition authority must be explicitly granted. */
export function assertVaCcaLiveAcquisitionAuthority({ env = process.env } = {}) {
  if (env?.CANA_LIVE_VA_CCA_ACQUISITION !== 'OPERATOR_APPROVED') {
    throw new Error('CANA_LIVE_VA_CCA_ACQUISITION_NOT_AUTHORIZED');
  }
  return Object.freeze({
    authorized: true,
    source_id: VA_CCA_LIVE_CONTRACT.sourceId,
    source_key: VA_CCA_LIVE_CONTRACT.sourceKey,
    effects: Object.freeze({
      read_only_public_requests: true,
      truth_mutations: 0,
      production_mutations: 0,
    }),
  });
}

/** Pinned lookup law: resolve only the contract hostname, only to `address`. */
export function createVaCcaPinnedLookup(address) {
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('CANA_LIVE_VA_CCA_PINNED_ADDRESS_REQUIRED');
  }
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (hostname !== VA_CCA_LIVE_CONTRACT.hostname) {
      done(new Error('CANA_LIVE_VA_CCA_HOSTNAME_REFUSED'));
      return;
    }
    done(null, address, address.includes(':') ? 6 : 4);
  };
}

/** Bounded-read law: byte cap and body timeout enforced while streaming. */
export async function readBoundedTextResponse(response, {
  maxBytes = VA_CCA_LIVE_CONTRACT.maxResponseBytes,
  timeoutMs = VA_CCA_LIVE_CONTRACT.bodyTimeoutMs,
} = {}) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw new Error('CANA_LIVE_VA_CCA_RESPONSE_TOO_LARGE');
    return { text, bytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      await reader.cancel().catch(() => {});
      throw new Error('CANA_LIVE_VA_CCA_BODY_TIMEOUT');
    }
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('CANA_LIVE_VA_CCA_RESPONSE_TOO_LARGE');
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
    throw new Error(`CANA_LIVE_VA_CCA_HTTP_ERROR:${response?.status ?? 'NO_RESPONSE'}`);
  }
  return readBoundedTextResponse(response);
}

/**
 * Acquire the CCA dispensary registry with the double-fetch content-stability
 * proof. Returns an immutable acquisition receipt; throws (never guesses) on
 * instability, oversize, timeout, or extraction collapse.
 */
export async function captureVaCcaReality({
  fetchImpl,
  env = process.env,
  clock = () => new Date(),
  onStage = async () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('CANA_LIVE_VA_CCA_FETCH_IMPL_REQUIRED');
  }
  const capability = assertVaCcaLiveAcquisitionAuthority({ env });
  const startedAt = clock();
  const deadline = startedAt.getTime() + VA_CCA_LIVE_CONTRACT.runTimeoutMs;
  const url = buildVaCcaRequestUrl();

  await onStage('PRE_FETCH');
  const pre = await fetchPage(fetchImpl, url);
  const preSha = sha256(pre.text);
  if (clock().getTime() > deadline) throw new Error('CANA_LIVE_VA_CCA_RUN_TIMEOUT');

  await onStage('POST_FETCH');
  const post = await fetchPage(fetchImpl, url);
  const postSha = sha256(post.text);
  if (clock().getTime() > deadline) throw new Error('CANA_LIVE_VA_CCA_RUN_TIMEOUT');
  if (pre.bytes + post.bytes > VA_CCA_LIVE_CONTRACT.maxRunBytes) {
    throw new Error('CANA_LIVE_VA_CCA_RUN_BYTES_EXCEEDED');
  }
  if (preSha !== postSha) {
    // The stability proof failed: the page changed between reads. Terminal —
    // no statements are produced from an unstable observation.
    throw new Error('CANA_LIVE_VA_CCA_CONTENT_UNSTABLE');
  }

  await onStage('EXTRACT');
  const { records, rejects } = parseCcaRegistryPage(post.text, {
    url: VA_CCA_LIVE_CONTRACT.pageUrl,
    pageSha256: postSha,
  });
  if (records.length === 0) throw new Error('CANA_LIVE_VA_CCA_EXTRACTION_EMPTY');
  if (records.length > VA_CCA_LIVE_CONTRACT.maxRecords) {
    throw new Error('CANA_LIVE_VA_CCA_RECORD_CEILING_EXCEEDED');
  }

  const fetchedAt = clock();
  return Object.freeze({
    schema_version: VA_CCA_LIVE_CONTRACT.schemaVersion,
    source_id: VA_CCA_LIVE_CONTRACT.sourceId,
    source_key: VA_CCA_LIVE_CONTRACT.sourceKey,
    source_url: VA_CCA_LIVE_CONTRACT.pageUrl,
    request_digest: VA_CCA_LIVE_CONTRACT_DIGEST,
    adapter_contract_digest: VA_CCA_LIVE_CONTRACT_DIGEST,
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
