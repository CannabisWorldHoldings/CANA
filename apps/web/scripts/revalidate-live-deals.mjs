#!/usr/bin/env node

/**
 * CANONICAL REVALIDATION ENTRY POINT — ORDERWEEDDC PILOT PROMOTIONAL EVIDENCE
 *
 * Idempotent execution script that revalidates live promotional offers against
 * direct Tier-1 merchant surfaces for the 4 verified pilot retailers.
 *
 * Usage:
 *   node scripts/revalidate-live-deals.mjs [--sync-db] [--as-of ISO_STRING]
 */

import { revalidatePilotPromotions, syncLiveDealsToDurableStore } from '../src/lib/reality/promotional-revalidation.mjs';
import { LIVE_PROMOTIONAL_OFFERS } from '../src/lib/reality/market-reality-pilot.mjs';

async function main() {
  const args = process.argv.slice(2);
  const shouldSyncDb = args.includes('--sync-db');
  const asOfArg = args.find((a) => a.startsWith('--as-of='));
  const asOf = asOfArg ? new Date(asOfArg.split('=')[1]) : new Date();

  console.log('============================================================');
  console.log('ORDERWEEDDC PROMOTIONAL REVALIDATION RUNNER');
  console.log(`AsOf: ${asOf.toISOString()}`);
  console.log('Universe: 4 Verified D.C. Pilot Merchants (Tier 1 Direct)');
  console.log('============================================================\n');

  const report = await revalidatePilotPromotions(LIVE_PROMOTIONAL_OFFERS, asOf);

  console.log(`Merchants Attempted: ${report.merchantsAttempted}`);
  for (const m of report.merchantResults) {
    console.log(`\nMerchant: ${m.merchantName} (${m.merchantId})`);
    console.log(`  Source URL: ${m.url}`);
    console.log(`  Reachable: ${m.reachable ? 'YES' : 'NO'} (HTTP ${m.httpStatus || 'N/A'})`);
    console.log(`  SHA-256: ${m.rawSha256 ? m.rawSha256.slice(0, 16) + '...' : 'NONE'}`);
    console.log(`  Epistemic State: ${m.epistemicState}`);
    for (const obs of m.observations) {
      console.log(`  Observation: [${obs.state || obs.status}] ${obs.dealId || ''}`);
    }
  }

  console.log('\n============================================================');
  console.log(`Real Current Promotional Deals: ${report.realCurrentDealCount}`);
  console.log(`Demonstration Deals Quarantined: ${report.demoDealCountQuarantined}`);
  console.log(`Historical Audit Events: ${report.historicalAuditEvents.length}`);
  console.log(`Customer Events Emitted: ${report.customerEventsGenerated}`);
  console.log('============================================================\n');

  if (shouldSyncDb) {
    console.log('Syncing updated live deals to durable database...');
    try {
      const { prisma } = await import('../src/lib/prisma.ts');
      const syncRes = await syncLiveDealsToDurableStore(prisma, report.updatedDeals);
      console.log(`Database sync completed: ${syncRes.syncedCount} deals updated (${syncRes.status})`);
      await prisma.$disconnect();
    } catch (err) {
      console.error('Database sync failed or skipped:', err.message);
    }
  }

  return report;
}

main().catch((err) => {
  console.error('Fatal Revalidation Error:', err);
  process.exit(1);
});
