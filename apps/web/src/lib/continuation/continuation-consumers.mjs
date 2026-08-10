import { recheckMarketGap } from '../ask/market-gap-recheck.mjs';

export async function consumeFiredContinuations(prisma, {
  tickSummary,
  tenant,
  now = new Date(),
}) {
  const receiptHints = Array.isArray(tickSummary?.receipts) ? tickSummary.receipts : [];
  const outcomes = [];
  const seen = new Set();
  for (const hint of receiptHints) {
    const receiptId = typeof hint?.id === 'string' ? hint.id : null;
    if (receiptId && seen.has(receiptId)) continue;
    if (receiptId) seen.add(receiptId);
    const result = await recheckMarketGap(prisma, {
      tenant,
      receiptId,
      tickId: tickSummary?.tickId,
      now,
    });
    outcomes.push(Object.freeze({ receipt_id: receiptId, consumer: 'ask_market_gap_recheck', ...result }));
  }
  return Object.freeze({
    tenant,
    processed: outcomes.length,
    outcomes: Object.freeze(outcomes),
  });
}
