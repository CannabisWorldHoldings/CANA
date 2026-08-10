import { createHash } from 'node:crypto';
import { lookup as defaultLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

import {
  ABCA_FIELDS,
  ABCA_LAYER_URL,
  ABCA_QUERY_URL,
  ABCA_SOURCE_ID,
  buildSnapshotArtifacts,
  validateOfficialSourceSnapshotBytes,
} from './official-source-snapshot.mjs';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_RUN_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDS = 500;
export const CONNECT_TIMEOUT_MS = 10_000;
export const BODY_TIMEOUT_MS = 15_000;
export const RUN_TIMEOUT_MS = 30_000;

const CI_MARKERS = Object.freeze(['CI', 'GITHUB_ACTIONS', 'CANA_VERIFY_PROFILE']);
const PROXY_MARKERS = Object.freeze(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']);
const JSON_CONTENT_TYPES = Object.freeze(['application/json', 'application/geo+json', 'text/plain']);

export const ABCA_LIVE_CONTRACT = Object.freeze({
  schemaVersion: 'cana-live-abca-source-contract/v1',
  sourceId: ABCA_SOURCE_ID,
  sourceKey: 'dcgis_abca_retailers_layer_31',
  protocol: 'https:',
  hostname: 'maps2.dcgis.dc.gov',
  port: '',
  layerId: 31,
  layerUrl: ABCA_LAYER_URL,
  queryUrl: ABCA_QUERY_URL,
  fields: ABCA_FIELDS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxRunBytes: MAX_RUN_BYTES,
  maxRecords: MAX_RECORDS,
  connectTimeoutMs: CONNECT_TIMEOUT_MS,
  bodyTimeoutMs: BODY_TIMEOUT_MS,
  runTimeoutMs: RUN_TIMEOUT_MS,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export const ABCA_LIVE_CONTRACT_DIGEST = digest(ABCA_LIVE_CONTRACT);

function fail(code, detail) {
  const error = new Error(detail === undefined ? code : `${code}:${detail}`);
  error.code = code;
  throw error;
}

function failRateLimited(response) {
  const error = new Error('CANA_LIVE_REALITY_RATE_LIMITED');
  error.code = 'CANA_LIVE_REALITY_RATE_LIMITED';
  const retryAfter = String(response.headers.get('retry-after') ?? '').trim();
  if (/^\d{1,6}$/.test(retryAfter)) {
    error.retryAfterMs = Math.min(Number(retryAfter) * 1000, 24 * 60 * 60 * 1000);
  } else {
    const retryAt = new Date(retryAfter);
    if (Number.isFinite(retryAt.getTime())) error.retryAfterAt = retryAt.toISOString();
  }
  throw error;
}

function isTruthyMarker(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validateContractUrl(url, kind) {
  if (!(url instanceof URL)) fail('CANA_LIVE_REALITY_FIXED_CONTRACT');
  if (
    url.protocol !== ABCA_LIVE_CONTRACT.protocol
    || url.hostname !== ABCA_LIVE_CONTRACT.hostname
    || url.port !== ABCA_LIVE_CONTRACT.port
    || url.username
    || url.password
  ) fail('CANA_LIVE_REALITY_FIXED_CONTRACT');
  const expectedPath = kind === 'metadata'
    ? new URL(ABCA_LAYER_URL).pathname
    : new URL(ABCA_QUERY_URL).pathname;
  if (url.pathname !== expectedPath || url.hash) fail('CANA_LIVE_REALITY_FIXED_CONTRACT');
  return url;
}

export function buildAbcaRequestUrls(overrides) {
  if (overrides !== undefined) fail('CANA_LIVE_REALITY_FIXED_CONTRACT');
  const metadata = new URL(ABCA_LAYER_URL);
  metadata.searchParams.set('f', 'json');
  const count = new URL(ABCA_QUERY_URL);
  count.searchParams.set('where', '1=1');
  count.searchParams.set('returnCountOnly', 'true');
  count.searchParams.set('f', 'json');
  const records = new URL(ABCA_QUERY_URL);
  records.searchParams.set('where', '1=1');
  records.searchParams.set('outFields', ABCA_FIELDS.join(','));
  records.searchParams.set('returnGeometry', 'true');
  records.searchParams.set('outSR', '4326');
  records.searchParams.set('orderByFields', 'OBJECTID');
  records.searchParams.set('resultOffset', '0');
  records.searchParams.set('resultRecordCount', String(MAX_RECORDS));
  records.searchParams.set('f', 'json');
  return Object.freeze({
    metadata: validateContractUrl(metadata, 'metadata'),
    count: validateContractUrl(count, 'query'),
    records: validateContractUrl(records, 'query'),
  });
}

export function assertLiveAcquisitionAuthority({ env = process.env, request } = {}) {
  if (env.CANA_LIVE_REALITY_NETWORK !== '1') fail('CANA_LIVE_REALITY_AUTHORITY_REQUIRED');
  if (CI_MARKERS.some((name) => isTruthyMarker(env[name]))) fail('CANA_LIVE_REALITY_CI_REFUSED');
  if (PROXY_MARKERS.some((name) => isTruthyMarker(env[name]))) fail('CANA_LIVE_REALITY_PROXY_REFUSED');
  if (request && (typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length > 0)) {
    fail('CANA_LIVE_REALITY_REQUEST_INPUT_REFUSED');
  }
  return Object.freeze({
    authorized: true,
    source_id: ABCA_LIVE_CONTRACT.sourceId,
    source_key: ABCA_LIVE_CONTRACT.sourceKey,
    effects: Object.freeze({ read_only_public_requests: true, truth_mutations: 0, production_mutations: 0 }),
  });
}

function publicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function ipv6Words(address) {
  let normalized = address.toLowerCase();
  if (normalized.includes('%')) return null;
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const octets = normalized.slice(separator + 1).split('.').map(Number);
    if (separator < 0 || octets.length !== 4 || octets.some((value) => (
      !Number.isInteger(value) || value < 0 || value > 255
    ))) return null;
    normalized = `${normalized.slice(0, separator + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const fields = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (fields.length !== 8 || fields.some((field) => !/^[0-9a-f]{1,4}$/.test(field))) return null;
  return fields.map((field) => Number.parseInt(field, 16));
}

function publicIpv6(address) {
  const words = ipv6Words(address);
  if (!words) return false;
  if (words.every((word) => word === 0)) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const embedded = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return publicIpv4(embedded);
  }
  if (words.slice(0, 6).every((word) => word === 0)) return false;
  const first = words[0];
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if ((first & 0xffc0) === 0xfec0) return false;
  if (first === 0x0064 && words[1] === 0xff9b && (words[2] === 0 || words[2] === 1)) return false;
  if (first === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return false;
  if (first === 0x2001 && words[1] === 0x0db8) return false;
  if (first === 0x2002) return false;
  return true;
}

export function validateResolvedAddresses(records) {
  if (!Array.isArray(records) || records.length === 0) fail('CANA_LIVE_REALITY_DNS_INVALID');
  const addresses = [];
  for (const record of records) {
    const address = typeof record === 'string' ? record : record?.address;
    const family = isIP(address ?? '');
    if (!family) fail('CANA_LIVE_REALITY_DNS_INVALID');
    if (family === 4 ? !publicIpv4(address) : !publicIpv6(address)) {
      fail('CANA_LIVE_REALITY_SSRF_REFUSED');
    }
    addresses.push(address);
  }
  return Object.freeze([...new Set(addresses)]);
}

export async function resolveAbcaAddresses({ lookup = defaultLookup } = {}) {
  if (typeof lookup !== 'function') fail('CANA_LIVE_REALITY_DNS_INVALID');
  let records;
  try {
    records = await lookup(ABCA_LIVE_CONTRACT.hostname, { all: true, verbatim: true });
  } catch {
    fail('CANA_LIVE_REALITY_DNS_FAILED');
  }
  return validateResolvedAddresses(records);
}

function responseMetadata(response, contentType) {
  return Object.freeze({
    http_status: response.status,
    content_type: contentType,
    etag: response.headers.get('etag'),
    last_modified: response.headers.get('last-modified'),
    date: response.headers.get('date'),
  });
}

export async function readBoundedJsonResponse(response, {
  maxBytes = MAX_RESPONSE_BYTES,
  timeoutMs = BODY_TIMEOUT_MS,
} = {}) {
  if (!response || typeof response.status !== 'number' || !response.headers) fail('CANA_LIVE_REALITY_RESPONSE_INVALID');
  if (response.status >= 300 && response.status <= 399) fail('CANA_LIVE_REALITY_REDIRECT_REFUSED');
  if (response.status === 429) failRateLimited(response);
  if (response.status < 200 || response.status > 299) fail('CANA_LIVE_REALITY_HTTP_ERROR', String(response.status));
  const contentType = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!JSON_CONTENT_TYPES.includes(contentType)) fail('CANA_LIVE_REALITY_CONTENT_TYPE_REFUSED');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    fail('CANA_LIVE_REALITY_RESPONSE_OVERSIZE');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    fail('CANA_LIVE_REALITY_BUDGET_INVALID');
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail('CANA_LIVE_REALITY_RESPONSE_INVALID');
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('CANA_LIVE_REALITY_RESPONSE_TIMEOUT');
      error.code = 'CANA_LIVE_REALITY_RESPONSE_TIMEOUT';
      reject(error);
      Promise.resolve(reader.cancel()).catch(() => {});
    }, timeoutMs);
  });
  const consume = (async () => {
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('CANA_LIVE_REALITY_RESPONSE_INVALID');
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        fail('CANA_LIVE_REALITY_RESPONSE_OVERSIZE');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  })();
  let bytes;
  try {
    bytes = await Promise.race([consume, timeout]);
  } finally {
    clearTimeout(timer);
  }
  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('CANA_LIVE_REALITY_JSON_INVALID');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('CANA_LIVE_REALITY_JSON_INVALID');
  return Object.freeze({ bytes, body: Object.freeze(body), metadata: responseMetadata(response, contentType) });
}

export function createPinnedLookup(address) {
  const family = isIP(address ?? '');
  if (!family || !validateResolvedAddresses([address]).includes(address)) {
    fail('CANA_LIVE_REALITY_DNS_INVALID');
  }
  return (hostname, options, callback) => {
    if (hostname !== ABCA_LIVE_CONTRACT.hostname) {
      callback(Object.assign(new Error('CANA_LIVE_REALITY_FIXED_CONTRACT'), { code: 'CANA_LIVE_REALITY_FIXED_CONTRACT' }));
      return;
    }
    if (options?.all === true) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function pinnedHttpsResponse(url, { addresses, signal }) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    let settled = false;
    const rejectStable = (code) => {
      if (settled) return;
      settled = true;
      const error = new Error(code);
      error.code = code;
      reject(error);
    };
    const request = httpsRequest(url, {
      method: 'GET',
      agent: false,
      servername: ABCA_LIVE_CONTRACT.hostname,
      headers: { accept: 'application/json' },
      lookup: createPinnedLookup(address),
    }, (response) => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      resolve({
        status: response.statusCode ?? 0,
        headers: new Headers(response.headers),
        body: Readable.toWeb(response),
      });
    });
    const connectTimer = setTimeout(() => {
      request.destroy();
      rejectStable('CANA_LIVE_REALITY_CONNECT_TIMEOUT');
    }, CONNECT_TIMEOUT_MS);
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => clearTimeout(connectTimer));
    });
    request.once('error', (error) => {
      clearTimeout(connectTimer);
      rejectStable(error?.code === 'CANA_LIVE_REALITY_FIXED_CONTRACT'
        ? error.code
        : 'CANA_LIVE_REALITY_NETWORK_ERROR');
    });
    if (signal) {
      if (signal.aborted) {
        clearTimeout(connectTimer);
        request.destroy();
        rejectStable('CANA_LIVE_REALITY_RUN_TIMEOUT');
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(connectTimer);
        request.destroy();
        rejectStable('CANA_LIVE_REALITY_RUN_TIMEOUT');
      }, { once: true });
    }
    request.end();
  });
}

export async function fetchAbcaResponse(url, { fetchImpl, signal, resolvedAddresses } = {}) {
  const urls = buildAbcaRequestUrls();
  if (![urls.metadata.toString(), urls.count.toString(), urls.records.toString()].includes(url?.toString?.())) {
    fail('CANA_LIVE_REALITY_FIXED_CONTRACT');
  }
  const addresses = validateResolvedAddresses(resolvedAddresses);
  if (fetchImpl !== undefined) {
    if (typeof fetchImpl !== 'function') fail('CANA_LIVE_REALITY_TRANSPORT_INVALID');
    return fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal,
    });
  }
  return pinnedHttpsResponse(url, { addresses, signal });
}

function exactRevision(metadata) {
  if (metadata?.error || metadata?.id !== ABCA_LIVE_CONTRACT.layerId) {
    fail('CANA_LIVE_REALITY_SCHEMA_CHANGED');
  }
  const fields = new Set(Array.isArray(metadata.fields) ? metadata.fields.map((field) => field?.name) : []);
  if (ABCA_FIELDS.some((field) => !fields.has(field))) fail('CANA_LIVE_REALITY_SCHEMA_CHANGED');
  if (
    !String(metadata.capabilities ?? '').split(',').map((value) => value.trim()).includes('Query')
    || metadata.advancedQueryCapabilities?.supportsPagination !== true
    || metadata.advancedQueryCapabilities?.supportsOrderBy !== true
    || !Number.isInteger(metadata.maxRecordCount)
    || metadata.maxRecordCount < 1
  ) fail('CANA_LIVE_REALITY_SCHEMA_CHANGED');
  const revision = metadata.editingInfo?.lastEditDate;
  return Number.isFinite(revision) && revision >= 0 ? revision : null;
}

function exactCount(body, maximum) {
  if (body?.error || !Number.isInteger(body?.count) || body.count < 0 || body.count > maximum) {
    fail('CANA_LIVE_REALITY_COUNT_INVALID');
  }
  return body.count;
}

function summarizeResponse(response) {
  return {
    etag: response.metadata.etag,
    last_modified: response.metadata.last_modified,
    http_status: response.metadata.http_status,
    content_type: response.metadata.content_type,
  };
}

export async function captureAbcaReality({
  fetchImpl,
  lookup = defaultLookup,
  clock = () => new Date(),
  onStage = async () => {},
} = {}) {
  if (typeof clock !== 'function' || typeof onStage !== 'function') fail('CANA_LIVE_REALITY_ADAPTER_INPUT_INVALID');
  const urls = buildAbcaRequestUrls();
  const controller = new AbortController();
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let timedOut = false;
  const runTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, RUN_TIMEOUT_MS);
  const withRunTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
      const error = new Error('CANA_LIVE_REALITY_RUN_TIMEOUT');
      error.code = 'CANA_LIVE_REALITY_RUN_TIMEOUT';
      reject(error);
    }, { once: true })),
  ]);
  let totalBytes = 0;
  let resolvedAddresses;
  const read = async (url) => {
    if (timedOut) fail('CANA_LIVE_REALITY_RUN_TIMEOUT');
    let response;
    try {
      response = await withRunTimeout(
        fetchAbcaResponse(url, { fetchImpl, signal: controller.signal, resolvedAddresses }),
      );
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') fail('CANA_LIVE_REALITY_RUN_TIMEOUT');
      throw error;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1) fail('CANA_LIVE_REALITY_RUN_TIMEOUT');
    let result;
    try {
      result = await readBoundedJsonResponse(response, { timeoutMs: Math.min(BODY_TIMEOUT_MS, remainingMs) });
    } catch (error) {
      if (timedOut) fail('CANA_LIVE_REALITY_RUN_TIMEOUT');
      throw error;
    }
    totalBytes += result.bytes.length;
    if (totalBytes > MAX_RUN_BYTES) fail('CANA_LIVE_REALITY_RUN_OVERSIZE');
    return result;
  };

  try {
    resolvedAddresses = await withRunTimeout(resolveAbcaAddresses({ lookup }));
    const preMetadata = await read(urls.metadata);
    const preRevision = exactRevision(preMetadata.body);
    const preCountResponse = await read(urls.count);
    const preCount = exactCount(preCountResponse.body, Math.min(MAX_RECORDS, preMetadata.body.maxRecordCount));
    const recordsResponse = await read(urls.records);
    const features = recordsResponse.body?.features;
    if (recordsResponse.body?.error || !Array.isArray(features)) fail('CANA_LIVE_REALITY_RECORDS_INVALID');
    if (recordsResponse.body.exceededTransferLimit === true) fail('CANA_LIVE_REALITY_PARTIAL_REFUSED');
    if (features.length !== preCount) fail('CANA_LIVE_REALITY_RECORD_COUNT_MISMATCH');
    const fetchedAt = new Date(clock()).toISOString();
    await onStage('CAPTURED', {
      fetched_at: fetchedAt,
      pre_revision: preRevision === null ? null : String(preRevision),
      pre_count: preCount,
      record_count: features.length,
      payload_bytes: totalBytes,
    });

    const postMetadata = await read(urls.metadata);
    const postRevision = exactRevision(postMetadata.body);
    const postCountResponse = await read(urls.count);
    const postCount = exactCount(postCountResponse.body, Math.min(MAX_RECORDS, postMetadata.body.maxRecordCount));
    if (postRevision !== preRevision) fail('CANA_LIVE_REALITY_REVISION_DRIFT');
    if (postCount !== preCount) fail('CANA_LIVE_REALITY_COUNT_DRIFT');

    const artifacts = buildSnapshotArtifacts({
      metadataBytes: preMetadata.bytes,
      pageParts: [{ offset: 0, bytes: recordsResponse.bytes }],
      fetchedAt,
      sourceModifiedAt: preRevision === null ? null : new Date(preRevision).toISOString(),
      sourceCatalogModifiedDate: null,
      provenanceMode: 'LIVE',
    });
    const validated = validateOfficialSourceSnapshotBytes({
      manifestBytes: artifacts.manifestBytes,
      snapshotBytes: artifacts.snapshotBytes,
    });
    if (validated.record_count !== preCount) fail('CANA_LIVE_REALITY_RECORD_COUNT_MISMATCH');
    const schemaDigest = digest(ABCA_FIELDS);
    const capability = {
      schema_version: 'cana-live-reality-source-capability/v1',
      source_key: ABCA_LIVE_CONTRACT.sourceKey,
      revision: preRevision === null ? 'UNKNOWN' : String(preRevision),
      revision_state: preRevision === null ? 'UNKNOWN' : 'OBSERVED',
      current_version: preMetadata.body.currentVersion,
      capabilities: preMetadata.body.capabilities,
      pagination: true,
      order_by: true,
      fields: [...ABCA_FIELDS],
      schema_digest: schemaDigest,
      limits: {
        source_max_record_count: preMetadata.body.maxRecordCount,
        adapter_max_records: MAX_RECORDS,
        response_bytes: MAX_RESPONSE_BYTES,
        run_bytes: MAX_RUN_BYTES,
      },
    };
    await onStage('POSTFLIGHT_VALIDATED', {
      fetched_at: fetchedAt,
      pre_revision: preRevision === null ? null : String(preRevision),
      post_revision: postRevision === null ? null : String(postRevision),
      pre_count: preCount,
      post_count: postCount,
      payload_bytes: totalBytes,
      content_sha256: validated.snapshot_sha256,
    });
    return Object.freeze({
      source_id: ABCA_LIVE_CONTRACT.sourceId,
      source_key: ABCA_LIVE_CONTRACT.sourceKey,
      source_url: ABCA_LIVE_CONTRACT.layerUrl,
      request_digest: ABCA_LIVE_CONTRACT_DIGEST,
      content_sha256: validated.snapshot_sha256,
      snapshot_bytes: artifacts.snapshotBytes,
      manifest_bytes: artifacts.manifestBytes,
      manifest: artifacts.manifest,
      fetched_at: fetchedAt,
      source_modified_at: preRevision === null ? null : new Date(preRevision).toISOString(),
      pre_revision: preRevision === null ? null : String(preRevision),
      post_revision: postRevision === null ? null : String(postRevision),
      pre_count: preCount,
      post_count: postCount,
      record_count: preCount,
      payload_bytes: artifacts.snapshotBytes.length,
      wire_bytes: totalBytes,
      response: Object.freeze(summarizeResponse(recordsResponse)),
      capability: Object.freeze(capability),
    });
  } finally {
    clearTimeout(runTimer);
  }
}
