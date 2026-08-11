import assert from 'node:assert/strict';
import { test } from 'node:test';

const STATE_MODULE = '../src/lib/reality/acquisition-state-machine.mjs';
const ADAPTER_MODULE = '../src/lib/reality/live-abca-adapter.mjs';

const cleanEnv = Object.freeze({ CANA_LIVE_REALITY_NETWORK: '1' });
const sha = (character) => character.repeat(64);

test('state machine accepts only the two governed success branches with hash-chained events', async () => {
  const {
    createAcquisitionState,
    transitionAcquisition,
  } = await import(STATE_MODULE);
  const start = createAcquisitionState({
    attemptId: 'attempt-1',
    sourceKey: 'dcgis_abca_retailers_layer_31',
    at: '2026-08-10T12:00:00.000Z',
    requestDigest: sha('a'),
  });
  assert.equal(start.state, 'REQUESTED');
  assert.equal(start.events.length, 1);
  assert.equal(start.events[0].sequence, 1);
  assert.equal(start.events[0].prior_event_digest, sha('0'));
  assert.match(start.events[0].event_digest, /^[a-f0-9]{64}$/);

  const changedStates = [
    'PREFLIGHT_VALIDATED',
    'FETCHING',
    'CAPTURED',
    'POSTFLIGHT_VALIDATED',
    'CHANGED',
    'PERSISTED',
    'COMPLETED',
  ];
  let changed = start;
  for (const [index, state] of changedStates.entries()) {
    changed = transitionAcquisition(changed, {
      state,
      at: new Date(Date.parse('2026-08-10T12:00:00.000Z') + (index + 1) * 1000).toISOString(),
      detail: { state },
    });
  }
  assert.equal(changed.state, 'COMPLETED');
  assert.equal(changed.events.length, 8);
  for (let index = 1; index < changed.events.length; index += 1) {
    assert.equal(changed.events[index].prior_event_digest, changed.events[index - 1].event_digest);
    assert.equal(changed.events[index].sequence, index + 1);
  }
  assert.equal(Object.isFrozen(changed), true);
  assert.equal(Object.isFrozen(changed.events), true);

  let unchanged = start;
  for (const [index, state] of [
    'PREFLIGHT_VALIDATED',
    'FETCHING',
    'CAPTURED',
    'POSTFLIGHT_VALIDATED',
    'UNCHANGED',
    'REVALIDATION_PENDING',
    'COMPLETED',
  ].entries()) {
    unchanged = transitionAcquisition(unchanged, {
      state,
      at: new Date(Date.parse('2026-08-10T12:00:00.000Z') + (index + 1) * 1000).toISOString(),
    });
  }
  assert.equal(unchanged.state, 'COMPLETED');
});

test('state machine rejects skips, reversals, unknown states, and terminal continuation', async () => {
  const { createAcquisitionState, transitionAcquisition } = await import(STATE_MODULE);
  const start = createAcquisitionState({
    attemptId: 'attempt-hostile',
    sourceKey: 'dcgis_abca_retailers_layer_31',
    at: '2026-08-10T12:00:00.000Z',
    requestDigest: sha('a'),
  });
  for (const state of ['FETCHING', 'COMPLETED', 'UNKNOWN_STATE']) {
    assert.throws(
      () => transitionAcquisition(start, { state, at: '2026-08-10T12:00:01.000Z' }),
      /CANA_LIVE_REALITY_TRANSITION_INVALID/,
    );
  }
  const validated = transitionAcquisition(start, {
    state: 'PREFLIGHT_VALIDATED',
    at: '2026-08-10T12:00:01.000Z',
  });
  assert.throws(
    () => transitionAcquisition(validated, { state: 'REQUESTED', at: '2026-08-10T12:00:02.000Z' }),
    /CANA_LIVE_REALITY_TRANSITION_INVALID/,
  );
  const failed = transitionAcquisition(validated, {
    state: 'FAILED',
    at: '2026-08-10T12:00:02.000Z',
    detail: { error_code: 'CANA_LIVE_REALITY_SOURCE_FAILED' },
  });
  assert.equal(failed.state, 'FAILED');
  assert.throws(
    () => transitionAcquisition(failed, { state: 'FETCHING', at: '2026-08-10T12:00:03.000Z' }),
    /CANA_LIVE_REALITY_TERMINAL_STATE/,
  );
});

