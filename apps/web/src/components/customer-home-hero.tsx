import Link from 'next/link';
import { ArrowRight, MapPin, Search } from 'lucide-react';

const QUICK_PATHS = [
  { href: '/delivery', label: 'Delivery' },
  { href: '/dispensaries', label: 'Dispensaries' },
  { href: '/deals', label: 'Deals' },
  { href: '/products?category=flower', label: 'Flower' },
  { href: '/products?category=edibles', label: 'Edibles' },
  { href: '/neighborhoods/navy-yard-wharf', label: 'Navy Yard' },
  { href: '/neighborhoods/dupont-circle', label: 'Dupont Circle' },
];

export default function CustomerHomeHero({ demonstration }: { demonstration: boolean }) {
  return (
    <section className="mx-auto w-full max-w-screen-2xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20 lg:px-10 lg:pb-20 lg:pt-24">
      <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">
            Washington, D.C. marketplace guide
          </p>
          <h1 className="mt-5 max-w-4xl font-display text-5xl font-semibold leading-[0.94] tracking-[-0.06em] text-[#101511] sm:text-6xl lg:text-7xl">
            A clearer way to find cannabis in D.C.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#59645d] sm:text-lg">
            Find dispensaries, delivery participants, products, current deals and neighborhood guides with the important data state kept in view.
          </p>
        </div>

        <div id="search">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#3f4a43]">
            <MapPin size={17} className="text-[#0b5b35]" aria-hidden="true" />
            Searching Washington, D.C.
          </div>
          <form action="/search" method="GET" className="mt-4">
            <label htmlFor="marketplace-search" className="sr-only">Search the D.C. marketplace</label>
            <div className="relative">
              <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6d766f]" aria-hidden="true" />
              <input
                id="marketplace-search"
                name="query"
                type="search"
                maxLength={80}
                placeholder="Business, product, deal or neighborhood"
                className="min-h-14 w-full rounded-xl border border-[#bdc5bf] bg-white pl-12 pr-32 text-base text-[#111612] placeholder:text-[#737c76] focus:border-[#11643d] focus:outline-none"
              />
              <button type="submit" className="absolute right-1.5 top-1.5 min-h-11 rounded-lg bg-[#11643d] px-5 text-sm font-bold text-white hover:bg-[#0c4f30]">
                Search
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-[#68716b]">
            Search results are grouped by record type. A result is not a claim of current availability.
          </p>
        </div>
      </div>

      <nav aria-label="Quick discovery" className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
        {QUICK_PATHS.map((path) => (
          <Link key={path.href} href={path.href} className="inline-flex min-h-11 items-center gap-1.5 py-2 text-sm font-bold text-[#273129] hover:text-[#0b5b35]">
            {path.label}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      {demonstration && (
        <p role="note" className="mt-8 max-w-4xl rounded-lg bg-[#fff6dc] px-4 py-3 text-xs font-semibold leading-relaxed text-[#59430c]">
          Review data state: visible businesses, coordinates, menus, prices, offers and articles are synthetic unless a record explicitly says otherwise. Demonstration offers are not redeemable.
        </p>
      )}
    </section>
  );
}
