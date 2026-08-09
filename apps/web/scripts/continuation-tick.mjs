#!/usr/bin/env node
/**
 * CONTINUATION TICK — the wake entry point.
 *
 * ANY runtime may invoke this (cPanel cron via deploy/namecheap/worker.mjs,
 * Hyperagent, Temporal, GitHub Actions, an operator's laptop):
 *
 *   node apps/web/scripts/continuation-tick.mjs [--event <key>]... [--limit N]
 *
 * The invoker owns NOTHING. The database owns the triggers, the missions and
 * the receipts; this process merely asks the kernel to evaluate durable state
 * against the current clock and any observed events. Two invokers racing on
 * the same tick are safe — firing is exactly-once by conditional claim.
 *
 * Exit codes: 0 tick completed (including "nothing due"), 2 no DATABASE_URL,
 * 3 tick failed. Absence of configuration is a state, not a shrug.
 */

import { runTick } from '../src/lib/continuation/continuation-repository.mjs';

function parseArgs(argv) {
  const events = [];
  let limit = 50;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--event' && argv[i + 1]) events.push(argv[(i += 1)]);
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[(i += 1)]) || 50;
  }
  return { events, limit };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(JSON.stringify({ event: 'continuation-tick-skipped', reason: 'DATABASE_URL not configured' }));
    process.exit(2);
  }
  const { events, limit } = parseArgs(process.argv.slice(2));
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const summary = await runTick(prisma, { events, limit });
    console.log(JSON.stringify({ event: 'continuation-tick', ...summary, receipts: summary.receipts.length }));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ event: 'continuation-tick-failed', error: String(error?.message ?? error).slice(0, 300) }));
    process.exit(3);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();
