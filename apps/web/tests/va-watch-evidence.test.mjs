import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createWatchObservation,
  compileWatchEvent,
  appendWatchEvent,
  WATCH_GENESIS_DIGEST,
} from '../src/lib/markets/va/va-watch-evidence.mjs';

const digestOf = (s) => createHash('sha256').update(s).digest('hex');
const T0 = '2026-08-12T12:00:00.000Z';
const T1 = '2026-08-13T12:00:00.000Z';

function observation(overrides = {}) {
  return createWatchObservation({
    targetId: 'va-townhall-board-162',
    url: 'https://townhall.virginia.gov/L/Meetings.cfm?BoardID=162',
    fetchedAt: T0,
    contentSha256: digestOf('page-v1'),
    ...overrides,
  });
}

test('observation change detection: first / unchanged / changed', () => {
  assert.equal(observation().change, 'FIRST_OBSERVATION');
  assert.equal(observation({ previousSha256: digestOf('page-v1') }).change, 'UNCHANGED');
  assert.equal(observation({ previousSha256: digestOf('page-v0') }).change, 'CHANGED');
});

test('observation refuses non-https, missing digests, invalid times', () => {
  assert.throws(() => createWatchObservation({ targetId: 'x', url: 'http://x', fetchedAt: T0, contentSha256: digestOf('a') }));
  assert.throws(() => createWatchObservation({ targetId: 'x', url: 'https://x', fetchedAt: T0, contentSha256: 'short' }));
  assert.throws(() => createWatchObservation({ targetId: 'x', url: 'https://x', fetchedAt: 'nope', contentSha256: digestOf('a') }));
});

test('watch event: OBSERVE_ONLY, owner authority always required, deadline never guessed', () => {
  const event = compileWatchEvent({ observation: observation(), signal: 'RULEMAKING' });
  assert.equal(event.observe_only, true);
  assert.equal(event.owner_authority_required, true);
  assert.equal(event.market_impact, 'PUBLIC_COMMENT_WINDOW_MAY_BE_OPENING');
  assert.deepEqual(event.deadline, { state: 'UNKNOWN' });
  assert.match(event.event_digest, /^[0-9a-f]{64}$/);
  assert.equal(event.previous_event_digest, WATCH_GENESIS_DIGEST);
});

test('watch event: deadline accepted only as cited countdown fact', () => {
  const cited = compileWatchEvent({
    observation: observation(),
    signal: 'APPLICATION_WINDOW',
    deadline: { date: '2027-02-01', citation: 'https://www.cca.virginia.gov/retailmarijuanamarket' },
  });
  assert.deepEqual(cited.deadline, {
    state: 'KNOWN',
    date: '2027-02-01',
    citation: 'https://www.cca.virginia.gov/retailmarijuanamarket',
  });
  assert.throws(() =>
    compileWatchEvent({ observation: observation(), signal: 'APPLICATION_WINDOW', deadline: { date: 'soon' } }),
  );
});

test('watch event: unknown signal classes are refused, not improvised', () => {
  assert.throws(() => compileWatchEvent({ observation: observation(), signal: 'VIBES' }));
});

test('chain law: linkage, tamper evidence, time monotonicity', () => {
  const e1 = compileWatchEvent({ observation: observation(), signal: 'BOARD_MEETING' });
  let chain = appendWatchEvent([], e1);
  const e2 = compileWatchEvent({
    observation: observation({ fetchedAt: T1, previousSha256: digestOf('page-v1'), contentSha256: digestOf('page-v2') }),
    signal: 'REGULATOR_ANNOUNCEMENT',
    previousEventDigest: e1.event_digest,
  });
  chain = appendWatchEvent(chain, e2);
  assert.equal(chain.length, 2);

  // broken linkage
  const orphan = compileWatchEvent({ observation: observation({ fetchedAt: T1 }), signal: 'BOARD_MEETING' });
  assert.throws(() => appendWatchEvent(chain, orphan), /linkage/);

  // tampering flips the digest check
  const tampered = { ...e2, market_impact: 'EVERYTHING_IS_FINE' };
  assert.throws(() => appendWatchEvent([e1], tampered), /tamper/);

  // time reversal refused
  const backwards = compileWatchEvent({
    observation: observation({ fetchedAt: T0 }),
    signal: 'BOARD_MEETING',
    previousEventDigest: e2.event_digest,
  });
  assert.throws(() => appendWatchEvent(chain, backwards), /time reversed/);
});

test('registry-change doctrine binds the loud-change law', () => {
  const event = compileWatchEvent({
    observation: observation({ targetId: 'va-cca-dispensaries-diff', url: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries' }),
    signal: 'REGISTRY_CHANGE',
  });
  assert.match(event.recommended_action, /fixture and pinned counts in the same commit/);
});
