import Link from 'next/link';
import {
  ArrowRight,
  Clock,
  MapPin,
  ScrollText,
  Store,
  Truck,
} from 'lucide-react';
import { DataStatusBadge } from '@/components/data-status-badge';
import FavoriteButton from '@/components/favorite-button';
import {
  SponsorshipBadge,
  type SponsorshipView,
} from '@/components/sponsorship-badge';

type FeaturedRetailer = {
  address: string;
  city: string;
  dataSource: string;
  dataStatus: string;
  freshnessExpiresAt: Date | null;
  hours: string | null;
  id: string;
  isDemonstration: boolean;
  name: string;
  sponsorship: SponsorshipView | null;
  type: string;
  verifiedAt: Date | null;
};

const RETAILER_IMAGES = [
  '/marketplace/retailer-0.webp',
  '/marketplace/retailer-1.webp',
  '/marketplace/retailer-2.webp',
  '/marketplace/retailer-3.webp',
];

export default function MarketplaceFeaturedRetailers({
  retailers,
}: {
  retailers: FeaturedRetailer[];
}) {
  if (retailers.length === 0) return null;

  return (
    <section className="border-y border-brand-border bg-brand-surface px-4 py-10 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-screen-2xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="kicker">D.C. directory</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-brand-text">
              Start with these labeled records
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-brand-muted">
              Visual previews are illustrative. Status, source, hours, and
              business details come from each directory record.
            </p>
          </div>
          <a
            href="#directory"
            className="hidden items-center gap-2 text-sm font-bold text-brand-primary-text sm:inline-flex"
          >
            View full directory
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {retailers.slice(0, 4).map((retailer, index) => (
            <article
              key={retailer.id}
              className="marketplace-retailer-card overflow-hidden rounded-2xl border border-brand-border bg-brand-background"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <img
                  src={RETAILER_IMAGES[index % RETAILER_IMAGES.length]}
                  alt=""
                  width={900}
                  height={900}
                  className="h-full w-full object-cover transition-transform duration-500"
                />
                <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                  Illustrative interior
                </span>
                <SponsorshipBadge
                  sponsorship={retailer.sponsorship}
                  className="absolute right-3 top-3"
                />
                <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-bold capitalize text-white backdrop-blur-md">
                  {retailer.type === 'storefront' ? (
                    <Store size={11} aria-hidden="true" />
                  ) : (
                    <Truck size={11} aria-hidden="true" />
                  )}
                  {retailer.type}
                </span>
                <div className="absolute bottom-3 right-3">
                  <FavoriteButton retailerId={retailer.id} />
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg font-bold leading-tight text-brand-text">
                    <Link
                      href={`/retailer/${retailer.id}`}
                      className="hover:text-brand-primary-text"
                    >
                      {retailer.name}
                    </Link>
                  </h3>
                  <DataStatusBadge
                    dataStatus={retailer.dataStatus}
                    isDemonstration={retailer.isDemonstration}
                    verifiedAt={retailer.verifiedAt}
                    freshnessExpiresAt={retailer.freshnessExpiresAt}
                    compact
                  />
                </div>

                <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-brand-muted">
                  <MapPin
                    size={13}
                    className="mt-0.5 shrink-0 text-brand-primary-text"
                    aria-hidden="true"
                  />
                  {retailer.address}, {retailer.city}
                </p>
                <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-brand-muted">
                  <ScrollText
                    size={13}
                    className="mt-0.5 shrink-0 text-brand-primary-text"
                    aria-hidden="true"
                  />
                  Source: {retailer.dataSource}
                </p>
                {retailer.hours && (
                  <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-brand-muted">
                    <Clock
                      size={13}
                      className="mt-0.5 shrink-0 text-brand-primary-text"
                      aria-hidden="true"
                    />
                    {retailer.hours}
                  </p>
                )}

                <Link
                  href={`/retailer/${retailer.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-surface px-4 py-2.5 text-xs font-bold text-brand-text transition-colors hover:border-brand-primary/50 hover:text-brand-primary-text"
                >
                  View record &amp; menu
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
