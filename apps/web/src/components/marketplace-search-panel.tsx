import Link from 'next/link';
import { BadgeCheck, MapPin, Search } from 'lucide-react';
import {
  DC_NEIGHBORHOOD_MAP,
  DIRECTORY_QUERY_MAX_LENGTH,
  directorySearchHref,
} from '@/lib/directory-search.mjs';

type MarketplaceSearchFilters = {
  neighborhood?: string;
  page: number;
  query?: string;
  sort: string;
  status?: string;
  type?: string;
};

export default function MarketplaceSearchPanel({
  filters,
}: {
  filters: MarketplaceSearchFilters;
}) {
  const hasFilters = Boolean(
    filters.query ||
      filters.type ||
      filters.status ||
      filters.neighborhood ||
      filters.sort !== 'TRUTH_FIRST',
  );

  return (
    <section className="relative z-10 -mt-7 px-4 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-screen-2xl">
        <form
          method="GET"
          className="marketplace-search-panel rounded-2xl border border-brand-border p-4 shadow-xl sm:p-5"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-grow">
              <Search
                size={18}
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted"
              />
              <label htmlFor="directory-query" className="sr-only">
                Search the D.C. directory
              </label>
              <input
                id="directory-query"
                type="search"
                name="query"
                placeholder="Search dispensaries, delivery, products, or neighborhoods…"
                defaultValue={filters.query}
                maxLength={DIRECTORY_QUERY_MAX_LENGTH}
                className="h-12 w-full rounded-xl border border-brand-border bg-brand-background pl-11 pr-4 text-sm text-brand-text placeholder:text-brand-muted/70 focus:border-brand-primary focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="directory-type" className="sr-only">
                Filter by retailer type
              </label>
              <select
                id="directory-type"
                name="type"
                defaultValue={filters.type}
                className="h-12 rounded-xl border border-brand-border bg-brand-background px-3 text-xs font-semibold text-brand-text focus:border-brand-primary focus:outline-none"
              >
                <option value="">Dispensaries &amp; delivery</option>
                <option value="storefront">Storefronts</option>
                <option value="delivery">Delivery services</option>
              </select>

              <label htmlFor="directory-status" className="sr-only">
                Filter by data status
              </label>
              <select
                id="directory-status"
                name="status"
                defaultValue={filters.status}
                className="h-12 rounded-xl border border-brand-border bg-brand-background px-3 text-xs font-semibold text-brand-text focus:border-brand-primary focus:outline-none"
              >
                <option value="">All data states</option>
                <option value="VERIFIED_CURRENT">Verified current</option>
                <option value="AWAITING_VERIFICATION">Awaiting verification</option>
                <option value="DEMONSTRATION_ONLY">Demonstration only</option>
                <option value="STALE">Stale</option>
                <option value="DISPUTED">Disputed</option>
              </select>

              <label htmlFor="directory-sort" className="sr-only">
                Sort retailer listings
              </label>
              <select
                id="directory-sort"
                name="sort"
                defaultValue={filters.sort}
                className="h-12 rounded-xl border border-brand-border bg-brand-background px-3 text-xs font-semibold text-brand-text focus:border-brand-primary focus:outline-none"
              >
                <option value="TRUTH_FIRST">Truth-first</option>
                <option value="RECENTLY_UPDATED">Recently updated</option>
                <option value="NAME_ASC">Name A-Z</option>
                <option value="NEAREST">Nearest first</option>
              </select>

              <button
                type="submit"
                className="h-12 rounded-xl bg-brand-primary px-6 text-xs font-bold text-black transition-transform hover:-translate-y-0.5"
              >
                Search
              </button>
              {hasFilters && (
                <Link
                  href="/"
                  className="px-2 py-2 text-xs font-semibold text-brand-muted hover:text-brand-text"
                >
                  Clear
                </Link>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-border pt-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-muted">
              Popular:
            </span>
            {Object.entries(DC_NEIGHBORHOOD_MAP)
              .slice(0, 5)
              .map(([key, item]) => {
                const isActive = filters.neighborhood === key;
                return (
                  <Link
                    key={key}
                    href={directorySearchHref(
                      {
                        ...filters,
                        neighborhood: isActive ? '' : key,
                      },
                      1,
                    )}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      isActive
                        ? 'border-brand-primary bg-brand-primary text-black'
                        : 'border-brand-border bg-brand-background text-brand-muted hover:border-brand-primary/50 hover:text-brand-text'
                    }`}
                  >
                    <MapPin size={11} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            <Link
              href={directorySearchHref(
                {
                  ...filters,
                  status:
                    filters.status === 'VERIFIED_CURRENT'
                      ? ''
                      : 'VERIFIED_CURRENT',
                },
                1,
              )}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors sm:ml-auto ${
                filters.status === 'VERIFIED_CURRENT'
                  ? 'border-brand-primary bg-brand-primary text-black'
                  : 'border-brand-border bg-brand-background text-brand-muted hover:border-brand-primary/50 hover:text-brand-text'
              }`}
            >
              <BadgeCheck size={12} aria-hidden="true" />
              Verified current only
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
