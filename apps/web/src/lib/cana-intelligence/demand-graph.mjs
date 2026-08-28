import { assert, deepFreeze, digest, iso, sealPlain } from './core.mjs';

const OBSERVED_EVENT_KINDS = new Set(['ASK', 'SEARCH', 'ZERO_RESULTS', 'SELECTION', 'PURCHASE']);

export function validateIntentEvent(event) {
  assert(event && typeof event === 'object', 'event required');
  assert(OBSERVED_EVENT_KINDS.has(event.kind), `unsupported intent event kind ${event.kind}`);
  assert(event.provenanceState === 'OBSERVED', 'verified demand graph accepts only OBSERVED events', 'SYNTHETIC_DEMAND_FORBIDDEN');
  assert(typeof event.eventId === 'string' && event.eventId, 'eventId required');
  assert(event.observedAt !== undefined && event.observedAt !== null, 'observedAt required');
  return sealPlain({ ...event, observedAt: iso(event.observedAt) });
}

export function buildDemandGraph(events) {
  const cells = new Map();
  let selections = 0;
  let zeroResults = 0;
  for (const raw of events) {
    const event = validateIntentEvent(raw);
    if (event.kind === 'SELECTION') selections += 1;
    if (event.kind === 'ZERO_RESULTS') zeroResults += 1;
    const dims = event.dimensions ?? {};
    const key = [dims.market ?? 'UNKNOWN', dims.neighborhood ?? 'UNKNOWN', dims.category ?? 'UNKNOWN', dims.fulfillment ?? 'ANY'].join('::');
    const cell = cells.get(key) ?? { key, count: 0, zeroResults: 0, selections: 0, priceCaps: [], evidence: [] };
    cell.count += 1;
    if (event.kind === 'ZERO_RESULTS') cell.zeroResults += 1;
    if (event.kind === 'SELECTION') cell.selections += 1;
    if (Number.isFinite(dims.priceCapUsd)) cell.priceCaps.push(dims.priceCapUsd);
    cell.evidence.push(event.evidenceDigest ?? digest({ eventId: event.eventId, observedAt: event.observedAt }));
    cells.set(key, cell);
  }
  const rows = [...cells.values()].map((c) => deepFreeze({
    ...c,
    medianPriceCapUsd: c.priceCaps.length ? [...c.priceCaps].sort((a, b) => a - b)[Math.floor(c.priceCaps.length / 2)] : null,
    epistemicState: 'INFERRED',
    derivedFromObservedEvents: c.count,
  }));
  return deepFreeze({
    rows,
    totals: { events: events.length, selections, zeroResults },
    digest: digest(rows.map(({ key, count, zeroResults: zr, selections: s }) => ({ key, count, zr, s })), 'demand'),
  });
}