test('state machine transition table is exhaustive and failure is reachable from every nonterminal state', async () => {
  const {
    ACQUISITION_TRANSITIONS,
    createAcquisitionState,
    transitionAcquisition,
  } = await import(STATE_MODULE);
  assert.deepEqual(ACQUISITION_TRANSITIONS, {
    REQUESTED: ['PREFLIGHT_VALIDATED', 'FAILED'],
    PREFLIGHT_VALIDATED: ['FETCHING', 'FAILED'],
    FETCHING: ['CAPTURED', 'FAILED'],
    CAPTURED: ['POSTFLIGHT_VALIDATED', 'FAILED'],
    POSTFLIGHT_VALIDATED: ['CHANGED', 'UNCHANGED', 'FAILED'],
    CHANGED: ['PERSISTED', 'FAILED'],
    PERSISTED: ['COMPLETED', 'FAILED'],
    UNCHANGED: ['REVALIDATION_PENDING', 'FAILED'],
    REVALIDATION_PENDING: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
  });
  const paths = {
    REQUESTED: [],
    PREFLIGHT_VALIDATED: ['PREFLIGHT_VALIDATED'],
    FETCHING: ['PREFLIGHT_VALIDATED', 'FETCHING'],
    CAPTURED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED'],
    POSTFLIGHT_VALIDATED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED'],
    CHANGED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'CHANGED'],
    PERSISTED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'CHANGED', 'PERSISTED'],
    UNCHANGED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'UNCHANGED'],
    REVALIDATION_PENDING: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'UNCHANGED', 'REVALIDATION_PENDING'],
    COMPLETED: ['PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'CHANGED', 'PERSISTED', 'COMPLETED'],
    FAILED: ['FAILED'],
  };
  const allStates = [...Object.keys(ACQUISITION_TRANSITIONS), 'NOT_A_STATE'];
  for (const [source, path] of Object.entries(paths)) {
    let current = createAcquisitionState({
      attemptId: `attempt-${source.toLowerCase()}`,
      sourceKey: 'dcgis_abca_retailers_layer_31',
      at: '2026-08-10T12:00:00.000Z',
      requestDigest: sha('a'),
    });
    for (const [index, state] of path.entries()) {
      current = transitionAcquisition(current, {
        state,
        at: new Date(Date.parse('2026-08-10T12:00:00.000Z') + (index + 1) * 1000).toISOString(),
      });
    }
    assert.equal(current.state, source);
    for (const target of allStates) {
      const operation = () => transitionAcquisition(current, {
        state: target,
        at: '2026-08-10T12:01:00.000Z',
      });
      if (ACQUISITION_TRANSITIONS[source].includes(target)) assert.doesNotThrow(operation, `${source} -> ${target}`);
      else assert.throws(operation, /CANA_LIVE_REALITY_(?:TRANSITION_INVALID|TERMINAL_STATE)/, `${source} -> ${target}`);
    }
  }
});

