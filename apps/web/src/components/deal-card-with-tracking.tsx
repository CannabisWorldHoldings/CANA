'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import { DataStatusBadge } from '@/components/data-status-badge';

type Deal = {
  id: string;
  title: string;
  description: string | null;
  discount: string | null;
  code: string | null;
  expiryDate: Date | string;
  isDemonstration: boolean;
  dataStatus: string;
  verifiedAt: Date | null;
  freshnessExpiresAt: Date | null;
  retailer: {
    id: string;
    name: string;
    type: string;
    city: string;
  };
};

export function DealCardWithTracking({ deal }: { deal: Deal }) {
  useEffect(() => {
    // Record DEAL_VIEWED on render
    fetch('/api/v1/customer/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'DEAL_VIEWED',
        retailerId: deal.retailer.id,
        dealId: deal.id,
      }),
    }).catch(() => {});
  }, [deal.id, deal.retailer.id]);

  const handleMerchantClick = () => {
    // Record MERCHANT_CLICKED on user click action
    fetch('/api/v1/customer/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'MERCHANT_CLICKED',
        retailerId: deal.retailer.id,
        dealId: deal.id,
        destination: `/retailer/${deal.retailer.id}`,
      }),
    }).catch(() => {});
  };

  return (
    <div className="record-card rounded-2xl p-6 flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-black text-orange-700 bg-orange-400/10 border border-orange-400/20 px-2.5 py-1 rounded-lg">
            <Flame size={12} aria-hidden="true" />
            {deal.isDemonstration ? 'DEMO OFFER' : deal.discount}
          </span>
          <DataStatusBadge
            dataStatus={deal.dataStatus as any}
            isDemonstration={deal.isDemonstration}
            verifiedAt={deal.verifiedAt}
            freshnessExpiresAt={deal.freshnessExpiresAt}
            compact
          />
        </div>

        <h3 className="font-display text-lg font-extrabold text-brand-text leading-snug">{deal.title}</h3>
        <p className="text-xs text-brand-muted leading-relaxed line-clamp-3">{deal.description}</p>
      </div>

      <div className="space-y-3 border-t border-brand-border/60 pt-4">
        <div className="flex items-center justify-between text-xs">
          <div className="bg-brand-background border border-brand-border px-3 py-1.5 rounded-lg font-mono font-bold text-brand-text">
            Code: {deal.code || 'NO CODE NEEDED'}
          </div>
          <span className="text-[10px] text-brand-muted font-semibold">
            Expires {new Date(deal.expiryDate).toLocaleDateString()}
          </span>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            <span className="text-xs font-bold text-brand-text block">{deal.retailer.name}</span>
            <span className="text-[10px] text-brand-muted capitalize">{deal.retailer.type} • {deal.retailer.city}</span>
          </div>
          <Link
            href={`/retailer/${deal.retailer.id}`}
            onClick={handleMerchantClick}
            className="text-xs font-bold text-brand-primary-text hover:underline"
          >
            View Menu →
          </Link>
        </div>
      </div>
    </div>
  );
}
