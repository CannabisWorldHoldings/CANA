import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, MapPin, Store, Truck } from 'lucide-react';
import { DataStatusBadge } from '@/components/data-status-badge';
import FavoriteButton from '@/components/favorite-button';
import { relativeFreshnessLabel } from '@/lib/freshness.mjs';

export type CustomerListing = {
  id: string;
  name: string;
  type: string;
  city: string;
  zip: string | null;
  dataSource: string;
  dataStatus: string;
  isDemonstration: boolean;
  verifiedAt: Date | null;
  freshnessExpiresAt: Date | null;
  deals?: Array<{ id: string }>;
  menus?: Array<{ id: string }>;
};

const ILLUSTRATIONS = [
  '/marketplace/retailer-0.webp',
  '/marketplace/retailer-1.webp',
  '/marketplace/retailer-2.webp',
  '/marketplace/retailer-3.webp',
];

export default function CustomerListingRow({
  listing,
  index,
}: {
  listing: CustomerListing;
  index: number;
}) {
  const delivery = listing.type === 'delivery';
  const freshness = relativeFreshnessLabel({
    verifiedAt: listing.verifiedAt,
    freshnessExpiresAt: listing.freshnessExpiresAt,
  });

  return (
    <article className="sovereign-listing grid gap-5 py-5 sm:grid-cols-[9rem_1fr] sm:items-center lg:grid-cols-[11rem_1fr] lg:gap-7">
      <div className="relative overflow-hidden rounded-xl bg-[#f2f3f1]">
        <Image
          src={ILLUSTRATIONS[index % ILLUSTRATIONS.length]}
          alt=""
          width={900}
          height={900}
          unoptimized
          sizes="(max-width: 639px) 100vw, 11rem"
          className="aspect-[4/3] h-full w-full object-cover"
        />
        <span className="absolute bottom-2 left-2 rounded-md bg-white/90 px-2 py-1 text-[10px] font-semibold text-[#465149]">
          Illustrative artwork
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-[#526058]">
              {delivery ? <Truck size={14} aria-hidden="true" /> : <Store size={14} aria-hidden="true" />}
              {delivery ? 'Delivery service' : 'Dispensary storefront'}
            </p>
            <h3 className="mt-1 font-display text-xl font-semibold tracking-[-0.025em] text-[#111612] sm:text-2xl">
              {listing.name}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <DataStatusBadge
              dataStatus={listing.dataStatus}
              isDemonstration={listing.isDemonstration}
              verifiedAt={listing.verifiedAt}
              freshnessExpiresAt={listing.freshnessExpiresAt}
              compact
            />
            <FavoriteButton retailerId={listing.id} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#5c665f]">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} aria-hidden="true" />
            {delivery
              ? 'Washington, D.C. · confirm service area'
              : `${listing.city}${listing.zip ? `, ${listing.zip}` : ''}`}
          </span>
          <span>{listing.menus?.length ? 'Menu recorded' : 'Menu availability unavailable'}</span>
          <span>
            {listing.deals?.length
              ? `${listing.deals.length} current offer${listing.deals.length === 1 ? '' : 's'}`
              : 'No current offer recorded'}
          </span>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[#68716b]">
          {listing.isDemonstration
            ? 'Demonstration record · not a real business or availability claim.'
            : `${freshness ?? 'Update timing unavailable'} · Source: ${listing.dataSource}`}
        </p>

        <Link
          href={`/retailer/${listing.id}`}
          className="mt-4 inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35] hover:text-[#073e25]"
        >
          View labeled record
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
