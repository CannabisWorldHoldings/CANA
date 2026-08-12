// BOUNDED HTML ACQUISITION CORE — extracted at fork ×2 (VA + MD), per the
// evidence-threshold law: generalize when two markets prove the shape, never
// before, never after a third copy.
//
// One implementation of the bounded-acquisition law set for HTML registry
// sources; each market supplies only a frozen contract, an extraction
// function, an error prefix, and an operator-grant env key:
//   - FIXED ORIGIN: exactly one https URL; request overrides refused.
//   - OPERATOR OPT-IN: explicit environment grant required per market.
//   - BOUNDED: response/run bytes, connect/body/run timeouts, record ceiling.
//   - PINNED LOOKUP: refuses every hostname except the contract's.
//   - CONTENT STABILITY: double fetch; both reads must hash identically or
//     the acquisition terminates CONTENT_UNSTABLE with zero statements.
//   - READ-ONLY: zero truth mutations, zero production mutations.
//
// Behavior equivalence with the pre-extraction VA/MD adapters is proven by
// re-running their UNCHANGED test suites against the shared core.

import { createHash } from 'node:crypto';

export function canonicalJson(value) {
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

export function contractDigest(contract) {
  return sha256(canonicalJson(contract));
}

/**
 * Build a bounded HTML acquisition lane from a frozen market contract.
 * @param {object} input
 *   contract     frozen contract ({ schemaVersion, sourceId, sourceKey,
 *                hostname, pageUrl, maxResponseBytes, maxRunBytes, maxRecords,
 *                bodyTimeoutMs, runTimeoutMs, ... })
 *   extract      (html, { url, pageSha256 }) => { records, rejects }
 *   errorPrefix  e.g. 'CANA_LIVE_VA_CCA'
 *   envGrantKey  e.g. 'CANA_LIVE_VA_CCA_ACQUISITION'
 */
export function createBoundedHtmlAcquisition({ contract, extract, errorPrefix, envGrantKey }) {
  if (!contract || typeof contract.pageUrl !== 'string' || typeof contract.hostname !== 'string') {
    throw new Error('createBoundedHtmlAcquisition: contract with pageUrl and hostname is required');
  }
  if (typeof extract !== 'function') {
    throw new Error('createBoundedHtmlAcquisition: extract function is required');
  }
  if (typeof errorPrefix !== 'string' || !/^CANA_[A-Z0-9_]+$/.test(errorPrefix)) {
    throw new Error('createBoundedHtmlAcquisition: errorPrefix must be a CANA_* token');
  }
  if (typeof envGrantKey !== 'string' || envGrantKey.length === 0) {
    throw new Error('createBoundedHtmlAcquisition: envGrantKey is required');
  }
  const digest = contractDigest(contract);

  function buildRequestUrl(overrides) {
    if (overrides !== undefined) {
      throw new Error(`${errorPrefix}_REQUEST_OVERRIDE_REFUSED`);
    }
    return new URL(contract.pageUrl);
  }

  function assertAcquisitionAuthority({ env = process.env } = {}) {
    if (env?.[envGrantKey] !== 'OPERATOR_APPROVED') {
      throw new Error(`${errorPrefix}_ACQUISITION_NOT_AUTHORIZED`);
    }
    return Object.freeze({
      authorized: true,
      source_id: contract.sourceId,
      source_key: contract.sourceKey,
      effects: Object.freeze({
        read_only_public_requests: true,
        truth_mutations: 0,
        production_mutations: 0,
      }),
    });
  }

  function createPinnedLookup(address) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`${errorPrefix}_PINNED_ADDRESS_REQUIRED`);
    }
    return (hostname, options, callback) => {
      const done = typeof options === 'function' ? options : callback;
      if (hostname !== contract.hostname) {
        done(new Error(`${errorPrefix}_HOSTNAME_REFUSED`));
        return;
      }
      done(null, address, address.includes(':') ? 6 : 4);
    };
  }

  async function readBoundedTextResponse(response, {
    maxBytes = contract.maxResponseBytes,
    timeoutMs = contract.bodyTimeoutMs,
  } = {}) {
    if (!response?.body?.getReader) {
      const text = await response.text();
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > maxBytes) throw new Error(`${errorPrefix}_RESPONSE_TOO_LARGE`);
      return { text, bytes };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) {
        await reader.cancel().catch(() => {});
        throw new Error(`${errorPrefix}_BODY_TIMEOUT`);
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${errorPrefix}_RESPONSE_TOO_LARGE`);
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
      throw new Error(`${errorPrefix}_HTTP_ERROR:${response?.status ?? 'NO_RESPONSE'}`);
    }
    return readBoundedTextResponse(response);
  }

  async function capture({
    fetchImpl,
    env = process.env,
    clock = () => new Date(),
    onStage = async () => {},
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error(`${errorPrefix}_FETCH_IMPL_REQUIRED`);
    }
    const capability = assertAcquisitionAuthority({ env });
    const startedAt = clock();
    const deadline = startedAt.getTime() + contract.runTimeoutMs;
    const url = buildRequestUrl();

    await onStage('PRE_FETCH');
    const pre = await fetchPage(fetchImpl, url);
    const preSha = sha256(pre.text);
    if (clock().getTime() > deadline) throw new Error(`${errorPrefix}_RUN_TIMEOUT`);

    await onStage('POST_FETCH');
    const post = await fetchPage(fetchImpl, url);
    const postSha = sha256(post.text);
    if (clock().getTime() > deadline) throw new Error(`${errorPrefix}_RUN_TIMEOUT`);
    if (pre.bytes + post.bytes > contract.maxRunBytes) {
      throw new Error(`${errorPrefix}_RUN_BYTES_EXCEEDED`);
    }
    if (preSha !== postSha) {
      throw new Error(`${errorPrefix}_CONTENT_UNSTABLE`);
    }

    await onStage('EXTRACT');
    const { records, rejects } = extract(post.text, {
      url: contract.pageUrl,
      pageSha256: postSha,
    });
    if (records.length === 0) throw new Error(`${errorPrefix}_EXTRACTION_EMPTY`);
    if (records.length > contract.maxRecords) {
      throw new Error(`${errorPrefix}_RECORD_CEILING_EXCEEDED`);
    }

    const fetchedAt = clock();
    return Object.freeze({
      schema_version: contract.schemaVersion,
      source_id: contract.sourceId,
      source_key: contract.sourceKey,
      source_url: contract.pageUrl,
      request_digest: digest,
      adapter_contract_digest: digest,
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

  return Object.freeze({
    contractDigest: digest,
    buildRequestUrl,
    assertAcquisitionAuthority,
    createPinnedLookup,
    readBoundedTextResponse,
    capture,
  });
}
