import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MARKET_CONTRACT_REGISTRY,
  marketContractForSourceKey,
} from '../src/lib/reality/market-contract-registry.mjs';
import {
  ABCA_LIVE_CONTRACT,
  ABCA_LIVE_CONTRACT_DIGEST,
} from '../src/lib/reality/live-abca-adapter.mjs';
import {
  VA_CCA_LIVE_CONTRACT,
  VA_CCA_LIVE_CONTRACT_DIGEST,
} from '../src/lib/reality/live-va-cca-adapter.mjs';
import {
  MD_MCA_LIVE_CONTRACT,
  MD_MCA_LIVE_CONTRACT_DIGEST,
} from '../src/lib/reality/live-md-mca-adapter.mjs';

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

test('registry admits exactly the three adapter-defined market contracts', () => {
  assert.equal(MARKET_CONTRACT_REGISTRY.length, 3);
  const markets = MARKET_CONTRACT_REGISTRY.map((entry) => entry.market_id).sort();
  assert.deepEqual(markets, ['US-DC', 'US-MD', 'US-VA']);
  const keys = MARKET_CONTRACT_REGISTRY.map((entry) => entry.source_key);
  assert.equal(new Set(keys).size, keys.length, 'source keys are unique');
});

test('every registry digest is the canonical digest of its frozen contract', () => {
  const dc = marketContractForSourceKey(ABCA_LIVE_CONTRACT.sourceKey);
  assert.equal(dc.contract_digest, ABCA_LIVE_CONTRACT_DIGEST);
  assert.equal(dc.contract_digest, sha256(canonicalJson(ABCA_LIVE_CONTRACT)));
  const va = marketContractForSourceKey(VA_CCA_LIVE_CONTRACT.sourceKey);
  assert.equal(va.contract_digest, VA_CCA_LIVE_CONTRACT_DIGEST);
  assert.equal(va.contract_digest, sha256(canonicalJson(VA_CCA_LIVE_CONTRACT)));
  const md = marketContractForSourceKey(MD_MCA_LIVE_CONTRACT.sourceKey);
  assert.equal(md.contract_digest, MD_MCA_LIVE_CONTRACT_DIGEST);
  assert.equal(md.contract_digest, sha256(canonicalJson(MD_MCA_LIVE_CONTRACT)));
});

test('registry lookups preserve exact ABCA identity (backward compatibility law)', () => {
  const dc = marketContractForSourceKey(ABCA_LIVE_CONTRACT.sourceKey);
  assert.equal(dc.source_key, ABCA_LIVE_CONTRACT.sourceKey);
  assert.equal(dc.source_id, ABCA_LIVE_CONTRACT.sourceId);
  assert.equal(dc.source_url, ABCA_LIVE_CONTRACT.layerUrl);
});

test('unregistered source keys resolve to null — refusal, never fallback', () => {
  assert.equal(marketContractForSourceKey('attacker-source'), null);
  assert.equal(marketContractForSourceKey(''), null);
  assert.equal(marketContractForSourceKey(undefined), null);
  assert.equal(marketContractForSourceKey(null), null);
});

test('registry and entries are frozen', () => {
  assert.throws(() => {
    MARKET_CONTRACT_REGISTRY.push({ market_id: 'US-FAKE' });
  });
  assert.throws(() => {
    marketContractForSourceKey(ABCA_LIVE_CONTRACT.sourceKey).contract_digest = 'f'.repeat(64);
  });
});
