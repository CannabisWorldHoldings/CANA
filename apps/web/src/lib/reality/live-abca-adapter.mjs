import { lookup as defaultLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

import {
  ABCA_FIELDS,
  ABCA_LAYER_URL,
  ABCA_QUERY_URL,
  ABCA_SOURCE_ID,
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

function fail(code, detail) {
  const error = new Error(detail === undefined ? code : `${code}:${detail}`);
  error.code = code;
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

function publicIpv6(address) {
  const lower = address.toLowerCase();
  if (lower.includes('%') || lower === '::' || lower === '::1') return false;
  if (lower.startsWith('::ffff:')) return publicIpv4(lower.slice(7));
  const first = Number.parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (lower.startsWith('2001:db8:')) return false;
  return true;
}

export function validateResolvedAddresses(records) {
  if (!Array.isArray(records) || records.length === 0) fail('CANA_LIVE_REALITY_DNS_INVALID');
  const addresses = [];
  for (const record of records) {
    const address = record?.address;
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

function pinnedHttpsResponse(url, { addresses, signal }) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const family = isIP(address);
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
      lookup(hostname, _options, callback) {
        if (hostname !== ABCA_LIVE_CONTRACT.hostname) {
          callback(Object.assign(new Error('CANA_LIVE_REALITY_FIXED_CONTRACT'), { code: 'CANA_LIVE_REALITY_FIXED_CONTRACT' }));
          return;
        }
        callback(null, address, family);
      },
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
