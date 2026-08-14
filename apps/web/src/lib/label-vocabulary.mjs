// P0.4 closed label vocabulary + evidence receipt shaping (visual court law A9).
// Chips are a CLOSED set: anything outside it fails the court. Evidence
// receipts are built ONLY from real claim rows — no rows, no receipt, no
// decorative trust theater.

/** The closed chip vocabulary (approved evidence grammar). */
export const CHIP_KINDS = Object.freeze([
  'VERIFIED',
  'NEW',
  'DEAL',
  'SPONSORED',
  'OPEN_NOW',
  'DELIVERS_HERE',
  'NEIGHBORHOOD',
  'UNKNOWN',
]);

const FIXED_LABELS = Object.freeze({
  VERIFIED: 'Verified',
  NEW: 'New',
  SPONSORED: 'Sponsored',
  OPEN_NOW: 'Open now',
  DELIVERS_HERE: 'Delivers here',
  UNKNOWN: 'Unknown',
});

/**
 * Resolve the display label for a chip kind. DEAL and NEIGHBORHOOD carry a
 * dynamic value (the deal title / the neighborhood name); everything else is
 * fixed. Unknown kinds throw — the closed set is the law, not a suggestion.
 */
export function chipLabel(kind, value) {
  if (!CHIP_KINDS.includes(kind)) {
    throw new Error(`chip kind outside the closed vocabulary: ${String(kind)}`);
  }
  if (kind === 'DEAL' || kind === 'NEIGHBORHOOD') {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '') {
      throw new Error(`${kind} chips require a real value`);
    }
    return trimmed;
  }
  return FIXED_LABELS[kind];
}

/** Court hook: is a rendered chip lawful under the closed vocabulary? */
export function isAllowedChip(kind) {
  return CHIP_KINDS.includes(kind);
}

const KNOWN_VERIFICATIONS = Object.freeze(['VERIFIED', 'SUPPORTED']);

/**
 * Build the L3 evidence receipt from real claim rows.
 * Input rows: { field, value, source, checkedAt, verification }.
 * - Rows verified/supported WITH a source AND a checkedAt land in `known`.
 * - Rows missing provenance, or carrying UNKNOWN/STALE/CONTRADICTED states,
 *   land in `uncertain` — honesty by demotion, never by omission.
 * - Extra free-text `unknowns` join `uncertain`.
 * - ZERO claim rows → null: the trigger renders nothing (no receipt theater).
 */
export function buildEvidenceReceipt({ claims, unknowns } = {}) {
  const rows = Array.isArray(claims) ? claims.filter((row) => row && typeof row === 'object') : [];
  if (rows.length === 0) return null;

  const known = [];
  const uncertain = [];
  const sources = new Set();
  let latestCheckedAt = null;

  for (const row of rows) {
    const field = typeof row.field === 'string' ? row.field.trim() : '';
    if (field === '') continue;
    const verification = typeof row.verification === 'string' ? row.verification.toUpperCase() : 'UNKNOWN';
    const source = typeof row.source === 'string' ? row.source.trim() : '';
    const checkedAtMs = row.checkedAt ? new Date(row.checkedAt).getTime() : NaN;
    const hasProvenance = source !== '' && Number.isFinite(checkedAtMs);

    if (KNOWN_VERIFICATIONS.includes(verification) && hasProvenance) {
      known.push({
        field,
        value: typeof row.value === 'string' ? row.value : String(row.value ?? ''),
        source,
        checkedAt: new Date(checkedAtMs).toISOString(),
      });
      sources.add(source);
      if (latestCheckedAt === null || checkedAtMs > latestCheckedAt) {
        latestCheckedAt = checkedAtMs;
      }
    } else {
      uncertain.push({ field, reason: hasProvenance ? verification : 'NO_PROVENANCE' });
    }
  }

  for (const item of Array.isArray(unknowns) ? unknowns : []) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (text !== '') uncertain.push({ field: text, reason: 'UNKNOWN' });
  }

  if (known.length === 0 && uncertain.length === 0) return null;

  return {
    known,
    uncertain,
    sources: [...sources],
    latestCheckedAt: latestCheckedAt === null ? null : new Date(latestCheckedAt).toISOString(),
  };
}
