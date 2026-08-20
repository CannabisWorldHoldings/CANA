// VICTORY BOARD courts — supremacy claims need evidence, gaps need strikes,
// gates need names, and permanent victory is structurally impossible.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boardVerdict, gapsAsOwnerQueue, loadBoard, validateBoard,
} from './victory-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const row = (over = {}) => ({
  dimension: 'test_dim', state: 'UNKNOWN', posture: 'WATCH', last_verified_at: '2026-08-18', ...over,
});
const board = (rows, over = {}) => ({ claims_permanent_victory: false, dimensions: rows, ...over });
const evidence = [{ observation: 'a receipted fact', ref: 'receipts/x.json' }];

test('PERMANENT VICTORY is refused structurally — the flag itself cannot pass court', () => {
  assert.throws(() => validateBoard(board([row()], { claims_permanent_victory: true })), /PERMANENT_VICTORY_REFUSED/);
});

test('supremacy claims are evidence-gated; receipted states demand receipts', () => {
  assert.throws(() => validateBoard(board([row({ state: 'SURPASS_EVIDENCED' })])), /SUPREMACY_UNEVIDENCED/);
  assert.throws(() => validateBoard(board([row({ state: 'MATCH_EVIDENCED', evidence: [] })])), /SUPREMACY_UNEVIDENCED/);
  assert.throws(() => validateBoard(board([row({ state: 'RECEIPTED' })])), /RECEIPT_ABSENT/);
  assert.equal(validateBoard(board([row({ state: 'SURPASS_EVIDENCED', evidence })])), true);
});

test('a confirmed gap without a next strike is refused; NOT_ENTERED must name its gate', () => {
  assert.throws(() => validateBoard(board([row({ state: 'GAP_CONFIRMED', evidence })])), /GAP_WITHOUT_STRIKE/);
  assert.throws(() => validateBoard(board([row({ state: 'NOT_ENTERED' })])), /GATE_UNNAMED/);
  assert.equal(validateBoard(board([row({ state: 'GAP_CONFIRMED', evidence, next_strike: 'build it' })])), true);
  assert.equal(validateBoard(board([row({ state: 'NOT_ENTERED', gate: 'owner decision' })])), true);
});

test('undated claims, duplicate dimensions, and unknown states/postures are refused', () => {
  assert.throws(() => validateBoard(board([row({ last_verified_at: '' })])), /STALE_UNKNOWN/);
  assert.throws(() => validateBoard(board([row(), row()])), /DIMENSION_DUPLICATE/);
  assert.throws(() => validateBoard(board([row({ state: 'WINNING_BIGLY' })])), /STATE_INVALID/);
  assert.throws(() => validateBoard(board([row({ posture: 'VIBES' })])), /POSTURE_INVALID/);
});

test('gaps and gated dimensions compile into the owner-gated lane — the victory queue rides the metabolism', () => {
  const b = board([
    row({ dimension: 'a', state: 'GAP_CONFIRMED', evidence, next_strike: 'strike a' }),
    row({ dimension: 'b', state: 'NOT_ENTERED', gate: 'owner decision b' }),
    row({ dimension: 'c', state: 'RECEIPTED', evidence }),
  ]);
  const queue = gapsAsOwnerQueue(b);
  assert.equal(queue.length, 2);
  assert.ok(queue.every((q) => q.lane === 'OWNER_GATED' && q.kind === 'VICTORY_GAP'));
  assert.equal(queue.find((q) => q.dimension === 'a').action, 'strike a');
  assert.match(queue.find((q) => q.dimension === 'b').action, /gated: owner decision b/);
});

test('the LIVE board holds court: valid, zero unearned supremacy claims, every gap armed', () => {
  const live = loadBoard(path.join(ROOT, 'docs', 'vanguard', 'VICTORY_BOARD.json'));
  const verdict = boardVerdict(live, { now: new Date('2026-08-18T12:00:00Z') });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.surpass_claims, 0, 'no comparative supremacy has been earned yet — the board says so');
  assert.ok(verdict.receipted >= 5, 'substrate dimensions carry receipts');
  assert.ok(verdict.gaps + verdict.not_entered >= 5, 'the fight not yet entered is stated, not hidden');
  assert.equal(verdict.stale.length, 0);
  assert.ok(gapsAsOwnerQueue(live).length >= 5, 'the owner queue carries the victory gaps');
});
