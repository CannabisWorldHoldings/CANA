/**
 * Delivery Service-Area Intelligence — relevance is ELIGIBILITY, not radius.
 *
 * Owner law (PDF directive D13, mechanism M-012): "A business 3 miles away
 * that does not deliver to the customer is less relevant than a business
 * 8 miles away that does." Radius answers physical proximity; delivery
 * requires SERVICE AREA + ELIGIBILITY + CURRENT HOURS + MINIMUM + FEE + ETA
 * — and only where verified data exists.
 *
 * Laws:
 * 1. VERIFIED-ONLY: eligibility claims come from verified delivery records.
 *    Missing or stale verification FAILS CLOSED to UNVERIFIED — we say "we
 *    don't know", we never guess. (DO NOT INVENT IT — PDF p.20.)
 * 2. LICENSE IS A GATE, NOT A SIGNAL: an unlicensed merchant is never
 *    eligible, whatever its service data says.
 * 3. TIME IS REAL: open-state resolves against the injected clock and the
 *    merchant's verified hours (close times may spill past midnight, e.g.
 *    28:00 = 4am next day). No vague "probably open".
 * 4. RANKING TRUTH: ELIGIBLE_OPEN > ELIGIBLE_CLOSED > UNVERIFIED >
 *    OUT_OF_AREA. A definite cannot-serve ranks below an honest unknown;
 *    distance only tiebreaks INSIDE a class, never across classes.
 * 5. FACTS PASS THROUGH, NEVER INVENTED: minimum/fee/ETA surface only when
 *    present on the verified record; absent fields stay absent.
 *
 * Deterministic, LEVEL 0, zero model calls. Every verdict carries reasons.
 */

import { DATA_STATUS } from './data-status.mjs';

export const ELIGIBILITY = Object.freeze({
  ELIGIBLE_OPEN: 'ELIGIBLE_OPEN',
  ELIGIBLE_CLOSED: 'ELIGIBLE_CLOSED',
  UNVERIFIED: 'UNVERIFIED',
  OUT_OF_AREA: 'OUT_OF_AREA',
});

const CLASS_RANK = Object.freeze({
  ELIGIBLE_OPEN: 0,
  ELIGIBLE_CLOSED: 1,
  UNVERIFIED: 2,
  OUT_OF_AREA: 3,
});

export const DEFAULT_MAX_VERIFIED_AGE_HOURS = 24;

const normalize = (s) => String(s).trim().toLowerCase();

/**
 * Wall-clock day-of-week and minute-of-day IN THE TIMESTAMP'S OWN OFFSET.
 *
 * Delivery hours are market-local: a "Saturday 10:00 → 4am" window means
 * Saturday in the market's timezone, and the queried instant carries that
 * timezone as an explicit UTC offset (e.g. `-04:00`). Using Date#getDay /
 * getHours / getMinutes would resolve the instant against the RUNNER's
 * local timezone instead, so the same instant produced a different
 * day/minute-of-day on a UTC CI runner than on an America/New_York
 * developer machine — a spill-past-midnight window opened or closed
 * depending on where the test ran (PREEXISTING_PRODUCT_DEFECT).
 *
 * The correct semantics: shift the absolute instant by the timestamp's own
 * offset and read the UTC-based fields of the shifted instant. That yields
 * the market-local wall clock regardless of the runner's timezone. An offset
 * is extracted from the ISO-8601 string; a bare/`Z` timestamp is treated as
 * UTC. If no offset can be determined the value falls back to the parsed
 * instant read in UTC (still runner-independent).
 */
function offsetMinutesFromTimestamp(now) {
  if (now instanceof Date) return 0; // a Date is an absolute instant; read it in UTC
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(String(now).trim());
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  }
  return 0; // bare or Z-suffixed timestamp: already UTC wall clock
}

/** The market-local wall clock (day-of-week + minute-of-day) of the queried
 *  instant, honoring the timestamp's OWN offset rather than the runner TZ. */
