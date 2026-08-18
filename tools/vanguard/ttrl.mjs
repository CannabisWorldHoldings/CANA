#!/usr/bin/env node
// TTRL — TIME TO REALITY-VALIDATED LEARNING (constitution law 38, measured).
//
// "Learning velocity is a target variable" was DECLARED; this makes it
// MEASURED. TTRL reads the flywheel's own hash-chained rows — never
// self-reported numbers — and computes, per completed learning event:
//
//   SIGNAL → JUDGE → SENSE → SELECT → FORECAST → EXECUTE → CONFIRM →
//   ADMIT/REJECT → RESOLVE
//
// stage latencies, the end-to-end signal→memory span, and the BOTTLENECK
// stage (the largest inter-stage gap). Steady-state cycles are heartbeats,
// not learning events — counted separately, never averaged in to flatter
// the number. External pre-cycle events (e.g. a detection receipt sealed
// before the cycle opened) merge in as labeled markers so the true
// detect→lesson span is measured, not the flattering in-cycle subset.
//
// The point (external red-team, 2026-08-18): once latency is measured per
// stage, the real constraint surfaces — and it is usually not intelligence,
// it is feedback latency. Then you design around the truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class TtrlError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'TtrlError'; this.code = code; }
}

const LEARNING_TERMINALS = new Set(['ADMITTED', 'REJECTED']);

/** Analyze flywheel rows (parsed JSONL) + optional external markers. */
export function analyzeTtrl(rows, { externalEvents = [] } = {}) {
  if (!Array.isArray(rows)) throw new TtrlError('ROWS_REQUIRED', 'pass the parsed flywheel rows');
  const byCycle = new Map();
  for (const r of rows) {
    if (!byCycle.has(r.cycle_id)) byCycle.set(r.cycle_id, []);
    byCycle.get(r.cycle_id).push(r);
  }

  const cycles = [];
  let heartbeats = 0;
  for (const [cycleId, cycleRows] of byCycle) {
    const ordered = [...cycleRows].sort((a, b) => a.seq - b.seq);
    const kinds = ordered.map((r) => r.kind);
    if (kinds.includes('STEADY_STATE')) { heartbeats += 1; continue; }
    const terminal = ordered.find((r) => LEARNING_TERMINALS.has(r.kind));
    if (!terminal) continue; // incomplete cycle — reported by absence, never guessed

    const stages = [];
    let bottleneck = { gap_ms: -1 };
    for (let i = 1; i < ordered.length; i += 1) {
      const gap = Date.parse(ordered[i].at) - Date.parse(ordered[i - 1].at);
      const stage = { from: ordered[i - 1].kind, to: ordered[i].kind, ms: gap };
      stages.push(stage);
      if (gap > bottleneck.gap_ms) bottleneck = { stage: `${stage.from}→${stage.to}`, gap_ms: gap };
    }
    const open = ordered.find((r) => r.kind === 'CYCLE_OPEN');
    const inCycleMs = Date.parse(terminal.at) - Date.parse(open.at);

    // Merge external markers that precede this cycle (true detect→lesson span).
    const priorEvents = externalEvents
      .filter((e) => Date.parse(e.at) <= Date.parse(terminal.at))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const signalAt = priorEvents.length > 0 ? priorEvents[0] : null;
    cycles.push({
      cycle_id: cycleId,
      outcome: terminal.kind,
      in_cycle_ms: inCycleMs,
      ttrl_ms: signalAt ? Date.parse(terminal.at) - Date.parse(signalAt.at) : inCycleMs,
      ttrl_basis: signalAt ? `external marker "${signalAt.label}" → ${terminal.kind}` : `CYCLE_OPEN → ${terminal.kind} (no external marker supplied)`,
      bottleneck,
      stages,
    });
  }

  const learning = cycles.filter((c) => c.outcome === 'ADMITTED');
  return {
    learning_events: cycles.length,
    admitted: learning.length,
    heartbeats,
    mean_ttrl_ms: learning.length ? Math.round(learning.reduce((s, c) => s + c.ttrl_ms, 0) / learning.length) : null,
    note: learning.length === 0 ? 'no admitted learning events — no velocity claims permitted' : undefined,
    cycles,
  };
}

export const human = (ms) => (ms == null ? null : ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

// CLI: node tools/vanguard/ttrl.mjs [--flywheel=path] [--event label=ISO ...]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fileArg = process.argv.find((a) => a.startsWith('--flywheel='));
  const file = fileArg ? path.resolve(fileArg.slice(11)) : path.join(ROOT, '.cana-local', 'flywheel', 'flywheel.jsonl');
  const externalEvents = process.argv
    .filter((a) => a.startsWith('--event'))
    .map((_, i, arr) => process.argv[process.argv.indexOf(arr[i]) + 1])
    .filter(Boolean)
    .map((spec) => { const [label, at] = spec.split('='); return { label, at }; })
    .filter((e) => e.label && e.at && !Number.isNaN(Date.parse(e.at)));
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  const verdict = analyzeTtrl(rows, { externalEvents });
  console.log(JSON.stringify({
    ...verdict,
    cycles: verdict.cycles.map((c) => ({
      ...c,
      in_cycle: human(c.in_cycle_ms), ttrl: human(c.ttrl_ms),
      bottleneck: { ...c.bottleneck, gap: human(c.bottleneck.gap_ms) },
      stages: undefined,
    })),
    mean_ttrl: human(verdict.mean_ttrl_ms),
  }, null, 2));
}
