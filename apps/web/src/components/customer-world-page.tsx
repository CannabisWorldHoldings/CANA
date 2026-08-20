import Link from 'next/link';
import { ArrowRight, BadgeDollarSign, Link2, Route } from 'lucide-react';
import CustomerWorldResults, { type CustomerWorld, type HomeModule } from '@/components/customer-world-results';
import Rail, { RailItem } from '@/components/rail';
import SmartImage from '@/components/smart-image';
import { customerWorldViewHref } from '@/lib/customer-world.mjs';
import { chipLabel, publicWorldStateLabel } from '@/lib/label-vocabulary.mjs';

const JOURNEY_COPY = {
  HOME: {
    eyebrow: 'Local discovery',
    title: 'Cannabis discovery without the guesswork.',
    description: 'Find dispensaries, delivery, and current deals — every result backed by a named source, every unknown labeled honestly.',
    action: '/search',
    placeholder: 'City or neighborhood',
  },
  SEARCH: {
    eyebrow: 'Search',
    title: 'Search verified cannabis businesses.',
    description: 'Ask in your own words. Results come only from current, verified records — sources and freshness included.',
    action: '/search',
    placeholder: 'City, neighborhood, or what you are looking for',
  },
  DELIVERY: {
    eyebrow: 'Delivery',
    title: 'See who actually delivers to you.',
    description: "A verified business record doesn't prove delivery range, fees, minimums, stock, or timing. We show what's verified and label the rest unknown.",
    action: '/delivery',
    placeholder: 'City or neighborhood for delivery',
  },
  DISPENSARIES: {
    eyebrow: 'Dispensaries',
    title: 'Find licensed dispensaries near you.',
    description: 'Every result carries its source and when it was last checked. Hours, stock, and popularity stay unknown until proven.',
    action: '/dispensaries',
    placeholder: 'City or neighborhood for dispensaries',
  },
} as const;

const HOME_ASSETS = {
  hero: 'marketplace.hero.v2',
  storefront: 'marketplace.retailer.1',
  delivery: 'home.delivery',
  dc: 'home.dc',
} as const;

const CATEGORIES = [
  { href: '/products?category=flower', label: 'Flower', assetId: 'home.category.flower' },
  { href: '/products?category=edibles', label: 'Edibles', assetId: 'home.category.edibles' },
  { href: '/products?category=vapes', label: 'Vapes', assetId: 'home.category.vapes' },
  { href: '/products?category=concentrates', label: 'Concentrates', assetId: 'home.category.concentrates' },
  { href: '/products?category=pre-rolls', label: 'Pre-rolls', assetId: 'home.category.pre-rolls' },
  { href: '/products?category=topicals', label: 'Topicals', assetId: 'home.category.topicals' },
  { href: '/products?category=accessories', label: 'Accessories', assetId: 'home.category.accessories' },
] as const;

function MarketSearch({ marketId }: { marketId: string }) {
  return (
    <form action="/search" method="GET" className="owd-home-search">
      <label htmlFor="home-market-query" className="sr-only">Ask ORDERWEEDDC what you are looking for</label>
      <input
        id="home-market-query"
        name="query"
        type="search"
        maxLength={160}
        placeholder="Ask ORDERWEEDDC…"
        autoComplete="off"
      />
      <input type="hidden" name="market" value={marketId} />
      <button type="submit">Ask ORDERWEEDDC</button>
    </form>
  );
}

function homeModule(world: CustomerWorld, kind: string): HomeModule | null {
  const modules = world.home_modules?.modules;
  if (!Array.isArray(modules)) return null;
  const found = modules.find((m) => m?.kind === kind);
  if (!found || !Array.isArray(found.items) || found.items.length === 0) return null;
  return found;
}

