#!/usr/bin/env node
// CANA CONSOLE — the conversational command interface for the owner side.
//
// Hermes absorbed, not forked: the authority law (grant → seal → receipt)
// already governs every cycle via skills-src/hermes-governed-packet.mjs;
// this console gives that law a mouth and ears. Plain words in, governed
// actions out, every command a custody-grade chained receipt:
//
//   node tools/vanguard/console.mjs "what should we do next"
//   node tools/vanguard/console.mjs --repl
//
// Laws:
//   COMPILATION IS DETERMINISTIC — utterances compile by explicit intent
//     grammar, never by guessing. An unknown utterance returns UNKNOWN with
//     the nearest commands; it never "does its best".
//   OWNER GATES REFUSE BY NAME — deploy/push/merge/outreach/spend intents
//     are recognized and REFUSED with the exact key that unlocks them.
//     The console can talk about gated actions; it can never take them.
//   EVERY COMMAND IS A RECEIPT — chained rows in .cana-local/flywheel/
//     console.jsonl, audited by the custody sweep and the sealed judge.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { FlywheelStore } from '../alive-loop/flywheel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = path.join(ROOT, '.cana-local');
const store = () => new FlywheelStore(path.join(LOCAL, 'flywheel', 'console.jsonl'));

const runNode = (args, timeout = 600000) => {
  const p = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', timeout });
  const raw = (p.stdout || '').trim();
  let out = null;
  try { out = JSON.parse(raw); } catch { try { out = JSON.parse(raw.split('\n').pop()); } catch { /* null */ } }
  return { status: p.status, out, raw };
};

// ---- OWNER GATES: recognized, named, refused — never executed ----
const GATES = [
  { re: /\b(deploy|go live|production|dns|domain)\b/i, key: 'KEY 2 — Deploy', why: 'production and DNS are the owner\'s hands alone' },
  { re: /\b(push|merge|open (a )?pr|pull request)\b/i, key: 'REPO GATE', why: 'the branch is local-only by standing law; delivery is by bundle' },
  { re: /\b(outreach|contact|email|text|message) (the )?(merchant|business|dispensar)/i, key: 'KEY 3 — Outreach', why: 'one merchant, one private preview, owner-authorized only' },
  { re: /\b(spend|buy|pay|purchase|advertis|campaign live)\b/i, key: 'SPEND GATE', why: 'no money moves without the owner' },
];