test('every acquisition terminal result has an explicit fail-closed disposition', async () => {
  const {
    ACQUISITION_TERMINAL_RESULTS,
    classifyAcquisitionTerminal,
  } = await import(STATE_MODULE);
  assert.deepEqual(Object.keys(ACQUISITION_TERMINAL_RESULTS), [
    'SUCCESS_CHANGED',
    'SUCCESS_UNCHANGED',
    'SOURCE_OUTAGE',
    'RATE_LIMITED',
    'HTTP_FAILURE',
    'TIMEOUT',
    'SCHEMA_DRIFT',
    'CAPABILITY_CHANGED',
    'PARTIAL',
    'REVISION_UNBOUND',
    'CONTENT_TYPE_REFUSED',
    'PAYLOAD_LIMIT_EXCEEDED',
    'POLICY_REFUSED',
    'CANCELLED',
  ]);
  for (const [terminalResult, disposition] of Object.entries(ACQUISITION_TERMINAL_RESULTS)) {
    assert.equal(disposition.terminal_result, terminalResult);
    assert.deepEqual(Object.keys(disposition).sort(), [
      'may_compile',
      'may_create_negative_evidence',
      'may_fallback',
      'may_mutate_truth',
      'may_retry',
      'may_revalidate',
      'terminal_result',
    ]);
    assert.equal(disposition.may_fallback, false);
    assert.equal(disposition.may_create_negative_evidence, false);
    assert.equal(disposition.may_mutate_truth, false);
  }
  assert.equal(classifyAcquisitionTerminal({ outcome: 'SOURCE_CHANGED' }).terminal_result, 'SUCCESS_CHANGED');
  assert.equal(classifyAcquisitionTerminal({ outcome: 'SOURCE_UNCHANGED' }).terminal_result, 'SUCCESS_UNCHANGED');
  assert.equal(classifyAcquisitionTerminal({ outcome: 'SOURCE_CHANGED', revisionBound: false }).may_compile, true);
  assert.equal(classifyAcquisitionTerminal({ outcome: 'SOURCE_CHANGED', revisionBound: false }).may_revalidate, false);
  assert.equal(classifyAcquisitionTerminal({ outcome: 'SOURCE_UNCHANGED', revisionBound: false }).may_revalidate, false);
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_RATE_LIMITED' }).terminal_result, 'RATE_LIMITED');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_HTTP_ERROR' }).terminal_result, 'HTTP_FAILURE');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_RESPONSE_TIMEOUT' }).terminal_result, 'TIMEOUT');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_SCHEMA_CHANGED' }).terminal_result, 'SCHEMA_DRIFT');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_REVISION_DRIFT' }).terminal_result, 'REVISION_UNBOUND');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_PARTIAL_REFUSED' }).terminal_result, 'PARTIAL');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_CONTENT_TYPE_REFUSED' }).terminal_result, 'CONTENT_TYPE_REFUSED');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_RESPONSE_OVERSIZE' }).terminal_result, 'PAYLOAD_LIMIT_EXCEEDED');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_AUTHORITY_REQUIRED' }).terminal_result, 'POLICY_REFUSED');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_NETWORK_ERROR' }).terminal_result, 'SOURCE_OUTAGE');
  assert.equal(classifyAcquisitionTerminal({ errorCode: 'CANA_LIVE_REALITY_UNEXPECTED_FAILURE' }).terminal_result, 'CANCELLED');
});

