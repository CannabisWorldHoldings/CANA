// SENTINEL BRIDGE — composes the existing Competitor Shadow Engine
// (apps/web/scripts/competitor-shadow.mjs) into the canonical signal-to-fix
// court, so every detected competitor drift becomes a governed, receipted
// growth candidate instead of an unnoticed change.
//
// Pure module: no network, no filesystem, no new truth store. The shadow
// engine keeps its own honesty rails (public robots-permitted surfaces,
// fingerprints not archives, one GET per surface); this bridge only converts
// its delta report into ChangeEvents + Candidates through the canonical court.
// Triage stays a decision for the owner/loop: ADOPT-BETTER | COUNTER |
// IGNORE | ESCALATE — nothing here self-authorizes a response.
import { makeCandidate, makeChangeEvent } from '../../skills-src/cana-signal-to-fix.mjs';

const clip = (value) => JSON.stringify(value ?? null).slice(0, 80);

/** One shadow delta → one canonical ChangeEvent (deterministic id). */
export function deltaToChangeEvent(delta, { observedAt, reportRef }) {
  const [competitor, ...rest] = String(delta?.key ?? '').split(':');
  return makeChangeEvent({
    source: competitor || 'unknown-competitor',
    surface: rest.join(':') || '/',
    kind: 'STRUCTURAL',
    observedAt,
    observation: `${delta?.change ?? 'unknown-change'}: ${clip(delta?.before)} -> ${clip(delta?.after)}`,
    evidenceRef: reportRef,
    confidence: 0.9,
  });
}

/**
 * Full report → triage-ready proposals. Invalid events are skipped with a
 * reason (never silently), and every candidate carries the falsification
 * test + rollback the promotion court requires.
 */
export function compileSentinelProposals(deltas, { observedAt, reportRef }) {
  const proposals = [];
  const skipped = [];
  for (const delta of Array.isArray(deltas) ? deltas : []) {
    if (!delta || typeof delta !== 'object' || typeof delta.key !== 'string' || !delta.key.trim()
        || typeof delta.change !== 'string' || !delta.change.trim()) {
      skipped.push({ key: (delta && typeof delta === 'object' ? delta.key ?? null : null), errors: ['delta must be an object with non-blank key and change from the shadow report'] });
      continue;
    }
    const event = deltaToChangeEvent(delta, { observedAt, reportRef });
    if (!event.valid) {
      skipped.push({ key: delta?.key ?? null, errors: event.errors });
      continue;
    }
    const candidate = makeCandidate({
      event,
      brittlePoint: 'assumption that our current surface already answers this competitor move',
      hypothesis: `triage of ${delta.key} (${delta.change}) yields ADOPT-BETTER, COUNTER, or IGNORE with named deltas`,
      improvement: 'a triaged, receipted competitive response instead of an unnoticed drift',
      falsificationTest: 'triage records IGNORE with reason, or an adopted response fails its own court',
      rollback: 'discard the candidate; the observation chain retains the drift evidence',
      outcomeMetric: 'triage decision recorded with receipt',
      plane: 'COMPETITIVE_SENTINEL',
    });
    proposals.push({
      key: delta.key,
      change: delta.change,
      triage: 'TRIAGE_REQUIRED',
      event_id: event.event_id,
      candidate_id: candidate.candidate_id,
      candidate,
    });
  }
  return { proposals, skipped };
}
