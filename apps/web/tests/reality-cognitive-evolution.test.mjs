import assert from 'node:assert/strict';
import { before, test } from 'node:test';

let reality;

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
