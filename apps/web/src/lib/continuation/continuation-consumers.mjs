import {
  recheckMarketGap,
  recordMarketGapRecheckFailure,
} from '../ask/market-gap-recheck.mjs';
import { loadPendingFiredConsumerReceipts } from './continuation-storage.mjs';

export async function consumeFiredContinuations(prisma, {
  tickSummary,
  tenant,
  now = new Date(),
  limit = 50,
}) {
  const receiptHints = Array.isArray(tickSummary?.receipts) ? tickSummary.receipts : [];
  const pending = await loadPendingFiredConsumerReceipts(prisma, {
    tenant,
    consumer: 'ask_market_gap_recheck',
    limit,
  });
  const outcomes = [];
  const seen = new Set();
  const candidates = [
    ...receiptHints.map((hint) => ({ id: hint?.id, tickId: tickSummary?.tickId })),
    ...pending,
  ];
  let failures = 0;
  for (const hint of candidates) {
    const receiptId = typeof hint?.id === 'string' ? hint.id : null;
    if (receiptId && seen.has(receiptId)) continue;
    if (receiptId) seen.add(receiptId);
    let result;
    try {
      result = await recheckMarketGap(prisma, {
        tenant,
        receiptId,
        tickId: hint.tickId,
        now,
      });
    } catch (error) {
      failures += 1;
      result = await recordMarketGapRecheckFailure(prisma, {
        tenant,
        receiptId,
        tickId: hint.tickId,
        now,
        error,
      });
    }
    outcomes.push(Object.freeze({ receipt_id: receiptId, consumer: 'ask_market_gap_recheck', ...result }));
  }
  return Object.freeze({
    tenant,
    processed: outcomes.length,
    failures,
    outcomes: Object.freeze(outcomes),
  });
}
