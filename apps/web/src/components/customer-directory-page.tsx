import Link from 'next/link';
import { MapPin, Search, SlidersHorizontal } from 'lucide-react';
import CustomerListingRow, { type CustomerListing } from '@/components/customer-listing-row';

type DirectoryMode = 'delivery' | 'dispensaries';

const COPY = {
  delivery: {
    eyebrow: 'Delivery in Washington, D.C.',
    title: 'Find delivery records without guessing the service area.',
    description:
      'Delivery businesses appear as first-class marketplace participants. Enter a neighborhood or keyword, then confirm address eligibility, fees, minimums and timing with the business when those details are not sourced here.',
    empty: 'No delivery records match this search.',
    alternativeHref: '/dispensaries',
    alternativeLabel: 'Browse dispensaries instead',
  },
  dispensaries: {
    eyebrow: 'Dispensaries in Washington, D.C.',
    title: 'Start with the details that help you choose a storefront.',
    description:
      'Browse source-labeled storefront records. Menu, deal and freshness language only appears when the repository has a supporting record.',
    empty: 'No dispensary records match this search.',
    alternativeHref: '/delivery',
    alternativeLabel: 'Browse delivery instead',
  },
} as const;

export default function CustomerDirectoryPage({
  mode,
  query,
  listings,
}: {
  mode: DirectoryMode;
  query: string;
  listings: CustomerListing[];
}) {
  const copy = COPY[mode];
  const action = mode === 'delivery' ? '/delivery' : '/dispensaries';

  return (
    <div className="customer-marketplace flex-grow bg-white text-[#111612]">
      <section className="mx-auto max-w-screen-2xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-10 lg:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">{copy.eyebrow}</p>
        <h1 className="mt-4 max-w-4xl font-display text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
          {copy.title}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-[#59645d] sm:text-lg">{copy.description}</p>
      </section>

      <section aria-label="Search and filters" className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-10">
        <details className="group" open>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-bold text-[#172019] marker:hidden">
            <SlidersHorizontal size={17} aria-hidden="true" />
            Search {mode === 'delivery' ? 'delivery' : 'dispensaries'}
          </summary>
          <form action={action} method="GET" className="mt-3 flex max-w-3xl flex-col gap-3 sm:flex-row">
            <label htmlFor={`${mode}-query`} className="sr-only">Search by business, neighborhood, city or ZIP</label>
            <div className="relative flex-grow">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6d766f]" size={18} aria-hidden="true" />
              <input
                id={`${mode}-query`}
                name="query"
                type="search"
                defaultValue={query}
                maxLength={80}
                placeholder="Business, neighborhood, city or ZIP"
                className="min-h-12 w-full rounded-lg border border-[#cbd1cc] bg-white pl-11 pr-4 text-base text-[#111612] placeholder:text-[#727b75] focus:border-[#11643d] focus:outline-none"
              />
            </div>
            <button type="submit" className="min-h-12 rounded-lg bg-[#11643d] px-6 text-sm font-bold text-white hover:bg-[#0c4f30]">
              Search
            </button>
            {query && (
              <Link href={action} className="inline-flex min-h-12 items-center justify-center px-3 text-sm font-semibold text-[#59645d] hover:text-[#111612]">
                Clear
              </Link>
            )}
          </form>
        </details>
      </section>

      <section aria-labelledby={`${mode}-results-heading`} className="mx-auto w-full max-w-screen-2xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#59645d]">
              <MapPin size={13} aria-hidden="true" /> Washington, D.C.
            </p>
            <h2 id={`${mode}-results-heading`} className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em]">
              {query ? `Results for “${query}”` : 'Source-labeled records'}
            </h2>
          </div>
          <p className="text-sm text-[#6a736d]">{listings.length} shown</p>
        </div>

        {listings.length === 0 ? (
          <div role="status" className="max-w-2xl py-16">
            <h3 className="font-display text-2xl font-semibold">{copy.empty}</h3>
            <p className="mt-3 text-sm leading-relaxed text-[#626c65]">
              Try a broader term. A missing result is not evidence that a business or service is unavailable in the real world.
            </p>
            <Link href={copy.alternativeHref} className="mt-5 inline-flex min-h-11 items-center font-bold text-[#0b5b35]">
              {copy.alternativeLabel}
            </Link>
          </div>
        ) : (
          <div className="mt-7 grid gap-x-12 gap-y-8 xl:grid-cols-2">
            {listings.map((listing, index) => (
              <CustomerListingRow key={listing.id} listing={listing} index={index} />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10">
        <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-[-0.035em]">
          {mode === 'delivery' ? 'What “confirm service area” means' : 'What a status label means'}
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#5e6861]">
          {mode === 'delivery'
            ? 'The current data model does not prove whether an address is eligible, what a fee or minimum will be, or when an order could arrive. ORDERWEEDDC keeps those fields unavailable until a source supports them.'
            : 'A label describes the evidence stored for that record. It does not guarantee inventory, hours, licensing, or availability beyond the stated source and freshness window.'}
        </p>
      </section>
    </div>
  );
}
