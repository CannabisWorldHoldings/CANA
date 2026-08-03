import Link from 'next/link';
import { ArrowRight, CalendarDays } from 'lucide-react';
import CustomerListingRow, { type CustomerListing } from '@/components/customer-listing-row';

type DealPreview = {
  id: string;
  title: string;
  description: string | null;
  discount: string | null;
  expiryDate: Date;
  isDemonstration: boolean;
  dataSource: string;
  retailer: { id: string; name: string; type: string; isDemonstration: boolean };
};

function SectionHeading({
  eyebrow,
  title,
  description,
  href,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">{eyebrow}</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-semibold tracking-[-0.04em] text-[#111612] sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#606a63]">{description}</p>
      </div>
      <Link href={href} className="inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35] hover:text-[#073e25]">
        {action}<ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function CustomerHomeMarket({
  deals,
  delivery,
  dispensaries,
}: {
  deals: DealPreview[];
  delivery: CustomerListing[];
  dispensaries: CustomerListing[];
}) {
  return (
    <>
      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <SectionHeading
          eyebrow="Current offers"
          title="Deals with an end date, not an open-ended promise."
          description="Only active, unexpired records appear. Demonstration offers stay visibly non-redeemable."
          href="/deals"
          action="View all current offers"
        />
        {deals.length === 0 ? (
          <p role="status" className="mt-10 max-w-xl py-8 text-sm leading-relaxed text-[#667069]">No current offer records are available. Nothing is substituted or estimated.</p>
        ) : (
          <div className="mt-9 grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-8 overflow-x-auto pb-4 sm:auto-cols-[minmax(20rem,1fr)] lg:grid-flow-row lg:grid-cols-3 xl:grid-cols-5">
            {deals.map((deal) => (
              <article key={deal.id} className="min-w-0 py-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7a4b10]">
                  {deal.isDemonstration ? 'Demo offer · not redeemable' : deal.discount ?? 'Offer terms recorded'}
                </p>
                <h3 className="mt-3 font-display text-xl font-semibold leading-snug tracking-[-0.025em] text-[#151b16]">{deal.title}</h3>
                {deal.description && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#626b65]">{deal.description}</p>}
                <p className="mt-4 text-sm font-semibold text-[#303a32]">{deal.retailer.name}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#717a74]">
                  <CalendarDays size={13} aria-hidden="true" /> Ends {deal.expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <Link href={`/retailer/${deal.retailer.id}`} className="mt-4 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">View business record</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <SectionHeading
          eyebrow="Delivery in Washington, D.C."
          title="Delivery gets its own front door."
          description="Browse delivery participants without assuming that every address is eligible or every fee, minimum and arrival time is known."
          href="/delivery"
          action="View delivery options"
        />
        <div className="mt-8 grid gap-x-12 gap-y-8 xl:grid-cols-2">
          {delivery.length ? delivery.map((item, index) => <CustomerListingRow key={item.id} listing={item} index={index} />) : <p className="py-10 text-sm text-[#667069]">No delivery records are available in this data state.</p>}
        </div>
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <SectionHeading
          eyebrow="Dispensaries in Washington, D.C."
          title="Storefront discovery with the source kept close."
          description="See supported menu, offer and freshness signals before opening a full business record."
          href="/dispensaries"
          action="View dispensaries"
        />
        {dispensaries.length ? (
          <form action="/compare" method="get" className="mt-8">
            <div className="grid gap-x-12 gap-y-8 xl:grid-cols-2">
              {dispensaries.map((item, index) => (
                <CustomerListingRow
                  key={item.id}
                  listing={item}
                  index={index + 2}
                  comparisonSelectable
                />
              ))}
            </div>
            <button
              type="submit"
              className="mt-5 min-h-11 rounded-lg bg-[#11643d] px-5 py-3 text-sm font-bold text-white hover:bg-[#0c4f30]"
            >
              Compare selected records
            </button>
          </form>
        ) : (
          <p className="mt-8 py-10 text-sm text-[#667069]">No dispensary records are available in this data state.</p>
        )}
      </section>
    </>
  );
}