function marketLocalWallClock(now) {
  const instant = new Date(now);
  const shifted = new Date(instant.getTime() + offsetMinutesFromTimestamp(now) * 60_000);
  return {
    day: shifted.getUTCDay(),
    mins: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Minutes since market-local midnight for the injected clock. */
function minutesOfDay(now) {
  return marketLocalWallClock(now).mins;
}

/**
 * Is the merchant open at `now` per verified hours?
 * hours: [{ day: 0-6 (Sun-Sat), open_minutes, close_minutes }] where
 * close_minutes may exceed 1440 to spill into the next day (1680 = 4am).
 */
export function isOpenAt(hours, now) {
  if (!Array.isArray(hours) || hours.length === 0) return null; // unknown, not closed
  const { day, mins } = marketLocalWallClock(now);
  for (const h of hours) {
    if (h.day === day && mins >= h.open_minutes && mins < h.close_minutes) return true;
    // yesterday's window spilling past midnight
    const prev = (day + 6) % 7;
    if (h.day === prev && h.close_minutes > 1440 && mins < h.close_minutes - 1440) return true;
  }
  return false;
}

/**
 * Evaluate one merchant's delivery eligibility for a customer context.
 * merchant: { merchant_id, name, license: { status, checked_at },
 *   distance_miles?, delivery?: { service_area: { neighborhoods: [] },
 *   hours?, minimum_usd?, fee_usd?, eta_minutes?, verified_at } }
 * context: { neighborhood, now, maxVerifiedAgeHours? }
 */
export function evaluateDeliveryEligibility(merchant, context) {
  if (!merchant || typeof merchant !== 'object') throw new TypeError('merchant record required');
  if (!context || !context.neighborhood || !context.now || Number.isNaN(Date.parse(context.now))) {
    throw new TypeError('context { neighborhood, now } required');
  }
  const maxAgeMs = (context.maxVerifiedAgeHours ?? DEFAULT_MAX_VERIFIED_AGE_HOURS) * 3600_000;
  const reasons = [];
  const verdict = (status, facts = {}) => Object.freeze({
    merchant_id: merchant.merchant_id,
    status,
    reasons: Object.freeze(reasons),
    facts: Object.freeze(facts),
  });

  // Law 2: license gate
  if (!merchant.license || merchant.license.status !== DATA_STATUS.VERIFIED_CURRENT) {
    reasons.push('license not verified — never eligible (law 2)');
    return verdict(ELIGIBILITY.UNVERIFIED);
  }

  const d = merchant.delivery;
  // Law 1: fail closed on missing/stale verification
  if (!d || !d.verified_at || Number.isNaN(Date.parse(d.verified_at))) {
    reasons.push('no verified delivery record — fail closed, we do not guess (law 1)');
    return verdict(ELIGIBILITY.UNVERIFIED);
  }
  const age = Date.parse(context.now) - Date.parse(d.verified_at);
  if (age > maxAgeMs) {
    reasons.push(`delivery record stale (${Math.floor(age / 3600_000)}h old > ${maxAgeMs / 3600_000}h) — fail closed (law 1)`);
    return verdict(ELIGIBILITY.UNVERIFIED);
  }

  const area = d.service_area && Array.isArray(d.service_area.neighborhoods)
    ? d.service_area.neighborhoods.map(normalize)
    : null;
  if (!area) {
    reasons.push('service area unverified — fail closed (law 1)');
    return verdict(ELIGIBILITY.UNVERIFIED);
  }

  // Law 5: facts pass through only when present
  const facts = {};
  if (typeof d.minimum_usd === 'number') facts.minimum_usd = d.minimum_usd;
  if (typeof d.fee_usd === 'number') facts.fee_usd = d.fee_usd;
  if (Array.isArray(d.eta_minutes)) facts.eta_minutes = d.eta_minutes;

  if (!area.includes(normalize(context.neighborhood))) {
    reasons.push(`verified service area does not include ${context.neighborhood} — definite cannot-serve`);
    return verdict(ELIGIBILITY.OUT_OF_AREA, facts);
  }

  // Law 3: time is real
  const open = isOpenAt(d.hours, context.now);
  if (open === true) {
    reasons.push(`serves ${context.neighborhood} and is open now per verified hours`);
    return verdict(ELIGIBILITY.ELIGIBLE_OPEN, facts);
  }
  if (open === false) {
    reasons.push(`serves ${context.neighborhood} but is closed at the queried time per verified hours`);
    return verdict(ELIGIBILITY.ELIGIBLE_CLOSED, facts);
  }
  reasons.push(`serves ${context.neighborhood}; hours unverified — surfaced as eligible with unknown open-state, never claimed open`);
  return verdict(ELIGIBILITY.ELIGIBLE_CLOSED, facts);
}

/**
 * Rank merchants for a delivery context — law 4. Eligibility class first;
 * inside a class: distance asc, then fee asc, then merchant_id for total
 * determinism. Returns [{ merchant, verdict }] in rank order.
 */
export function rankDeliveryRelevance(merchants, context) {
  if (!Array.isArray(merchants)) throw new TypeError('merchants array required');
  const rows = merchants.map((m) => ({ merchant: m, verdict: evaluateDeliveryEligibility(m, context) }));
  rows.sort((a, b) => {
    const cls = CLASS_RANK[a.verdict.status] - CLASS_RANK[b.verdict.status];
    if (cls !== 0) return cls;
    const da = typeof a.merchant.distance_miles === 'number' ? a.merchant.distance_miles : Infinity;
    const db = typeof b.merchant.distance_miles === 'number' ? b.merchant.distance_miles : Infinity;
    if (da !== db) return da - db;
    const fa = a.verdict.facts.fee_usd ?? Infinity;
    const fb = b.verdict.facts.fee_usd ?? Infinity;
    if (fa !== fb) return fa - fb;
    return a.merchant.merchant_id < b.merchant.merchant_id ? -1 : 1;
  });
  return rows;
}