test('fixed ABCA contract has no caller-controlled URL, fields, or query surface', async () => {
  const {
    ABCA_LIVE_CONTRACT,
    buildAbcaRequestUrls,
  } = await import(ADAPTER_MODULE);
  assert.equal(ABCA_LIVE_CONTRACT.protocol, 'https:');
  assert.equal(ABCA_LIVE_CONTRACT.hostname, 'maps2.dcgis.dc.gov');
  assert.equal(ABCA_LIVE_CONTRACT.port, '');
  assert.equal(ABCA_LIVE_CONTRACT.layerId, 31);
  assert.equal(ABCA_LIVE_CONTRACT.maxResponseBytes, 2 * 1024 * 1024);
  assert.equal(ABCA_LIVE_CONTRACT.maxRunBytes, 4 * 1024 * 1024);
  assert.equal(ABCA_LIVE_CONTRACT.maxRecords, 500);
  const urls = buildAbcaRequestUrls();
  assert.equal(urls.metadata.toString(), 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31?f=json');
  assert.match(urls.count.toString(), /\/31\/query\?/);
  assert.equal(urls.count.searchParams.get('where'), '1=1');
  assert.equal(urls.count.searchParams.get('returnCountOnly'), 'true');
  assert.equal(urls.count.searchParams.get('f'), 'json');
  assert.match(urls.records.toString(), /\/31\/query\?/);
  assert.equal(urls.records.searchParams.get('where'), '1=1');
  assert.equal(urls.records.searchParams.get('orderByFields'), 'OBJECTID');
  assert.equal(urls.records.searchParams.get('returnGeometry'), 'true');
  assert.equal(urls.records.searchParams.get('outSR'), '4326');
  assert.equal(urls.records.searchParams.get('f'), 'json');
  assert.equal(urls.records.searchParams.get('resultOffset'), '0');
  assert.equal(urls.records.searchParams.get('resultRecordCount'), '500');
  assert.equal(urls.records.searchParams.get('outFields'), ABCA_LIVE_CONTRACT.fields.join(','));
  assert.throws(() => buildAbcaRequestUrls({ hostname: 'attacker.example' }), /CANA_LIVE_REALITY_FIXED_CONTRACT/);
});

test('CI, missing authority, proxy, credential, header, and caller URL inputs are refused', async () => {
  const { assertLiveAcquisitionAuthority } = await import(ADAPTER_MODULE);
  assert.throws(
    () => assertLiveAcquisitionAuthority({ env: {} }),
    /CANA_LIVE_REALITY_AUTHORITY_REQUIRED/,
  );
  for (const marker of ['CI', 'GITHUB_ACTIONS', 'CANA_VERIFY_PROFILE']) {
    assert.throws(
      () => assertLiveAcquisitionAuthority({ env: { ...cleanEnv, [marker]: 'false' } }),
      /CANA_LIVE_REALITY_CI_REFUSED/,
    );
  }
  for (const proxy of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']) {
    assert.throws(
      () => assertLiveAcquisitionAuthority({ env: { ...cleanEnv, [proxy]: 'http://proxy.invalid' } }),
      /CANA_LIVE_REALITY_PROXY_REFUSED/,
    );
  }
  for (const hostile of [
    { url: 'https://attacker.example' },
    { headers: { authorization: 'secret' } },
    { authorization: 'secret' },
    { cookie: 'session=secret' },
    { credentials: 'include' },
  ]) {
    assert.throws(
      () => assertLiveAcquisitionAuthority({ env: cleanEnv, request: hostile }),
      /CANA_LIVE_REALITY_REQUEST_INPUT_REFUSED/,
    );
  }
  assert.equal(assertLiveAcquisitionAuthority({ env: cleanEnv }).authorized, true);
});

test('SSRF validation accepts only public DNS answers and rejects rebinding candidates', async () => {
  const { validateResolvedAddresses } = await import(ADAPTER_MODULE);
  assert.deepEqual(validateResolvedAddresses([
    { address: '23.48.99.80', family: 4 },
    { address: '2600:1408:ec00:36::1736:7f24', family: 6 },
    { address: '2001:4860:4860::8888', family: 6 },
  ]), ['23.48.99.80', '2600:1408:ec00:36::1736:7f24', '2001:4860:4860::8888']);
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.88.99.1',
    '192.168.1.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:0:0:0',
    '0:0:0:0:0:0:0:1',
    '0:0:0:0:0:ffff:127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
    'fc00::1',
    'fc00:0:0:0:0:0:0:1',
    'fe80::1',
    'fe80:0:0:0:0:0:0:1',
    'ff02::1',
    'ff02:0:0:0:0:0:0:1',
    '64:ff9b::7f00:1',
    '2001:0000::1',
    '2001:0010::1',
    '2001:0020::1',
    '2001:0030::1',
    '2001:0db8:0:0:0:0:0:1',
    '2002:7f00:1::1',
    '3fff::1',
    '5f00::1',
  ]) {
    assert.throws(
      () => validateResolvedAddresses([{ address }]),
      /CANA_LIVE_REALITY_SSRF_REFUSED/,
      address,
    );
  }
  assert.deepEqual(validateResolvedAddresses([
    { address: '2600:1408:ec00:36:0:0:1736:7f24', family: 6 },
  ]), ['2600:1408:ec00:36:0:0:1736:7f24']);
  assert.throws(() => validateResolvedAddresses([]), /CANA_LIVE_REALITY_DNS_INVALID/);
  assert.throws(() => validateResolvedAddresses([{ address: 'not-an-ip' }]), /CANA_LIVE_REALITY_DNS_INVALID/);
});

