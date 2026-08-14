'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import DisclosureModal from '@/components/disclosure-modal';
import { buildEvidenceReceipt } from '@/lib/label-vocabulary.mjs';

type ClaimRow = {
  field: string;
  value?: string;
  source?: string;
  checkedAt?: string;
  verification?: string;
};

function formatDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * EvidenceTrigger — the glance-level "+" that opens the receipt (L1 → L3).
 * LAW: renders NOTHING without real claim rows. The receipt shows exactly
 * four things: what we know, where it came from, when we checked, and what
 * is still uncertain — truth underneath beauty, never trust theater.
 */
export default function EvidenceTrigger({
  entityName,
  claims,
  unknowns,
  triggerLabel = 'Evidence',
}: {
  entityName: string;
  claims: ClaimRow[];
  unknowns?: string[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const receipt = buildEvidenceReceipt({ claims, unknowns });
  if (!receipt) return null;

  const checkedLabel = formatDate(receipt.latestCheckedAt);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tint-chip cursor-pointer"
        aria-haspopup="dialog"
        aria-label={`Open evidence for ${entityName}`}
      >
        {triggerLabel}
        <Plus size={11} aria-hidden="true" />
      </button>
      <DisclosureModal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Evidence"
        title={`What we know about ${entityName}`}
      >
        <div className="flex flex-col gap-6">
          {receipt.known.length > 0 ? (
            <section aria-label="What we know">
              <h3 className="owd-body font-semibold text-brand-text">What we know</h3>
              <ul className="owd-hairline-t mt-2">
                {receipt.known.map((row) => (
                  <li key={row.field} className="owd-hairline-b flex items-baseline justify-between gap-4 py-2.5">
                    <span className="owd-body-reduced text-brand-muted">{row.field}</span>
                    <span className="owd-body-reduced text-right font-semibold text-brand-text">{row.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {receipt.sources.length > 0 ? (
            <section aria-label="Where it came from">
              <h3 className="owd-body font-semibold text-brand-text">Where it came from</h3>
              <p className="owd-body-reduced mt-1 text-brand-muted">{receipt.sources.join(' · ')}</p>
            </section>
          ) : null}
          {checkedLabel ? (
            <section aria-label="When we checked">
              <h3 className="owd-body font-semibold text-brand-text">When we checked</h3>
              <p className="owd-body-reduced mt-1 text-brand-muted">Most recent verification: {checkedLabel}</p>
            </section>
          ) : null}
          {receipt.uncertain.length > 0 ? (
            <section aria-label="Still uncertain">
              <h3 className="owd-body font-semibold text-brand-text">Still uncertain</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {receipt.uncertain.map((row) => (
                  <li key={`${row.field}-${row.reason}`} className="owd-body-reduced text-brand-muted">
                    {row.field}
                    <span className="owd-caption"> — {row.reason === 'NO_PROVENANCE' ? 'no source on file yet' : row.reason.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="owd-caption text-brand-muted">
            Every fact above carries its source and check time. Anything we cannot prove stays labeled uncertain.
          </p>
        </div>
      </DisclosureModal>
    </>
  );
}
