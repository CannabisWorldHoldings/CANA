#!/usr/bin/env node
// THE GOVERNOR — the non-stop intelligence loop, running in-environment.
//
// No cron, no scheduler, no waiting: a resident process that runs the full
// governed metabolism on an interval for as long as the environment lives:
//
//   PULSE = custody sweep → flywheel cycle (sense; contest under the sealed
//   judge if a real signal exists) → forecast watch (overdue flagged, never
//   fabricated) → TTRL → cockpit rebuild → chained pulse receipt.
//
// Honest architecture: this daemon GOVERNS non-stop — it senses, verifies,
// forecasts, measures, and queues. It does not author code or contact the
// world; proposals wait in the owner queue and the allocator's ranking for
// the proposing brain. Owner gates hold absolutely: local-only, no network
// actions, no sends, no spend. Pulse receipts are custody-grade rows in the
// flywheel directory, so the sweep and the sealed judge audit the governor
// itself.
//
//   node tools/vanguard/governor.mjs --once            one pulse
//   node tools/vanguard/governor.mjs --interval 1200   resident, every 20m
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlywheelStore } from '../alive-loop/flywheel.mjs';
import { ForecastLedger } from '../alive-loop/forecast-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = path.join(ROOT, '.cana-local');
const pulseStore = new FlywheelStore(path.join(LOCAL, 'flywheel', 'governor.jsonl'));

const runNode = (args, timeout = 600000) => {
  const p = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', timeout });
  let parsed = null;
  const raw = (p.stdout || '').trim();
  try { parsed = JSON.parse(raw); }                                  // whole-output JSON (pretty or compact)
  catch { try { parsed = JSON.parse(raw.split('\n').pop()); } catch { /* raw stays null */ } }
  return { status: p.status, out: parsed };
};

export function pulse(n) {
  const startedAt = new Date().toISOString();
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

  // 1) custody sweep — strict expected; a broken chain is CRITICAL and is
  //    reported exactly as found (quarantines are automatic, never repaired).
  const sw = runNode(['tools/alive-loop/custody-sweep.mjs'], 120000);
  const strict = sw.out?.strict === true;

  // 2) flywheel cycle — steady state is a healthy heartbeat; a real signal
  //    triggers the governed contest under the sealed judge.
  const day = new Date().toISOString().slice(0, 10);
  const fw = runNode(['tools/alive-loop/flywheel.mjs', '--mission-id', `governor-${day}-p${n}`], 600000);

  // 3) forecast watch — overdue means "awaiting reality", never auto-resolved.
  const pending = new ForecastLedger(path.join(LOCAL, 'forecasts', 'ledger.jsonl')).pending();
  const overdue = pending.filter(p => p.overdue).map(p => p.forecast_id);

  // 4) TTRL — learning velocity, measured not asserted.
  const ttrl = runNode(['tools/vanguard/ttrl.mjs'], 60000);

  // 5) cockpit rebuild — the owner's god's-eye view stays current.
  const cockpit = runNode(['tools/vanguard/cockpit.mjs'], 120000);

  const payload = {
    pulse: n, started_at: startedAt, head,
    custody_strict: strict,
    cycle: fw.out ? { id: fw.out.cycle_id, result: fw.out.result, chain_rows: fw.out.chain?.count } : { error: `flywheel exit ${fw.status}` },
    forecasts: { pending: pending.length, overdue },
    ttrl: ttrl.out?.mean_ttrl ?? null,
    owner_gated: fw.out?.owner_gated ?? null,
    cockpit_built: cockpit.status === 0,
  };
  const row = pulseStore.append('GOVERNOR_PULSE', `gov_${day}_p${n}`, payload);
  console.log(JSON.stringify({ seq: row.seq, ...payload }));
  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  const iArg = process.argv.find(a => a.startsWith('--interval'));
  const interval = iArg ? Number(process.argv[process.argv.indexOf(iArg) + 1] || iArg.split('=')[1]) || 1200 : 1200;
  let n = pulseStore.records().filter(r => r.kind === 'GOVERNOR_PULSE').length + 1;
  const beat = () => { try { pulse(n); } catch (e) { console.error(`PULSE_${n}_FAILED: ${e.message}`); } n += 1; };
  beat();
  if (!once) {
    console.log(`governor resident: pulsing every ${interval}s — sense · verify · forecast · queue. Owner gates absolute.`);
    setInterval(beat, interval * 1000);
  }
}