// ---- INTENT GRAMMAR: explicit, deterministic, honest ----
export const COMMANDS = [
  { id: 'status', hint: 'status · how are we — cockpit summary', re: /\b(status|how are we|state of|cockpit|overview|god'?s.?eye)\b/i,
    run: () => runNode(['tools/vanguard/cockpit.mjs'], 180000) },
  { id: 'next', hint: 'what next · allocate — the allocator\'s current orders', re: /\b(what('?s| should we do)? next|allocat|priorit|orders?)\b/i,
    run: () => { const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vanguard/portfolio.json'), 'utf8'));
      return { status: 0, out: null, raw: '', custom: importAllocate(p) }; } },
  { id: 'pulse', hint: 'pulse · run a cycle — one full governed metabolism pulse', re: /\b(pulse|run (a |one )?(cycle|heartbeat)|metaboli)\b/i,
    run: () => runNode(['tools/vanguard/governor.mjs', '--once'], 600000) },
  { id: 'sweep', hint: 'sweep · custody — verify every chain and every verifier', re: /\b(sweep|custody|chains?|verify (the )?ledgers?)\b/i,
    run: () => runNode(['tools/alive-loop/custody-sweep.mjs'], 120000) },
  { id: 'forecasts', hint: 'forecasts — pending, overdue, calibration', re: /\b(forecast|predict|brier|calibrat)\b/i,
    run: () => { const { ForecastLedger } = importSync('../alive-loop/forecast-ledger.mjs');
      const l = new ForecastLedger(path.join(LOCAL, 'forecasts', 'ledger.jsonl'));
      return { status: 0, custom: { calibration: l.calibration(), pending: l.pending().map(p => ({ id: p.forecast_id, overdue: p.overdue })) } }; } },
  { id: 'decisions', hint: 'decisions · regret — open decision loops', re: /\b(decision|regret)\b/i,
    run: () => { const { RegretLedger } = importSync('./regret-ledger.mjs');
      const l = new RegretLedger(path.join(LOCAL, 'regret', 'regret.jsonl'));
      return { status: 0, custom: { open: l.open(), chain: l.verifyChain() } }; } },
  { id: 'queue', hint: 'queue — what waits on the owner\'s keys', re: /\b(queue|gated|waiting|keys?)\b/i,
    run: () => { const { loadBoard, gapsAsOwnerQueue } = importSync('./victory-board.mjs');
      return { status: 0, custom: { owner_queue: gapsAsOwnerQueue(loadBoard(path.join(ROOT, 'docs/vanguard/VICTORY_BOARD.json'))) } }; } },
  { id: 'ttrl', hint: 'ttrl · how fast do we learn — learning velocity from receipts', re: /\b(ttrl|learning velocity|how fast do we learn)\b/i,
    run: () => runNode(['tools/vanguard/ttrl.mjs'], 60000) },
  { id: 'rebuild-demo', hint: 'rebuild demo — deterministic demo build', re: /\brebuild (the )?demo\b/i,
    run: () => { const p = spawnSync('node', ['build.mjs'], { cwd: path.resolve(ROOT, '..', 'zero-base', 'demo-usable'), encoding: 'utf8' });
      return { status: p.status, custom: { built: p.status === 0, note: (p.stdout || p.stderr || '').trim() } }; } },
  { id: 'rebuild-cockpit', hint: 'rebuild cockpit — refresh the god\'s-eye view', re: /\brebuild (the )?cockpit|refresh (the )?cockpit\b/i,
    run: () => runNode(['tools/vanguard/cockpit.mjs'], 180000) },
  { id: 'help', hint: 'help — this command map', re: /\b(help|commands?|what can you do)\b/i,
    run: () => ({ status: 0, custom: { commands: COMMANDS.map(c => c.hint) } }) },
];

function importSync(rel) { // tiny sync ESM bridge for library commands
  const url = new URL(rel, import.meta.url).href;
  return importSync._cache?.[url] ?? (() => { throw new Error('LIB_NOT_PRELOADED'); })();
}
importSync._cache = {};
export async function preload() {
  for (const rel of ['../alive-loop/forecast-ledger.mjs', './regret-ledger.mjs', './victory-board.mjs', './allocator.mjs']) {
    importSync._cache[new URL(rel, import.meta.url).href] = await import(rel);
  }
}
function importAllocate(portfolio) {
  const { allocate } = importSync('./allocator.mjs');
  return allocate(portfolio, { slots: 2 });
}

/** Compile an utterance. Deterministic; refuses gated intents by name. */
export function compile(utterance) {
  const u = String(utterance || '').trim();
  if (!u) return { kind: 'UNKNOWN', suggestions: COMMANDS.slice(0, 4).map(c => c.hint) };
  for (const g of GATES) if (g.re.test(u)) return { kind: 'REFUSED_OWNER_GATE', gate: g.key, why: g.why };
  for (const c of COMMANDS) if (c.re.test(u)) return { kind: 'COMMAND', id: c.id, cmd: c };
  const near = COMMANDS.filter(c => u.toLowerCase().split(/\s+/).some(w => c.hint.includes(w))).map(c => c.hint);
  return { kind: 'UNKNOWN', suggestions: (near.length ? near : COMMANDS.map(c => c.hint)).slice(0, 5) };
}

export async function execute(utterance) {
  await preload();
  const compiled = compile(utterance);
  let result = null;
  if (compiled.kind === 'COMMAND') {
    const r = compiled.cmd.run();
    result = r.custom ?? r.out ?? { exit: r.status };
  }
  const receipt = store().append('CONSOLE_COMMAND', `con_${Date.now().toString(36)}`, {
    utterance: String(utterance).slice(0, 200),
    compiled: compiled.kind === 'COMMAND' ? compiled.id : compiled.kind,
    gate: compiled.gate ?? null,
    ok: compiled.kind === 'COMMAND',
  });
  return { compiled, result, receipt_seq: receipt.seq };
}

function render(x) {
  const { compiled, result } = x;
  if (compiled.kind === 'REFUSED_OWNER_GATE') {
    return `⛔ REFUSED — ${compiled.gate}. ${compiled.why}. The console can stage and describe this; only the owner can do it.`;
  }
  if (compiled.kind === 'UNKNOWN') {
    return `❓ UNKNOWN — I compile commands, I don't guess. Closest:\n  · ${compiled.suggestions.join('\n  · ')}`;
  }
  return `✅ ${compiled.id}\n${JSON.stringify(result, null, 2)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--repl') {
    await preload();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'cana> ' });
    console.log('CANA CONSOLE — plain words in, governed receipts out. "help" for the map, ctrl-c to leave.');
    rl.prompt();
    rl.on('line', async (line) => { console.log(render(await execute(line))); rl.prompt(); });
  } else {
    const utterance = args.join(' ');
    console.log(render(await execute(utterance)));
  }
}
