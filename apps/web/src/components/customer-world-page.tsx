import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BadgeDollarSign, Link2, Route } from 'lucide-react';
import CustomerWorldResults, { type CustomerWorld } from '@/components/customer-world-results';
import { getAsset } from '@/lib/asset-registry.mjs';
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

function registeredAssetPath(id: string): string {
  const asset = getAsset(id);
  if (!asset) throw new Error(`missing registered homepage asset: ${id}`);
  return asset.path;
}

const HOME_ASSETS = {
  hero: registeredAssetPath('marketplace.hero.v2'),
  storefront: registeredAssetPath('marketplace.retailer.1'),
  delivery: registeredAssetPath('home.delivery'),
  dc: registeredAssetPath('home.dc'),
} as const;

const CATEGORIES = [
  { href: '/products?category=flower', label: 'Flower', image: registeredAssetPath('home.category.flower') },
  { href: '/products?category=edibles', label: 'Edibles', image: registeredAssetPath('home.category.edibles') },
  { href: '/products?category=vapes', label: 'Vapes', image: registeredAssetPath('home.category.vapes') },
  { href: '/products?category=concentrates', label: 'Concentrates', image: registeredAssetPath('home.category.concentrates') },
  { href: '/products?category=pre-rolls', label: 'Pre-rolls', image: registeredAssetPath('home.category.pre-rolls') },
  { href: '/products?category=topicals', label: 'Topicals', image: registeredAssetPath('home.category.topicals') },
  { href: '/products?category=accessories', label: 'Accessories', image: registeredAssetPath('home.category.accessories') },
] as const;

function MarketSearch({ marketId }: { marketId: string }) {
  return (
    <form action="/search" method="GET" className="owd-home-search">
      <label htmlFor="home-market-query" className="sr-only">Search by city or neighborhood</label>
      <input
        id="home-market-query"
        name="query"
        type="search"
        maxLength={160}
        placeholder="Try Dupont Circle or Adams Morgan"
        autoComplete="postal-code"
      />
      <input type="hidden" name="market" value={marketId} />
      <button type="submit">Search</button>
    </form>
  );
}

