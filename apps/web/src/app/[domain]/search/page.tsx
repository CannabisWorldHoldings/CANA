import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { DataStatusBadge } from '@/components/data-status-badge';
import { loadCustomerSearch, normalizeCustomerQuery } from '@/lib/customer-marketplace-data';

export const metadata = {
  title: 'Search the D.C. marketplace',
  robots: { index: false, follow: true },
};

export default async function CustomerSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const query = normalizeCustomerQuery(filters.query);
  const result = await loadCustomerSearch(domain, query);
  if (!result) return notFound();

  const total = result.retailers.length + result.products.length + result.deals.length + result.neighborhoods.length;

  return (
    <div className="customer-marketplace flex-grow bg-white text-[#111612]">
      <section className="mx-auto max-w-screen-2xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-10 lg:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Marketplace search</p>
        <h1 className="mt-4 max-w-4xl font-display text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Search records without blending what they mean.</h1>
        <form action="/search" method="GET" className="mt-8 max-w-3xl">
          <label htmlFor="search-query" className="sr-only">Search businesses, products, deals and neighborhoods</label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#69736c]" aria-hidden="true" />
            <input id="search-query" name="query" type="search" maxLength={80} defaultValue={query} placeholder="Business, product, deal or neighborhood" className="min-h-14 w-full rounded-xl border border-[#bdc5bf] bg-white pl-12 pr-32 text-base focus:border-[#11643d] focus:outline-none" />
            <button type="submit" className="absolute right-1.5 top-1.5 min-h-11 rounded-lg bg-[#11643d] px-5 text-sm font-bold text-white hover:bg-[#0c4f30]">Search</button>
          </div>
        </form>
        <p role="status" className="mt-4 text-sm text-[#68716b]">
          {query ? `${total} grouped result${total === 1 ? '' : 's'} for “${query}”.` : 'Enter a search term to begin.'}
        </p>
      </section>

      {query && total === 0 && (
        <section className="mx-auto max-w-screen-2xl px-4 py-16 sm:px-6 lg:px-10">
          <h2 className="font-display text-2xl font-semibold">No stored records match this search.</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#667069]">This is a repository result, not evidence that an option is unavailable in the real world.</p>
        </section>
      )}

      {result.retailers.length > 0 && (
        <section className="mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.035em]">Businesses</h2>
          <div className="mt-7 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {result.retailers.map((retailer) => (
              <article key={retailer.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#59645d]">{retailer.type === 'delivery' ? 'Delivery service' : 'Dispensary storefront'}</p>
                  <DataStatusBadge dataStatus={retailer.dataStatus} isDemonstration={retailer.isDemonstration} verifiedAt={retailer.verifiedAt} freshnessExpiresAt={retailer.freshnessExpiresAt} compact />
                </div>
                <h3 className="mt-3 font-display text-xl font-semibold">{retailer.name}</h3>
                <p className="mt-2 text-sm text-[#667069]">{retailer.isDemonstration ? 'Demonstration record · not a real business claim.' : `Source: ${retailer.dataSource}`}</p>
                <Link href={`/retailer/${retailer.id}`} className="mt-3 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">View labeled record</Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {result.products.length > 0 && (
        <section className="mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.035em]">Products</h2>
          <div className="mt-7 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            {result.products.map((product) => (
              <article key={product.id} className="py-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#59645d]">{product.category}</p>
                <h3 className="mt-2 font-display text-xl font-semibold">{product.name}</h3>
                <p className="mt-2 text-sm text-[#667069]">{product.isDemonstration ? 'Demonstration product record · availability not claimed.' : `Source: ${product.dataSource}`}</p>
                <Link href={`/products?query=${encodeURIComponent(product.name)}`} className="mt-3 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">Open product search</Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {result.deals.length > 0 && (
        <section className="mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.035em]">Current offers</h2>
          <div className="mt-7 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            {result.deals.map((deal) => (
              <article key={deal.id} className="py-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#7a4b10]">{deal.isDemonstration ? 'Demo · not redeemable' : 'Current record'}</p>
                <h3 className="mt-2 font-display text-xl font-semibold">{deal.title}</h3>
                <p className="mt-2 text-sm text-[#667069]">{deal.retailer.name} · ends {deal.expiryDate.toLocaleDateString()}</p>
                <Link href={`/retailer/${deal.retailer.id}`} className="mt-3 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">View business record</Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {result.neighborhoods.length > 0 && (
        <section className="mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 lg:px-10">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.035em]">Neighborhoods</h2>
          <div className="mt-7 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {result.neighborhoods.map((neighborhood) => (
              <article key={neighborhood.slug} className="py-2">
                <h3 className="font-display text-xl font-semibold">{neighborhood.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#667069]">{neighborhood.blurb}</p>
                <Link href={`/neighborhoods/${neighborhood.slug}`} className="mt-3 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">Open neighborhood guide</Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