function shortDate(iso: string | undefined) {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

/**
 * Evidence-bound home modules (W-1b). Each section renders ONLY when the
 * market-page compiler produced eligible items from verified records —
 * absence stays absence, so the editorial scenes carry the page alone until
 * real verified supply exists. No placeholders, no filler, no invented facts.
 */
function HomeDealsNow({ world }: { world: CustomerWorld }) {
  const mod = homeModule(world, 'deals');
  if (!mod) return null;
  return (
    <section className="owd-container-commerce py-12" aria-labelledby="now-heading">
      <h2 id="now-heading" className="owd-h2">
        Happening now. <span className="owd-quiet">Verified offers, ending soonest first.</span>
      </h2>
      <Rail label="Current verified deals" itemCount={mod.items!.length} minItems={1}>
        {mod.items!.map((deal) => (
          <RailItem key={String(deal.id)}>
            <article className="flex h-full min-w-[300px] max-w-[340px] flex-col gap-2 rounded-[20px] border border-brand-border bg-brand-surface p-6">
              <p className="owd-eyebrow">{String(deal.merchant_name ?? '')}</p>
              <h3 className="owd-h3">{String(deal.title ?? '')}</h3>
              <p className="text-sm text-brand-muted">
                {typeof deal.price_usd === 'number' ? `$${deal.price_usd}` : null}
                {deal.expires_at && shortDate(deal.expires_at) ? ` · through ${shortDate(deal.expires_at)}` : null}
              </p>
              <p className="mt-auto"><span className="tint-chip">{chipLabel('VERIFIED')}</span></p>
            </article>
          </RailItem>
        ))}
      </Rail>
    </section>
  );
}

function HomeStorefronts({ world }: { world: CustomerWorld }) {
  const mod = homeModule(world, 'dispensaries');
  if (!mod) return null;
  return (
    <section className="owd-container-commerce py-12" aria-labelledby="storefronts-heading">
      <h2 id="storefronts-heading" className="owd-h2">
        Storefronts worth exploring. <span className="owd-quiet">Licensed, current, and sourced.</span>
      </h2>
      <Rail label="Verified dispensaries" itemCount={mod.items!.length} minItems={1}>
        {mod.items!.map((merchant) => (
          <RailItem key={String(merchant.merchant_id)}>
            <Link
              href={`/merchant/${encodeURIComponent(String(merchant.merchant_id))}`}
              className="flex h-full min-w-[280px] max-w-[320px] flex-col gap-2 rounded-[20px] border border-brand-border bg-brand-surface p-6"
            >
              <h3 className="owd-h3">{String(merchant.name ?? '')}</h3>
              {merchant.neighborhood ? (
                <p className="text-sm text-brand-muted">{String(merchant.neighborhood)}</p>
              ) : null}
              <p className="mt-auto"><span className="tint-chip">{chipLabel('VERIFIED')}</span></p>
            </Link>
          </RailItem>
        ))}
      </Rail>
    </section>
  );
}

function HomeDeliveryNow({ world }: { world: CustomerWorld }) {
  const mod = homeModule(world, 'delivery_services');
  if (!mod) return null;
  return (
    <section className="owd-container-commerce py-12" aria-labelledby="delivery-now-heading">
      <h2 id="delivery-now-heading" className="owd-h2">
        Delivery, honestly scoped. <span className="owd-quiet">Coverage shown only when verified.</span>
      </h2>
      <Rail label="Verified delivery services" itemCount={mod.items!.length} minItems={1}>
        {mod.items!.map((service) => (
          <RailItem key={String(service.merchant_id)}>
            <Link
              href={`/merchant/${encodeURIComponent(String(service.merchant_id))}`}
              className="flex h-full min-w-[280px] max-w-[320px] flex-col gap-2 rounded-[20px] border border-brand-border bg-brand-surface p-6"
            >
              <h3 className="owd-h3">{String(service.name ?? '')}</h3>
              {Array.isArray(service.facts?.serves) && service.facts!.serves!.length > 0 ? (
                <p className="text-sm text-brand-muted">Serves {service.facts!.serves!.slice(0, 3).join(', ')}</p>
              ) : (
                <p className="text-sm text-brand-muted">Coverage confirmed per address at handoff.</p>
              )}
              <p className="mt-auto"><span className="tint-chip">{chipLabel('VERIFIED')}</span></p>
            </Link>
          </RailItem>
        ))}
      </Rail>
    </section>
  );
}

function CustomerHome({
  world,
  illustrativeArtCapability,
}: {
  world: CustomerWorld;
  illustrativeArtCapability: object | null;
}) {
  return (
    <div className="owd-home">
      <section className="owd-home-hero" aria-labelledby="home-title">
        <div className="owd-home-hero__media" aria-hidden="true">
          <SmartImage
            assetId={HOME_ASSETS.hero}
            context="hero-ambience"
            alt=""
            fill
            priority
            pendingRightsCapability={illustrativeArtCapability}
            sizes="(max-width: 734px) 100vw, 1680px"
            className="owd-home-hero__image"
          />
        </div>
        <div className="owd-container-commerce owd-home-hero__copy">
          <p className="owd-eyebrow">Ask ORDERWEEDDC</p>
          <h1 id="home-title" className="owd-display">What are you<br />looking for?</h1>
          <p className="owd-intro">
            Describe what you need in ordinary words. We check the verified
            D.C. market and show what{"'"}s known — and exactly what isn{"'"}t.
          </p>
          <MarketSearch marketId={world.request.market_id} />
          <p className="owd-home-search-examples">
            Try “Something near Dupont Circle tonight,” “Dispensaries near Capitol Hill,”
            or “What can I actually verify near me?”
          </p>
          <nav aria-label="Featured ways to shop" className="owd-home-hero__links">
            <Link href="/dispensaries">Browse dispensaries <ArrowRight size={15} aria-hidden="true" /></Link>
            <Link href="/delivery">Explore delivery <ArrowRight size={15} aria-hidden="true" /></Link>
          </nav>
        </div>
      </section>

      <div className="owd-home-categories">
        <Rail
          label="Browse by product format"
          sublabel="Start with a familiar format."
          itemCount={CATEGORIES.length}
          minItems={1}
        >
          {CATEGORIES.map((category) => (
            <RailItem key={category.href}>
              <Link href={category.href} className="owd-home-category">
                <span className="owd-home-category__media" data-label={category.label} aria-hidden="true">
                  <SmartImage
                    assetId={category.assetId}
                    context="category-navigation"
                    alt=""
                    fill
                    pendingRightsCapability={illustrativeArtCapability}
                    sizes="112px"
                  />
                </span>
                <span>{category.label}</span>
              </Link>
            </RailItem>
          ))}
        </Rail>
      </div>

      <HomeDealsNow world={world} />

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
              <SmartImage
                assetId={HOME_ASSETS.storefront}
                context="campaign-ambience"
                alt=""
                fill
                pendingRightsCapability={illustrativeArtCapability}
                sizes="(max-width: 734px) 87vw, 700px"
              />
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
              <SmartImage
                assetId={HOME_ASSETS.delivery}
                context="campaign-ambience"
                alt=""
                fill
                pendingRightsCapability={illustrativeArtCapability}
                sizes="(max-width: 734px) 87vw, 560px"
              />
            </span>
          </Link>
        </div>
      </section>

      <HomeStorefronts world={world} />
      <HomeDeliveryNow world={world} />

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
            <SmartImage
              assetId={HOME_ASSETS.dc}
              context="district-feature"
              alt=""
              fill
              pendingRightsCapability={illustrativeArtCapability}
              sizes="(max-width: 734px) 100vw, 760px"
            />
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
            <p>Every record keeps its named source and current evidence state.</p>
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
  illustrativeArtCapability = null,
}: {
  world: CustomerWorld;
  isCanonicalBrand?: boolean;
  illustrativeArtCapability?: object | null;
}) {
  if (world.request.journey === 'HOME' && isCanonicalBrand) {
    return (
      <CustomerHome
        world={world}
        illustrativeArtCapability={illustrativeArtCapability}
      />
    );
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
              <p className="text-sm font-bold text-brand-text" data-world-state={world.state}>{publicWorldStateLabel(world.state)}</p>
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