test('fixed transport requires validated DNS and refuses redirects without following them', async () => {
  const { buildAbcaRequestUrls, fetchAbcaResponse } = await import(ADAPTER_MODULE);
  const { metadata } = buildAbcaRequestUrls();
  let called = false;
  const fetchImpl = async (_url, options) => {
    called = true;
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    return new Response('', { status: 302, headers: { location: 'https://attacker.example' } });
  };
  await assert.rejects(
    fetchAbcaResponse(metadata, { fetchImpl }),
    /CANA_LIVE_REALITY_DNS_INVALID/,
  );
  assert.equal(called, false);
  const response = await fetchAbcaResponse(metadata, {
    fetchImpl,
    resolvedAddresses: [{ address: '23.48.99.80', family: 4 }],
  });
  assert.equal(called, true);
  assert.equal(response.status, 302);
});

test('pinned DNS lookup honors both scalar and Node 24 all-address callback contracts', async () => {
  const { createPinnedLookup } = await import(ADAPTER_MODULE);
  assert.equal(typeof createPinnedLookup, 'function');
  const lookup = createPinnedLookup('23.48.99.80');
  await new Promise((resolve, reject) => {
    lookup('maps2.dcgis.dc.gov', { all: true }, (error, addresses) => {
      try {
        assert.ifError(error);
        assert.deepEqual(addresses, [{ address: '23.48.99.80', family: 4 }]);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
  await new Promise((resolve, reject) => {
    lookup('maps2.dcgis.dc.gov', { all: false }, (error, address, family) => {
      try {
        assert.ifError(error);
        assert.equal(address, '23.48.99.80');
        assert.equal(family, 4);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});

test('bounded response accepts one small JSON response and records observed metadata', async () => {
  const { readBoundedJsonResponse } = await import(ADAPTER_MODULE);
  const response = new Response(JSON.stringify({ count: 74 }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      etag: '"abc"',
      date: 'Mon, 10 Aug 2026 14:21:16 GMT',
    },
  });
  const result = await readBoundedJsonResponse(response, { timeoutMs: 100 });
  assert.deepEqual(result.body, { count: 74 });
  assert.equal(result.bytes.toString('utf8'), '{"count":74}');
  assert.equal(result.metadata.etag, '"abc"');
  assert.equal(result.metadata.last_modified, null);
  assert.equal(result.metadata.http_status, 200);
});

test('redirect, non-JSON, HTTP error, oversize, and timeout responses fail closed without body disclosure', async () => {
  const { readBoundedJsonResponse } = await import(ADAPTER_MODULE);
  await assert.rejects(
    readBoundedJsonResponse(new Response('', { status: 302, headers: { location: 'https://attacker.example' } })),
    /CANA_LIVE_REALITY_REDIRECT_REFUSED/,
  );
  await assert.rejects(
    readBoundedJsonResponse(new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } })),
    /CANA_LIVE_REALITY_CONTENT_TYPE_REFUSED/,
  );
  await assert.rejects(
    readBoundedJsonResponse(new Response('top-secret-body', { status: 500, headers: { 'content-type': 'application\/json' } })),
    (error) => error.code === 'CANA_LIVE_REALITY_HTTP_ERROR' && !error.message.includes('top-secret-body'),
  );
  await assert.rejects(
    readBoundedJsonResponse(new Response('', { status: 429, headers: { 'retry-after': '120' } })),
    (error) => error.code === 'CANA_LIVE_REALITY_RATE_LIMITED' && error.retryAfterMs === 120_000,
  );
  await assert.rejects(
    readBoundedJsonResponse(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '2097153' },
    })),
    /CANA_LIVE_REALITY_RESPONSE_OVERSIZE/,
  );
  const streamed = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(40));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    readBoundedJsonResponse(streamed, { maxBytes: 64 }),
    /CANA_LIVE_REALITY_RESPONSE_OVERSIZE/,
  );
  const stalled = new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    readBoundedJsonResponse(stalled, { timeoutMs: 20 }),
    /CANA_LIVE_REALITY_RESPONSE_TIMEOUT/,
  );
});
