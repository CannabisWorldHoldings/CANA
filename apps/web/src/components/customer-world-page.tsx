import Link from 'next/link';
import CustomerWorldResults, { type CustomerWorld } from '@/components/customer-world-results';
import { customerWorldViewHref } from '@/lib/customer-world.mjs';

const JOURNEY_COPY = {
  HOME: {
    eyebrow: 'Customer World',
    title: 'One verified path from intent to discovery.',
    description: 'Search admitted market Reality, choose a distinct customer journey, and see unknowns before making a decision.',
    action: '/search',
    placeholder: 'City or neighborhood',
  },
  SEARCH: {
    eyebrow: 'Marketplace search',
    title: 'Search verified merchant records without blending truth paths.',
    description: 'ASK compiles your words, applies the selected market contract, and returns only current canonical Reality projections.',
    action: '/search',
    placeholder: 'City, neighborhood, or supported intent',
  },
  DELIVERY: {
    eyebrow: 'Delivery discovery',
    title: 'Delivery is a distinct journey, with eligibility kept honest.',
    description: 'A verified merchant record does not prove delivery authority, service area, fee, minimum, inventory, or arrival time.',
    action: '/delivery',
    placeholder: 'City or neighborhood for delivery',
  },
  DISPENSARIES: {
    eyebrow: 'Dispensary discovery',
    title: 'Find regulator-backed dispensary records by place.',
    description: 'Results carry their admitted market source and current verification state. Hours, inventory, and popularity remain unknown unless proven.',
    action: '/dispensaries',
    placeholder: 'City or neighborhood for dispensaries',
  },
} as const;

export default function CustomerWorldPage({ world }: { world: CustomerWorld }) {
  const copy = JOURNEY_COPY[world.request.journey];
  const mapView = world.request.requested_view === 'map';
  return (
    <div className="flex-grow">
      <section className="border-b border-brand-border px-4 py-12 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-screen-2xl">
          <p className="kicker">{copy.eyebrow}</p>
          <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-brand-muted">{copy.description}</p>
          <form action={copy.action} method="GET" className="mt-7 flex max-w-4xl flex-col gap-3 sm:flex-row">
            <label htmlFor="customer-world-query" className="sr-only">Customer discovery query</label>
            <input
              id="customer-world-query"
              name="query"
              type="search"
              maxLength={160}
              defaultValue={world.request.customer_query}
              placeholder={copy.placeholder}
              className="min-h-12 flex-grow rounded-xl border border-brand-border bg-brand-background px-4 text-base text-brand-text"
            />
            <label htmlFor="customer-world-market" className="sr-only">Market</label>
            <select
              id="customer-world-market"
              name="market"
              defaultValue={world.request.market_id}
              className="min-h-12 rounded-xl border border-brand-border bg-brand-background px-4 text-sm font-semibold text-brand-text"
            >
              <option value="US-DC">Washington, D.C.</option>
              <option value="US-MD">Maryland</option>
              <option value="US-VA">Virginia</option>
            </select>
            <input type="hidden" name="view" value={world.request.requested_view} />
            <button type="submit" className="min-h-12 rounded-xl bg-brand-primary-fill-strong px-6 text-sm font-bold text-white">
              Discover
            </button>
          </form>
          {world.request.journey === 'HOME' ? (
            <nav aria-label="Customer journeys" className="mt-8 grid gap-3 sm:grid-cols-3">
              <Link href="/search" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Search the market</Link>
              <Link href="/delivery" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Delivery discovery</Link>
              <Link href="/dispensaries" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Dispensary discovery</Link>
            </nav>
          ) : null}
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6 lg:px-10" aria-live="polite">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-brand-text">State: {world.state}</p>
              <p className="mt-1 max-w-3xl text-sm text-brand-muted">{world.state_explanation}</p>
            </div>
            <nav aria-label="Discovery view" className="flex rounded-xl border border-brand-border bg-brand-surface p-1">
              <Link aria-current={!mapView ? 'page' : undefined} href={customerWorldViewHref(world, 'list')} className="rounded-lg px-4 py-2 text-sm font-bold text-brand-text">List</Link>
              <Link aria-current={mapView ? 'page' : undefined} href={customerWorldViewHref(world, 'map')} className="rounded-lg px-4 py-2 text-sm font-bold text-brand-text">Map</Link>
            </nav>
          </div>

          <CustomerWorldResults world={world} mapView={mapView} />
        </div>
      </section>
    </div>
  );
}
