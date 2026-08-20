#!/usr/bin/env node
// VICTORY BOARD — the court behind constitutional law 40 (Amendment 1).
//
// The Total Victory Supremacy Law demands winning on every dimension that
// matters. This court makes that ambition honest: a dimension may claim
// MATCH or SURPASS only with evidence refs; a confirmed gap must carry a
// next strike; a dimension the system has not entered must name its gate;
// and the board is STRUCTURALLY incapable of claiming permanent victory —
// the court refuses the flag outright. Gaps compile into the flywheel's
// owner-gated lane, so the victory queue is carried by the metabolism, not
// by anyone's memory.
//
// State vocabulary (comparative claims need comparative evidence):
//   SURPASS_EVIDENCED  we beat the named best alternative — evidence refs required
//   MATCH_EVIDENCED    we match it — evidence refs required
//   RECEIPTED          we hold receipts for this capability; no comparative claim
//   GAP_CONFIRMED      evidence says we are behind or missing — next_strike required
//   NOT_ENTERED        pre-launch / gated — the gate must be named
//   UNKNOWN            no evidence either way; honest default
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const text = (v) => typeof v === 'string' && v.trim() !== '';

export class VictoryBoardError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'VictoryBoardError'; this.code = code; }
}
const refuse = (code, msg) => { throw new VictoryBoardError(code, msg); };

export const BOARD_STATES = Object.freeze([
  'SURPASS_EVIDENCED', 'MATCH_EVIDENCED', 'RECEIPTED', 'GAP_CONFIRMED', 'NOT_ENTERED', 'UNKNOWN',
]);
export const POSTURES = Object.freeze(['OWN', 'BUILD', 'INTEGRATE', 'ABSTRACT', 'REDEFINE', 'WATCH', 'KILL']);

const hasEvidence = (e) => Array.isArray(e) && e.length > 0 && e.every((x) => text(x?.observation) && text(x?.ref));

/** Fail-closed board validation — the supremacy court. */
export function validateBoard(board) {
  if (!board || typeof board !== 'object') refuse('BOARD_ABSENT', 'a board object is required');
  if (board.claims_permanent_victory === true) {
    refuse('PERMANENT_VICTORY_REFUSED', 'the board is structurally incapable of claiming permanent victory — engineer continuous advantage');
  }
  if (!Array.isArray(board.dimensions) || board.dimensions.length === 0) refuse('BOARD_EMPTY', 'a board without dimensions tracks nothing');
  const seen = new Set();
  for (const d of board.dimensions) {
    if (!text(d?.dimension)) refuse('DIMENSION_INVALID', 'every row needs a dimension name');
    if (seen.has(d.dimension)) refuse('DIMENSION_DUPLICATE', `dimension ${d.dimension} appears twice — one truth per dimension`);
    seen.add(d.dimension);
    if (!BOARD_STATES.includes(d.state)) refuse('STATE_INVALID', `${d.dimension}: state must be one of ${BOARD_STATES.join('|')}`);
    if (!POSTURES.includes(d.posture)) refuse('POSTURE_INVALID', `${d.dimension}: posture must be one of ${POSTURES.join('|')}`);
    if (!text(d.last_verified_at) || Number.isNaN(Date.parse(d.last_verified_at))) refuse('STALE_UNKNOWN', `${d.dimension}: last_verified_at required — an undated claim is a rumor`);
    if ((d.state === 'SURPASS_EVIDENCED' || d.state === 'MATCH_EVIDENCED') && !hasEvidence(d.evidence)) {
      refuse('SUPREMACY_UNEVIDENCED', `${d.dimension}: a ${d.state} claim without evidence refs is self-congratulation, not victory`);
    }
    if (d.state === 'RECEIPTED' && !hasEvidence(d.evidence)) {
      refuse('RECEIPT_ABSENT', `${d.dimension}: RECEIPTED means receipts exist — attach them`);
    }
    if (d.state === 'GAP_CONFIRMED' && !text(d.next_strike)) {
      refuse('GAP_WITHOUT_STRIKE', `${d.dimension}: a confirmed gap without a next strike is a shrug, not a plan`);
    }
    if (d.state === 'NOT_ENTERED' && !text(d.gate)) {
      refuse('GATE_UNNAMED', `${d.dimension}: NOT_ENTERED must name its gate (owner decision, environment, prerequisite)`);
    }
  }
  return true;
}

/** Verdict: validity + gap census + staleness (rows older than maxAgeDays). */
export function boardVerdict(board, { now = new Date(), maxAgeDays = 30 } = {}) {
  validateBoard(board);
  const stale = board.dimensions.filter((d) => (now.getTime() - Date.parse(d.last_verified_at)) > maxAgeDays * 86400000);
  return {
    valid: true,
    dimensions: board.dimensions.length,
    surpass_claims: board.dimensions.filter((d) => d.state === 'SURPASS_EVIDENCED').length,
    match_claims: board.dimensions.filter((d) => d.state === 'MATCH_EVIDENCED').length,
    receipted: board.dimensions.filter((d) => d.state === 'RECEIPTED').length,
    gaps: board.dimensions.filter((d) => d.state === 'GAP_CONFIRMED').length,
    not_entered: board.dimensions.filter((d) => d.state === 'NOT_ENTERED').length,
    unknown: board.dimensions.filter((d) => d.state === 'UNKNOWN').length,
    stale: stale.map((d) => d.dimension),
  };
}

/** Gaps and gated dimensions compile into the flywheel's owner-gated lane. */
export function gapsAsOwnerQueue(board) {
  validateBoard(board);
  return board.dimensions
    .filter((d) => d.state === 'GAP_CONFIRMED' || d.state === 'NOT_ENTERED')
    .map((d) => ({
      lane: 'OWNER_GATED',
      kind: 'VICTORY_GAP',
      dimension: d.dimension,
      state: d.state,
      posture: d.posture,
      action: d.state === 'GAP_CONFIRMED' ? d.next_strike : `gated: ${d.gate}`,
    }));
}

export function loadBoard(filePath) {
  const board = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateBoard(board);
  return board;
}

// CLI: node tools/vanguard/victory-board.mjs [--file=path] — exit 0 iff the board holds court.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const file = fileArg ? path.resolve(fileArg.slice(7)) : path.join(ROOT, 'docs', 'vanguard', 'VICTORY_BOARD.json');
  try {
    const board = loadBoard(file);
    const verdict = boardVerdict(board);
    console.log(JSON.stringify({ ...verdict, owner_queue: gapsAsOwnerQueue(board).length }, null, 2));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ valid: false, refusal: err.message }));
    process.exit(1);
  }
}
