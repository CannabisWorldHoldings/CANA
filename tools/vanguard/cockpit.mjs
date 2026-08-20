#!/usr/bin/env node
// THE COCKPIT — the god's-eye owner console, compiled from the live ledgers.
//
// Nothing here is asserted from memory: every number is read from a
// hash-chained ledger, a court output, or the registry at build time, and
// the page carries its generated-at stamp. Regenerate any time:
//   node tools/vanguard/cockpit.mjs [--html /path/out.html]
// The proposing brain acts; the cockpit shows; the chains prove.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweep } from '../alive-loop/custody-sweep.mjs';
import { flywheelFamily, verifyFlywheelFile } from '../alive-loop/flywheel.mjs';
import { LessonStore } from '../alive-loop/winner-memory.mjs';
import { SlowStore } from '../alive-loop/slow-memory.mjs';
import { ForecastLedger } from '../alive-loop/forecast-ledger.mjs';
import { RegretLedger } from './regret-ledger.mjs';
import { analyzeTtrl, human } from './ttrl.mjs';
import { allocate } from './allocator.mjs';
import { loadBoard, boardVerdict, gapsAsOwnerQueue } from './victory-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = path.join(ROOT, '.cana-local');
const at = new Date().toISOString();

export function compileCockpit() {
  const sw = sweep({ localDir: LOCAL, extraFamilies: [flywheelFamily()] });

  const fwPath = path.join(LOCAL, 'flywheel', 'flywheel.jsonl');
  const fwRows = fs.existsSync(fwPath) ? fs.readFileSync(fwPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const cycles = fwRows.filter(r => r.kind === 'CYCLE_OPEN').length;
  const lastClose = [...fwRows].reverse().find(r => r.kind === 'CYCLE_CLOSED');
  const ownerGatedLast = [...fwRows].reverse().find(r => r.kind === 'SENSED')?.payload?.owner_gated ?? [];
  const ttrl = analyzeTtrl(fwRows);

  const lessons = new LessonStore(path.join(LOCAL, 'winner-memory', 'lessons.jsonl'));
  const slow = new SlowStore(path.join(LOCAL, 'winner-memory', 'slow.jsonl'));
  const forecasts = new ForecastLedger(path.join(LOCAL, 'forecasts', 'ledger.jsonl'));
  const regret = new RegretLedger(path.join(LOCAL, 'regret', 'regret.jsonl'));
  const cal = forecasts.calibration();
  const pending = forecasts.pending();

  const board = loadBoard(path.join(ROOT, 'docs', 'vanguard', 'VICTORY_BOARD.json'));
  const bv = boardVerdict(board);
  const queue = gapsAsOwnerQueue(board);

  const portfolio = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'vanguard', 'portfolio.json'), 'utf8'));
  const alloc = allocate(portfolio, { slots: 2 });

  return {
    generated_at: at,
    head: fs.existsSync(path.join(ROOT, '.git')) ? require_head() : 'UNKNOWN',
    custody: { strict: sw.strict, ledgers: sw.ledgers.filter(l => !l.absent).length, families: [...new Set(sw.ledgers.map(l => l.family))].length, invalid: sw.ledgers.filter(l => !l.valid).map(l => l.path) },
    metabolism: { cycles, chain_rows: fwRows.length, chain_valid: verifyFlywheelFile(fwPath).valid, last_result: lastClose?.payload?.result ?? 'NONE' },
    learning: { fast: lessons.verifyChain().count, slow_active: slow.recall().active.length, ttrl: human(ttrl.mean_ttrl_ms), learning_events: ttrl.admitted, heartbeats: ttrl.heartbeats },
    predictions: { resolved: cal.resolved, mean_brier: cal.mean_brier, pending: pending.length, overdue: pending.filter(p => p.overdue).map(p => p.forecast_id) },
    decisions: { open: regret.open().length, total_rows: regret.verifyChain().count, open_ids: regret.open().map(d => d.chosen_action.slice(0, 60)) },
    allocation: alloc,
    board: { dims: bv.dimensions, receipted: bv.receipted, gaps: bv.gaps, not_entered: bv.not_entered, surpass_claims: bv.surpass_claims },
    owner_queue: queue,
    flywheel_owner_gated_last: ownerGatedLast.length,
  };
  function require_head() {
    try { return (0, eval)('require')('node:child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { return 'UNKNOWN'; }
  }
}

export function cockpitHTML(s) {
  const stat = (n, l, sub = '') => `<div class="c"><div class="n">${n}</div><div class="l">${l}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const ok = (b) => b ? '<span class="g">●</span>' : '<span class="r">●</span>';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ORDERWEEDDC — Owner Cockpit</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Segoe UI,Roboto,sans-serif;font-size:15px;letter-spacing:-.016em;-webkit-font-smoothing:antialiased;padding:48px 22px 80px}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:clamp(30px,4.5vw,48px);font-weight:600;letter-spacing:-.014em}
.sub{color:#a1a1a6;margin-top:8px;font-size:14px}
.stamp{display:inline-block;font-size:11px;color:#6e6e73;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:4px 12px;margin-top:16px}
h2{font-size:13px;font-weight:600;color:#ff9f0a;text-transform:uppercase;letter-spacing:.04em;margin:44px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.c{background:#1d1d1f;border-radius:16px;padding:20px}
.n{font-size:30px;font-weight:600;letter-spacing:-.012em}
.l{font-size:12.5px;color:#d2d2d7;margin-top:4px}
.s{font-size:11px;color:#6e6e73;margin-top:8px;line-height:1.6}
.g{color:#30d158}.r{color:#ff453a}.o{color:#ff9f0a}
table{width:100%;border-collapse:collapse;background:#1d1d1f;border-radius:16px;overflow:hidden}
th,td{padding:12px 14px;text-align:left;font-size:13px;border-bottom:1px solid rgba(255,255,255,.08)}
th{color:#6e6e73;font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;font-size:10.5px;font-weight:600;border-radius:6px;padding:3px 8px;background:rgba(255,159,10,.12);color:#ff9f0a}
.pill.b{background:rgba(41,151,255,.12);color:#2997ff}
.foot{margin-top:52px;font-size:11px;color:#6e6e73;line-height:1.9;border-top:1px solid rgba(255,255,255,.1);padding-top:20px}
</style></head><body><div class="wrap">
<h1>Owner Cockpit<span style="color:#6e6e73;font-weight:400"> · the machine, on the record</span></h1>
<div class="sub">Every number below is read from a hash-chained ledger or court output at generation time — never asserted from memory.</div>
<div class="stamp">Generated ${s.generated_at} · head ${s.head} · regenerate: node tools/vanguard/cockpit.mjs</div>

<h2>Custody — who watches the watchmen</h2>
<div class="grid">
${stat(`${ok(s.custody.strict)} ${s.custody.strict ? 'STRICT' : 'BROKEN'}`, 'custody verdict', s.custody.invalid.length ? 'INVALID: ' + s.custody.invalid.join(', ') : 'every verifier probed for body-mutation blindness')}
${stat(s.custody.ledgers, 'live hash-chained ledgers', `${s.custody.families} families`)}
${stat(`${ok(s.metabolism.chain_valid)} ${s.metabolism.chain_rows}`, 'flywheel chain rows', `${s.metabolism.cycles} cycles · last: ${s.metabolism.last_result}`)}
</div>

<h2>Learning — two temperatures</h2>
<div class="grid">
${stat(s.learning.fast, 'fast lessons (provisional)', 'admitted behind the blind judge')}
${stat(s.learning.slow_active, 'slow lessons (replicated)', 'promotion demands ≥2 distinct missions — honestly empty until replication')}
${stat(s.learning.ttrl ?? '—', 'signal → confirmed lesson', `${s.learning.learning_events} learning event(s) · ${s.learning.heartbeats} heartbeats`)}
</div>

<h2>Predictions — graded by reality</h2>
<div class="grid">
${stat(s.predictions.resolved, 'forecasts resolved', `mean Brier ${s.predictions.mean_brier ?? '—'}`)}
${stat(s.predictions.pending, 'pending', s.predictions.overdue.length ? `<span class="o">OVERDUE: ${s.predictions.overdue.join(', ')}</span> — awaiting reality, never fabricated` : 'none overdue')}
${stat(s.decisions.open, 'decisions open in the regret ledger', `${s.decisions.total_rows} chained rows · settled loops compute opportunity regret or say UNRESOLVED`)}
</div>

<h2>Allocation — where the next unit of effort goes (policy ${'allocator/1'})</h2>
<table><tr><th>#</th><th>Action</th><th>Score</th><th>Gate</th></tr>
${s.allocation.ranked.slice(0, 8).map(r => `<tr><td>${r.rank}</td><td>${r.action}</td><td>${r.score}</td><td>${r.blocked_by ? `<span class="pill">${r.blocked_by}</span>` : '<span class="pill b">executable</span>'}</td></tr>`).join('')}
</table>
<div class="s" style="margin-top:10px">Chosen next: ${s.allocation.chosen.join(' · ') || '—'} · gated actions are ranked but never self-chosen — the owner sees exactly what each key unlocks.</div>

<h2>Victory board — ${s.board.dims} dimensions, ${s.board.surpass_claims} unearned claims</h2>
<div class="grid">
${stat(s.board.receipted, 'locally receipted', 'leading internally; comparative supremacy NOT_ESTABLISHED until benchmarked')}
${stat(s.board.gaps, 'confirmed gaps (armed)', 'every gap carries a next strike')}
${stat(s.board.not_entered, 'not entered (gated)', 'customer value · merchant value · revenue · distribution — behind the keys')}
</div>

<h2>Owner queue — waiting on your keys</h2>
<table><tr><th>Dimension</th><th>State</th><th>Action</th></tr>
${s.owner_queue.map(q => `<tr><td>${q.dimension}</td><td><span class="pill">${q.state}</span></td><td>${q.action}</td></tr>`).join('')}
</table>

<div class="foot">ORDERWEEDDC / CANA governed intelligence substrate · branch agent/orderweeddc-sovereign-one-shot-vnext (local-only; PR #56 untouched) · owner gates: no push, no merge, no deploy, no outreach, no spend — the governor daemon senses, verifies, forecasts and queues non-stop; the proposing brain acts in conversation; the chains prove everything. DO NOT CLAIM PERMANENT VICTORY — ENGINEER CONTINUOUS ADVANTAGE.</div>
</div></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = compileCockpit();
  const htmlArg = process.argv.find(a => a.startsWith('--html='));
  const out = htmlArg ? path.resolve(htmlArg.slice(7)) : path.join(ROOT, '..', '_mission', 'OWNER_COCKPIT.html');
  fs.writeFileSync(out, cockpitHTML(s));
  console.log(JSON.stringify({ generated_at: s.generated_at, head: s.head, custody_strict: s.custody.strict, cycles: s.metabolism.cycles, chain_rows: s.metabolism.chain_rows, ttrl: s.learning.ttrl, brier: s.predictions.mean_brier, pending: s.predictions.pending, overdue: s.predictions.overdue, open_decisions: s.decisions.open, chosen_next: s.allocation.chosen, owner_queue: s.owner_queue.length, html: out }, null, 2));
}