function CustomerHome({ world }: { world: CustomerWorld }) {
  return (
    <div className="owd-home">
      <section className="owd-home-hero" aria-labelledby="home-title">
        <div className="owd-home-hero__media" aria-hidden="true">
          <Image
            src={HOME_ASSETS.hero}
            alt=""
            fill
            priority
            unoptimized
            sizes="(max-width: 734px) 100vw, 1680px"
            className="owd-home-hero__image"
          />
        </div>
        <div className="owd-container-commerce owd-home-hero__copy">
          <p className="owd-eyebrow">Washington, D.C.</p>
          <h1 id="home-title" className="owd-display">D.C. cannabis.<br />Clearer choices.</h1>
          <p className="owd-intro">
            Find dispensaries, explore delivery, and browse product formats with
            sources and unknowns kept in view.
          </p>
          <MarketSearch marketId={world.request.market_id} />
          <nav aria-label="Featured ways to shop" className="owd-home-hero__links">
            <Link href="/dispensaries">Browse dispensaries <ArrowRight size={15} aria-hidden="true" /></Link>
            <Link href="/delivery">Explore delivery <ArrowRight size={15} aria-hidden="true" /></Link>
          </nav>
        </div>
      </section>

      <nav aria-label="Browse product categories" className="owd-home-categories">
        <div className="owd-home-categories__rail">
          {CATEGORIES.map((category) => (
            <Link key={category.href} href={category.href} className="owd-home-category">
              <Image src={category.image} alt="" width={120} height={120} sizes="120px" unoptimized />
              <span>{category.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <section className="owd-home-program owd-container-commerce" aria-labelledby="shop-heading">
        <h2 id="shop-heading" className="owd-h2">
          Shop the market. <span className="owd-quiet">Start with what you need.</span>
        </h2>
        <div className="owd-home-campaigns">
          <Link href="/dispensaries" className="owd-home-campaign owd-home-campaign--store">
            <span className="owd-home-campaign__copy">
              <span className="owd-eyebrow">Dispensaries</span>
              <span className="owd-h3">Browse in person.</span>
              <span className="owd-body-reduced">Find regulator-backed merchant records by place.</span>
              <span className="owd-home-campaign__action">Explore storefronts <ArrowRight size={15} aria-hidden="true" /></span>
            </span>
            <span className="owd-home-campaign__media" aria-hidden="true">
              <Image src={HOME_ASSETS.storefront} alt="" fill sizes="(max-width: 734px) 87vw, 700px" unoptimized />
            </span>
          </Link>
          <Link href="/delivery" className="owd-home-campaign owd-home-campaign--delivery">
            <span className="owd-home-campaign__copy">
              <span className="owd-eyebrow">Delivery</span>
              <span className="owd-h3">See what can be supported.</span>
              <span className="owd-body-reduced">No invented fees, service areas, inventory, or arrival times.</span>
              <span className="owd-home-campaign__action">Explore delivery <ArrowRight size={15} aria-hidden="true" /></span>
            </span>
            <span className="owd-home-campaign__media" aria-hidden="true">
              <Image src={HOME_ASSETS.delivery} alt="" fill sizes="(max-width: 734px) 87vw, 560px" unoptimized />
            </span>
          </Link>
        </div>
      </section>

      <section className="owd-home-district" aria-labelledby="district-heading">
        <div className="owd-container-commerce owd-home-district__inner">
          <div className="owd-home-district__copy">
            <p className="owd-eyebrow">Built for the District</p>
            <h2 id="district-heading" className="owd-h1">Local discovery should feel local.</h2>
            <p className="owd-intro">
              Neighborhood context, D.C. guidance, and market truth belong in one
              calm place without turning the customer experience into a dashboard.
            </p>
            <Link href="/neighborhoods">Explore neighborhoods <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          <div className="owd-home-district__media" aria-hidden="true">
            <Image src={HOME_ASSETS.dc} alt="" fill sizes="(max-width: 734px) 100vw, 760px" unoptimized />
          </div>
        </div>
      </section>

      <section className="owd-home-trust owd-container-story" aria-labelledby="trust-heading">
        <h2 id="trust-heading" className="owd-h2">
          Easy to explore. <span className="owd-quiet">Honest about the gaps.</span>
        </h2>
        <div className="owd-home-trust__grid">
          <article>
            <Link2 aria-hidden="true" />
            <h3>Sources stay attached.</h3>
            <p>Records keep their admitted source and current evidence state.</p>
          </article>
          <article>
            <Route aria-hidden="true" />
            <h3>Delivery stays distinct.</h3>
            <p>A merchant listing never silently becomes a delivery promise.</p>
          </article>
          <article>
            <BadgeDollarSign aria-hidden="true" />
            <h3>Sponsorship stays labeled.</h3>
            <p>Commercial placement does not silently rewrite organic order.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function CustomerWorldPage({
  world,
  isCanonicalBrand = false,
}: {
  world: CustomerWorld;
  isCanonicalBrand?: boolean;
}) {
  if (world.request.journey === 'HOME' && isCanonicalBrand) {
    return <CustomerHome world={world} />;
  }

  const copy = JOURNEY_COPY[world.request.journey];
  const mapView = world.request.requested_view === 'map';
  return (
    <div className="flex-grow">
      <section className="border-b border-brand-border px-4 py-12 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-screen-2xl">
          <p className="kicker">{copy.eyebrow}</p>
          <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">{copy.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-brand-muted">{copy.description}</p>
          <form action={copy.action} method="GET" className="mt-7 flex max-w-4xl flex-col gap-3 sm:flex-row">
            <label htmlFor="customer-world-query" className="sr-only">Customer discovery query</label>
            <input id="customer-world-query" name="query" type="search" maxLength={160} defaultValue={world.request.customer_query} placeholder={copy.placeholder} className="min-h-12 flex-grow rounded-xl border border-brand-border bg-brand-background px-4 text-base text-brand-text" />
            <label htmlFor="customer-world-market" className="sr-only">Market</label>
            <select id="customer-world-market" name="market" defaultValue={world.request.market_id} className="min-h-12 rounded-xl border border-brand-border bg-brand-background px-4 text-sm font-semibold text-brand-text">
              <option value="US-DC">Washington, D.C.</option>
              <option value="US-MD">Maryland</option>
              <option value="US-VA">Virginia</option>
            </select>
            <input type="hidden" name="view" value={world.request.requested_view} />
            <button type="submit" className="min-h-12 rounded-xl bg-brand-primary-fill-strong px-6 text-sm font-bold text-white">Discover</button>
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
