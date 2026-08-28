import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = path.join(
  ROOT,
  'docs/technical-promotion/POST_CLASS_D_REMAINING_CAPABILITY_LEDGER.jsonl',
);
const SUPERSESSION = path.join(
  ROOT,
  'docs/technical-promotion/CANONICAL_CAPABILITY_SUPERSESSION_LEDGER.md',
);
const EXPECTED_SHA = 'e0466894121a4c92f0512cfa47e649815c7a3948';
const EXPECTED_TREE = 'e9acea54e94d437c4e0728d724b3ad8ffb8661b6';
const ALLOWED_DISPOSITIONS = new Set([
  'CANONICAL',
  'SUPERSEDED',
  'REJECTED_WITH_REASON',
  'DEFERRED_WITH_REASON',
  'BOUNDED_UNKNOWN',
]);
const REQUIRED_CAPABILITIES = new Set([
  'owner_cana_console_surface',
  'owner_cana_governed_transport',
  'owner_cana_whole_system_query',
  'owner_cockpit_vanguard_cli',
  'experience_fabric_core',
  'owner_experience_web_bridge',
  'asset_registry_rights_core',
  'homepage_image_acceptance_workflow',
  'search_console_demand_sensor',
  'search_console_property_access',
  'vanguard_output_adapter_isolation',
  'vanguard_zenith_wholesale_candidate',
  'rsi_sitemind_core',
  'rsi_cross_repository_evaluation',
  'rsi_hermes_runtime_wholesale',
  'orderweeddc_rsi_standalone_runtime',
  'merchant_intelligence_core',
  'merchant_ai_tenant_productization',
  'customer_ask_world',
  'growth_intelligence_core',
  'cloudflare_edge_foundation',
  'final_nonprod_cloudflare_release',
  'live_postgis_identity',
]);
const EXACT_KEYS = [
  'schema',
  'capability_id',
  'high_value',
  'domain',
  'source',
  'current_canonical',
  'disposition',
  'reason',
  'evidence',
  'next_gate',
  'production_effects',
  'assessed_at',
  'assessed_against_sha',
  'assessed_against_tree',
].sort();

function readLedger() {
  assert.equal(fs.existsSync(LEDGER), true, 'remaining capability ledger is missing');
  return fs.readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`ledger line ${index + 1} is not JSON: ${error.message}`);
      }
    });
}

test('every required high-value mechanism has one bounded final disposition', () => {
  const entries = readLedger();
  assert.equal(entries.length, REQUIRED_CAPABILITIES.size);
  assert.deepEqual(
    new Set(entries.map((entry) => entry.capability_id)),
    REQUIRED_CAPABILITIES,
  );

  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), EXACT_KEYS, entry.capability_id);
    assert.equal(entry.schema, 'orderweeddc.post-class-d-capability.v1');
    assert.equal(entry.high_value, true);
    assert.equal(ALLOWED_DISPOSITIONS.has(entry.disposition), true, entry.capability_id);
    assert.equal(typeof entry.reason, 'string');
    assert.equal(entry.reason.length >= 24, true, entry.capability_id);
    assert.equal(Array.isArray(entry.evidence), true, entry.capability_id);
    assert.equal(entry.evidence.length > 0, true, entry.capability_id);
    assert.equal(typeof entry.next_gate, 'string', entry.capability_id);
    assert.equal(entry.production_effects, 0, entry.capability_id);
    assert.equal(entry.assessed_against_sha, EXPECTED_SHA, entry.capability_id);
    assert.equal(entry.assessed_against_tree, EXPECTED_TREE, entry.capability_id);
  }
});

test('parallel sovereign donors are rejected and bounded work stays explicit', () => {
  const byId = new Map(readLedger().map((entry) => [entry.capability_id, entry]));
  assert.equal(byId.get('rsi_sitemind_core').disposition, 'CANONICAL');
  assert.equal(byId.get('rsi_hermes_runtime_wholesale').disposition, 'REJECTED_WITH_REASON');
  assert.equal(byId.get('orderweeddc_rsi_standalone_runtime').disposition, 'REJECTED_WITH_REASON');
  assert.equal(byId.get('vanguard_zenith_wholesale_candidate').disposition, 'REJECTED_WITH_REASON');
  assert.equal(byId.get('search_console_demand_sensor').disposition, 'DEFERRED_WITH_REASON');
  assert.equal(byId.get('owner_cana_governed_transport').disposition, 'DEFERRED_WITH_REASON');
  assert.equal(byId.get('final_nonprod_cloudflare_release').disposition, 'DEFERRED_WITH_REASON');
  assert.equal(byId.get('live_postgis_identity').disposition, 'BOUNDED_UNKNOWN');
});

test('supersession ledger names every mechanism and preserves One CANA law', () => {
  assert.equal(fs.existsSync(SUPERSESSION), true, 'supersession ledger is missing');
  const markdown = fs.readFileSync(SUPERSESSION, 'utf8');
  assert.match(markdown, /ONE CANA/);
  assert.match(markdown, /ONE AUTHORITY/);
  assert.match(markdown, /ONE CANONICAL DATA MODEL/);
  for (const capability of REQUIRED_CAPABILITIES) {
    assert.equal(markdown.includes(`| \`${capability}\` |`), true, capability);
  }
  assert.doesNotMatch(markdown, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(markdown, /(?:api|oauth)[_-]?token\s*[:=]/i);
});
