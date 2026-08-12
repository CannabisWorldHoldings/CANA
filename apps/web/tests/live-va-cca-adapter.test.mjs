import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  VA_CCA_LIVE_CONTRACT,
  VA_CCA_LIVE_CONTRACT_DIGEST,
  buildVaCcaRequestUrl,
  assertVaCcaLiveAcquisitionAuthority,
  createVaCcaPinnedLookup,
  readBoundedTextResponse,
  captureVaCcaReality,
} from '../src/lib/reality/live-va-cca-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.join(here, 'fixtures', 'va-cca', 'dispensaries.html'),
  'utf8',
);
const ENV_OK = { CANA_LIVE_VA_CCA_ACQUISITION: 'OPERATOR_APPROVED' };

function htmlResponse(text, status = 200) {
  return { status, text: async () => text };
}

function fetchImplReturning(...bodies) {
  let call = 0;
  const urls = [];
  const impl = async (url, init) => {
    urls.push({ url, init });
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return htmlResponse(body);
  };
  impl.urls = urls;
  return impl;
}

test('contract is frozen with a canonical 64-hex digest', () => {
  assert.match(VA_CCA_LIVE_CONTRACT_DIGEST, /^[0-9a-f]{64}$/);
  assert.equal(VA_CCA_LIVE_CONTRACT.hostname, 'www.cca.virginia.gov');
  assert.equal(VA_CCA_LIVE_CONTRACT.protocol, 'https:');
  assert.throws(() => {
    VA_CCA_LIVE_CONTRACT.pageUrl = 'https://evil.example';
  });
});

test('fixed-origin law: request overrides are refused', () => {
  assert.equal(buildVaCcaRequestUrl().toString(), VA_CCA_LIVE_CONTRACT.pageUrl);
  assert.throws(() => buildVaCcaRequestUrl({ hostname: 'evil.example' }), /OVERRIDE_REFUSED/);
});

test('operator opt-in law: acquisition without the explicit grant is refused', () => {
  assert.throws(() => assertVaCcaLiveAcquisitionAuthority({ env: {} }), /NOT_AUTHORIZED/);
  assert.throws(
    () => assertVaCcaLiveAcquisitionAuthority({ env: { CANA_LIVE_VA_CCA_ACQUISITION: 'yes' } }),
    /NOT_AUTHORIZED/,
  );
  const capability = assertVaCcaLiveAcquisitionAuthority({ env: ENV_OK });
  assert.equal(capability.authorized, true);
  assert.equal(capability.effects.truth_mutations, 0);
  assert.equal(capability.effects.production_mutations, 0);
});

test('pinned lookup refuses every hostname except the contract hostname', () => {
  const lookup = createVaCcaPinnedLookup('192.0.2.10');
  lookup('www.cca.virginia.gov', (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '192.0.2.10');
    assert.equal(family, 4);
  });
  lookup('evil.example', (error) => {
    assert.match(error.message, /HOSTNAME_REFUSED/);
  });
  assert.throws(() => createVaCcaPinnedLookup(''), /PINNED_ADDRESS_REQUIRED/);
});

test('bounded reader rejects oversize bodies', async () => {
  await assert.rejects(
    readBoundedTextResponse(htmlResponse('x'.repeat(64)), { maxBytes: 16 }),
    /RESPONSE_TOO_LARGE/,
  );
  const ok = await readBoundedTextResponse(htmlResponse('small'), { maxBytes: 16 });
  assert.equal(ok.text, 'small');
  assert.equal(ok.bytes, 5);
});

test('capture: stable double-fetch produces an immutable receipt with 23 records', async () => {
  const fetchImpl = fetchImplReturning(FIXTURE);
  const receipt = await captureVaCcaReality({ fetchImpl, env: ENV_OK });
  assert.equal(receipt.content_stability, 'CONTENT_STABLE');
  assert.equal(receipt.pre_content_sha256, receipt.post_content_sha256);
  assert.equal(receipt.record_count, 23);
  assert.equal(receipt.records.length, 23);
  assert.equal(receipt.request_digest, VA_CCA_LIVE_CONTRACT_DIGEST);
  assert.equal(receipt.adapter_contract_digest, VA_CCA_LIVE_CONTRACT_DIGEST);
  assert.match(receipt.content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.capability.effects.truth_mutations, 0);
  assert.equal(fetchImpl.urls.length, 2, 'double-fetch stability proof');
  for (const { url, init } of fetchImpl.urls) {
    assert.equal(url, VA_CCA_LIVE_CONTRACT.pageUrl);
    assert.equal(init.redirect, 'error');
  }
  assert.throws(() => {
    receipt.record_count = 0;
  });
});

test('capture: unstable content terminates without statements', async () => {
  const fetchImpl = fetchImplReturning(FIXTURE, `${FIXTURE}<!-- changed -->`);
  await assert.rejects(captureVaCcaReality({ fetchImpl, env: ENV_OK }), /CONTENT_UNSTABLE/);
});

test('capture: refusals — no authority, no fetchImpl, HTTP error, empty extraction', async () => {
  await assert.rejects(
    captureVaCcaReality({ fetchImpl: fetchImplReturning(FIXTURE), env: {} }),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(captureVaCcaReality({ env: ENV_OK }), /FETCH_IMPL_REQUIRED/);
  await assert.rejects(
    captureVaCcaReality({
      fetchImpl: async () => htmlResponse('down', 503),
      env: ENV_OK,
    }),
    /HTTP_ERROR:503/,
  );
  await assert.rejects(
    captureVaCcaReality({
      fetchImpl: fetchImplReturning('<html><body>no facilities</body></html>'),
      env: ENV_OK,
    }),
    /EXTRACTION_EMPTY/,
  );
});

test('capture: run timeout law is enforced by the injected clock', async () => {
  let now = 0;
  const clock = () => new Date((now += VA_CCA_LIVE_CONTRACT.runTimeoutMs));
  await assert.rejects(
    captureVaCcaReality({ fetchImpl: fetchImplReturning(FIXTURE), env: ENV_OK, clock }),
    /RUN_TIMEOUT/,
  );
});
