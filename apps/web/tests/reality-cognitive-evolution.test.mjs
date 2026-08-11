import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let reality;
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

before(async () => {
  try {
    reality = await import('../src/lib/reality/reality-compiler.mjs');
  } catch (error) {
    assert.fail(`Cognitive reflection receipt is not implemented: ${error.message}`);
  }
});

const episode = {
  episode_id: 'phase-b-fixture-1',
  source_snapshot_sha256: 'a'.repeat(64),
  belief_before: 'Trade-name similarity might be sufficient for identity.',
  observed_result: {
    exact_matches: 1,
    ambiguous_matches: 1,
    false_automatic_links: 0,
  },
  bottleneck: 'ENTITY_RESOLUTION_FAILURE',
  causal_mechanism: 'Loose names collide across sovereign businesses.',
};

test('reflection is hash-bound, bounded, and never self-promotes', () => {
  const first = reality.reflectVerificationEpisode(episode);
  const second = reality.reflectVerificationEpisode(episode);

  assert.equal(first.receipt_sha256, second.receipt_sha256);
  assert.equal(first.state, 'REFLECTION_ONLY');
  assert.equal(first.value_state, 'VALUE_NOT_ESTABLISHED');
  assert.equal(first.cognitive_mutations_promoted, 0);
  assert.equal(first.next_action, 'OWNER_REVIEW');
  assert.deepEqual(first.promotion_evidence_required, [
    'FROZEN_PARENT',
    'HIDDEN_HOLDOUT',
    'ADVERSARIAL_COURT',
    'NEGATIVE_TRANSFER',
    'INDEPENDENT_VERIFICATION',
    'LATER_RETRIEVAL',
  ]);
  assert.equal(Object.isFrozen(first.observed_result), true);
  episode.observed_result.false_automatic_links = 7;
  assert.equal(first.observed_result.false_automatic_links, 0);
  episode.observed_result.false_automatic_links = 0;
});

test('changed evidence changes the receipt and unsupported promotion is refused', () => {
  const original = reality.reflectVerificationEpisode(episode);
  const changed = reality.reflectVerificationEpisode({
    ...episode,
    observed_result: { ...episode.observed_result, false_automatic_links: 1 },
  });
  assert.notEqual(original.receipt_sha256, changed.receipt_sha256);
  assert.throws(
    () => reality.reflectVerificationEpisode({ ...episode, promote: true }),
    /COGNITIVE_PROMOTION_REQUIRES_COMPARABLE_PROOF/,
  );
});

test('Slice 2 acquisition reflection is deterministic, committed, zero-effect, and REFLECTION_ONLY', () => {
  const script = path.join(WEB, 'scripts', 'replay-live-reality-benchmark.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: path.resolve(WEB, '..', '..'),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, COGNITIVE_PROMOTIONS: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  const committed = JSON.parse(fs.readFileSync(
    path.join(WEB, '..', '..', 'docs', 'evidence', 'phase-b-slice2', 'REALITY_ACQUISITION_BENCHMARK.json'),
    'utf8',
  ));
  assert.deepEqual(observed, committed);
  assert.equal(observed.cognitive_evolution.state, 'REFLECTION_ONLY');
  assert.equal(observed.cognitive_evolution.value_state, 'VALUE_NOT_ESTABLISHED');
  assert.equal(observed.cognitive_evolution.cognitive_mutations_promoted, 0);
  assert.equal(observed.cognitive_evolution.next_action, 'OWNER_REVIEW');
  assert.deepEqual(observed.effects, {
    network_live_source_calls: 0,
    provider_calls: 0,
    paid_calls: 0,
    spend_cents: 0,
    publish_actions: 0,
    production_mutations: 0,
    deployments: 0,
    cognitive_promotions: 0,
  });
});

test('Slice 2 benchmark refuses any cognitive promotion configuration', () => {
  const result = spawnSync(process.execPath, [path.join(WEB, 'scripts', 'replay-live-reality-benchmark.mjs')], {
    cwd: path.resolve(WEB, '..', '..'),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, COGNITIVE_PROMOTIONS: '1' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CANA_SLICE2_COGNITIVE_PROMOTIONS_REFUSED/);
});
