import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { DataStatusBadge } from '@/components/data-status-badge';
import {
  DC_NEIGHBORHOOD_MAP,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_QUERY_MAX_LENGTH,
  currentDealWhere,
  directoryRetailerOrderBy,
  directoryRetailerWhere,
  directorySearchHref,
  parseDirectorySearch,
} from '@/lib/directory-search.mjs';
import { canonicalPlatformUrl, requestOrigin } from '@/lib/server-request-url';
import { PUBLIC_DEAL_PREVIEW_LIMIT } from '@/lib/retailer-detail-search.mjs';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import { PUBLIC_PRODUCT_DESCRIPTION } from '@/lib/product-brand';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import { relativeFreshnessLabel } from '@/lib/freshness.mjs';
import { resolveSponsorship, dedupeSponsoredCards, SPONSORSHIP_STATES } from '@/lib/sponsorship-entitlement.mjs';
import { SponsorshipBadge } from '@/components/sponsorship-badge';
import {
  jsonLdScriptProps,
  retailerItemListJsonLd,
} from '@/lib/structured-data.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import RetailerMapLoader from '@/components/retailer-map-loader';
import FavoriteButton from '@/components/favorite-button';
import {
  BadgeCheck,
  Clock,
  Flame,
  MapPin,
  Navigation,
  Phone,
  ScrollText,
  Search,
  Store,
  Truck,
} from 'lucide-react';

type Props = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{
    query?: string | string[];
    type?: string | string[];
    status?: string | string[];
    sort?: string | string[];
    page?: string | string[];
  }>;
};

export const metadata = {
  ...buildPublicMetadata({
    title: 'Washington, D.C. Cannabis Dispensaries & Delivery — Verified Directory',
    description:
      'Find D.C. dispensaries, delivery services, menus, and deals — every record labeled with its source, verification state, and freshness window. No pay-to-rank.',
    canonicalPath: '/',
  }),
  alternates: {
    canonical: '/',
  },
};

export default async function TenantHomePage({ params, searchParams }: Props) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const requestedFilters = parseDirectorySearch(resolvedSearchParams);
  const canonicalHome = await canonicalPlatformUrl('/');
  const origin = await requestOrigin();

  // 1. Fetch current brand
  const brand = await prisma.brand.findUnique({
    where: { domain: resolvedParams.domain },
  });

  if (!brand) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center p-8 bg-brand-background text-brand-text">
        <h1 className="text-2xl font-bold text-red-600 mb-2">404 - Brand Not Found</h1>
        <p className="text-brand-muted">The requested hostname is not configured on this network.</p>
        <Link href={canonicalHome} className="mt-4 text-brand-primary-text hover:underline">
          Go to Main Network Portal
        </Link>
      </div>
    );
  }

  // 2. Query a bounded page of retailers matching this brand and truth state.
  const asOf = new Date();
  const where = directoryRetailerWhere({
    brandId: brand.id,
    filters: requestedFilters,
    asOf,
  });
  const brandScope = {
    menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
  };
  const [totalResults, verifiedCurrentCount, activeDealCount, articleCount] =
    await Promise.all([
      prisma.retailer.count({ where }),
      prisma.retailer.count({
        where: { ...currentPublicRecordWhere(asOf), ...brandScope },
      }),
      prisma.deal.count({
        where: { ...currentDealWhere(asOf), retailer: brandScope },
      }),
      prisma.article.count(),
    ]);
  const totalPages = Math.max(1, Math.ceil(totalResults / DIRECTORY_PAGE_SIZE));
  const currentPage = Math.min(requestedFilters.page, totalPages);
  const retailers = await prisma.retailer.findMany({
    where,
    include: {
      deals: {
        where: currentDealWhere(asOf),
        orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        take: PUBLIC_DEAL_PREVIEW_LIMIT,
      },
    },
    orderBy: [...directoryRetailerOrderBy(requestedFilters.sort)],
    skip: (currentPage - 1) * DIRECTORY_PAGE_SIZE,
    take: DIRECTORY_PAGE_SIZE,
  });

  // SPONSORSHIP ENTITLEMENT (Mechanism Matrix M-001).
  //
  // The card badge is resolved from PERSISTED Demand Credit rows, never from
  // retailer.isSponsored. That boolean is merely an intent flag a merchant or
  // admin can set; rendering a disclosure from it would let a badge appear with
  // no paid placement behind it — the exact unbacked-claim failure this gate
  // exists to prevent.
  //
  // Ordering is computed ABOVE this block and is not re-sorted afterwards, so
  // sponsorship structurally cannot influence organic order.
  //
  // FAIL CLOSED: if the ledger read throws, ledgerAvailable=false and every card
  // resolves to UNAVAILABLE, which renders nothing. An outage silently removes
  // badges rather than silently asserting unpaid sponsorship.
  let ledgerRows: Awaited<ReturnType<typeof prisma.demandCreditEntry.findMany>> = [];
  let ledgerAvailable = true;
  try {
    ledgerRows = await prisma.demandCreditEntry.findMany({
      where: { merchantId: { in: retailers.map((r) => r.id) } },
      orderBy: { seq: 'asc' },
    });
  } catch {
    ledgerAvailable = false;
  }
  const sponsorshipByRetailer = new Map(
    retailers.map((r) => [
      r.id,
      resolveSponsorship({
        merchantId: r.id,
        entries: ledgerRows,
        placement: 'FEATURED_CARD',
        ledgerAvailable,
      }),
    ]),
  );
  // One merchant may not occupy the same slot on multiple cards.
  const sponsorshipAllowed = dedupeSponsoredCards(
    retailers.map((r) => ({
      id: r.id,
      merchantId: r.id,
      placement: 'FEATURED_CARD',
      sponsorshipState: sponsorshipByRetailer.get(r.id)?.state,
    })),
  );
  const sponsorshipFor = (id: string) => {
    const s = sponsorshipByRetailer.get(id);
    if (!s) return null;
    if (s.state === SPONSORSHIP_STATES.ACTIVE && !sponsorshipAllowed.has(id)) {
      return { ...s, state: SPONSORSHIP_STATES.NONE, label: null, evidence: null,
               reason: 'duplicate campaign suppressed' };
    }
    return s;
  };
  const firstResult =
    totalResults === 0 ? 0 : (currentPage - 1) * DIRECTORY_PAGE_SIZE + 1;
  const lastResult = Math.min(
    currentPage * DIRECTORY_PAGE_SIZE,
    totalResults,
  );
  const hasFilters = Boolean(
      requestedFilters.query ||
      requestedFilters.type ||
      requestedFilters.status ||
      requestedFilters.sort !== 'TRUTH_FIRST',
  );
  const isCanonicalBrand = brand.domain === CANONICAL_TENANT_DOMAIN;
  const itemListJsonLd = isCanonicalBrand
    ? retailerItemListJsonLd({ retailers, origin: origin.origin })
    : null;

  const stats = [
    { label: 'Labeled listings', value: totalResults },
    { label: 'Verified current', value: verifiedCurrentCount },
    { label: 'Active deals', value: activeDealCount },
    { label: 'Learning guides', value: articleCount },
  ];

  return (
    <div className="flex-grow flex flex-col animate-fade-in">
      {itemListJsonLd && <script {...jsonLdScriptProps(itemListJsonLd)} />}

      {/* Hero + Search Header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="kicker mb-4">
                {isCanonicalBrand
                  ? 'Washington, D.C. · Evidence-aware directory'
                  : brand.name}
              </p>
              <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-brand-text sm:text-5xl lg:text-6xl">
                {isCanonicalBrand ? (
                  <>
                    D.C. cannabis,{' '}
                    <span className="text-brand-primary-text">with receipts.</span>
                  </>
                ) : (
                  brand.name
                )}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-brand-muted sm:text-lg">
                {isCanonicalBrand
                  ? `${PUBLIC_PRODUCT_DESCRIPTION} Every dispensary, delivery service, menu, and deal is labeled with its source, verification state, and freshness — and sponsorship never buys ranking.`
                  : brand.description ||
                    'Explore listings with explicit source and freshness labels.'}
              </p>
              <p className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-4 py-2.5 text-xs leading-relaxed text-brand-text/80">
                <span className="font-bold text-brand-primary-text">New to D.C.&apos;s rules?</span>
                Initiative 71, the gifting model, and the 21+ medical program —
                explained in plain language.
                <Link href="/legal" className="inline-block py-1 font-bold text-brand-primary-text hover:underline">
                  Read the 2-minute guide →
                </Link>
              </p>
            </div>
            <div className="hidden lg:col-span-2 lg:block">
              <img
                src="/art/hero-dc.jpg"
                alt="Illustrative artwork of the Washington, D.C. skyline at dawn"
                width={1680}
                height={720}
                className="w-full rounded-2xl border border-brand-border object-cover shadow-xl shadow-emerald-950/10"
              />
            </div>
          </div>

          {/* Search + filters */}
          <form
            method="GET"
            className="mt-8 rounded-2xl border border-brand-border bg-brand-surface/80 p-4 shadow-xl shadow-emerald-950/10 backdrop-blur-md"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-grow">
                <Search
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted"
                />
                <label htmlFor="directory-query" className="sr-only">
                  Search retailer listings
                </label>
                <input
                  id="directory-query"
                  type="text"
                  name="query"
                  placeholder="Search dispensaries, delivery services, strains…"
                  defaultValue={requestedFilters.query}
                  maxLength={DIRECTORY_QUERY_MAX_LENGTH}
                  className="w-full rounded-xl border border-brand-border bg-brand-background py-3 pl-11 pr-4 text-sm text-brand-text placeholder:text-brand-muted/70 transition-all focus:border-brand-primary focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="directory-type" className="sr-only">
                  Filter by retailer type
                </label>
                <select
                  id="directory-type"
                  name="type"
                  defaultValue={requestedFilters.type}
                  className="rounded-xl border border-brand-border bg-brand-background px-3 py-3 text-xs font-semibold text-brand-text transition-all focus:border-brand-primary focus:outline-none"
                >
                  <option value="">All Types</option>
                  <option value="delivery">Delivery</option>
                  <option value="storefront">Dispensary Storefront</option>
                </select>
                <label htmlFor="directory-status" className="sr-only">
                  Filter by data status
                </label>
                <select
                  id="directory-status"
                  name="status"
                  defaultValue={requestedFilters.status}
                  className="rounded-xl border border-brand-border bg-brand-background px-3 py-3 text-xs font-semibold text-brand-text transition-all focus:border-brand-primary focus:outline-none"
                >
                  <option value="">All Data States</option>
                  <option value="VERIFIED_CURRENT">Verified Current</option>
                  <option value="AWAITING_VERIFICATION">Awaiting Verification</option>
                  <option value="DEMONSTRATION_ONLY">Demonstration Only</option>
                  <option value="STALE">Stale</option>
                  <option value="DISPUTED">Disputed</option>
                </select>
                <label htmlFor="directory-sort" className="sr-only">
                  Sort retailer listings
                </label>
                <select
                  id="directory-sort"
                  name="sort"
                  defaultValue={requestedFilters.sort}
                  className="rounded-xl border border-brand-border bg-brand-background px-3 py-3 text-xs font-semibold text-brand-text transition-all focus:border-brand-primary focus:outline-none"
                >
                  <option value="TRUTH_FIRST">Truth-first</option>
                  <option value="RECENTLY_UPDATED">Recently updated</option>
                  <option value="NAME_ASC">Name A-Z</option>
                  <option value="NEAREST">Nearest First</option>
                </select>
                <button
                  type="submit"
                  className="cursor-pointer rounded-xl bg-brand-primary px-5 py-3 text-xs font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
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

            {/* Quick pills */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-brand-border pt-4">
              <span className="kicker mr-1 !text-[10px]">Neighborhoods</span>
              {Object.entries(DC_NEIGHBORHOOD_MAP).map(([key, item]) => {
                const isActive = requestedFilters.neighborhood === key;
                return (
                  <Link
                    key={key}
                    href={directorySearchHref({ ...requestedFilters, neighborhood: isActive ? '' : key }, 1)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all ${
                      isActive
                        ? 'border-brand-primary bg-brand-primary text-white'
                        : 'border-brand-border bg-brand-background text-brand-muted hover:border-brand-primary/50 hover:text-brand-text'
                    }`}
                  >
                    <MapPin size={10} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
              <span className="kicker ml-3 mr-1 !text-[10px]">Strains</span>
              {['sativa', 'indica', 'hybrid', 'cbd'].map((strain) => {
                const isActive = requestedFilters.query?.toLowerCase() === strain;
                return (
                  <Link
                    key={strain}
                    href={directorySearchHref({ ...requestedFilters, query: isActive ? '' : strain }, 1)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all ${
                      isActive
                        ? 'border-brand-primary bg-brand-primary text-white'
                        : 'border-brand-border bg-brand-background text-brand-muted hover:border-brand-primary/50 hover:text-brand-text'
                    }`}
                  >
                    {strain}
                  </Link>
                );
              })}
              <Link
                href={directorySearchHref({ ...requestedFilters, status: requestedFilters.status === 'VERIFIED_CURRENT' ? '' : 'VERIFIED_CURRENT' }, 1)}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition-all ${
                  requestedFilters.status === 'VERIFIED_CURRENT'
                    ? 'border-brand-primary bg-brand-primary text-white'
                    : 'border-brand-border bg-brand-background text-brand-muted hover:border-brand-primary/50 hover:text-brand-text'
                }`}
              >
                <BadgeCheck size={12} aria-hidden="true" />
                Verified current only
              </Link>
            </div>
          </form>

          {/* Trust stats strip */}
          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-brand-border bg-brand-surface/60 px-4 py-3"
              >
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  {stat.label}
                </dt>
                <dd className="mt-0.5 font-display text-2xl font-bold text-brand-text">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>

          {/* Category tile rail (illustrative artwork) */}
          <nav aria-label="Browse products by category" className="mt-8">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {[
                ['flower', 'Flower'],
                ['edibles', 'Edibles'],
                ['concentrates', 'Concentrates'],
                ['vapes', 'Vapes'],
                ['pre-rolls', 'Pre-rolls'],
                ['topicals', 'Topicals'],
                ['accessories', 'Accessories'],
              ].map(([slug, label]) => (
                <Link
                  key={slug}
                  href={`/products?category=${slug}`}
                  className="record-card group overflow-hidden rounded-2xl"
                >
                  <img
                    src={`/art/cat-${slug}.jpg`}
                    alt={`${label} — illustrative artwork`}
                    width={480}
                    height={480}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  <span className="block px-3 py-2 text-center text-xs font-bold text-brand-text transition-colors group-hover:text-brand-primary-text">
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </section>

      {/* Main Contents (Directory grid + Map Sidebar) */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 flex-grow grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left Side: Directory Listings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between text-sm text-brand-muted mb-2">
            <div>
              Showing{' '}
              <span className="font-semibold text-brand-primary-text">
                {firstResult}-{lastResult}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-brand-primary-text">
                {totalResults}
              </span>{' '}
              labeled results
            </div>
            <div className="flex items-center space-x-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-primary inline-block"></span>
              <span>
                Sponsorship is labeled and never changes directory order
              </span>
            </div>
          </div>

          {retailers.length === 0 ? (
            <div className="rounded-2xl border border-brand-border bg-brand-surface p-12 text-center">
              <p className="text-brand-muted">No retailers or listings found matching your filters.</p>
              <Link href="/" className="mt-4 inline-block text-brand-primary-text font-semibold hover:underline">
                Reset Filters
              </Link>
            </div>
          ) : (
            <form action="/compare" method="GET" className="space-y-4">
              <fieldset className="space-y-4">
                <legend className="sr-only">
                  Select up to three retailers to compare
                </legend>
                <div className="flex flex-col gap-3 rounded-2xl border border-brand-primary/20 bg-brand-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-brand-primary-text">
                      orderweeddc Trust Lens
                    </p>
                    <p className="mt-1 text-xs text-brand-muted">
                      Select up to three records. Compare evidence, freshness,
                      sponsorship, and handoff eligibility without tracking.
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 cursor-pointer rounded-lg bg-brand-primary-fill-strong px-4 py-2 text-xs font-bold text-white transition-all hover:brightness-110"
                  >
                    Compare selected
                  </button>
                </div>
                {retailers.map((retailer) => (
                <article
                  key={retailer.id}
                  className={`record-card rounded-2xl p-5 flex flex-col md:flex-row gap-5 ${
                    sponsorshipFor(retailer.id)?.state === SPONSORSHIP_STATES.ACTIVE
                      ? 'ring-1 ring-brand-gold/25'
                      : ''
                  } ${isPubliclyVerified(retailer) ? 'record-card--verified' : ''}`}
                >
                  {/* Retailer Thumbnail (illustrative artwork, not a photo of the business) */}
                  <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-xl border border-brand-border md:h-32 md:w-44">
                    <img
                      src={retailer.type === 'storefront' ? '/art/retailer-storefront.jpg' : '/art/retailer-delivery.jpg'}
                      alt={`Illustrative ${retailer.type} artwork`}
                      width={720}
                      height={480}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-text backdrop-blur-sm">
                      {retailer.type === 'storefront' ? (
                        <Store size={10} aria-hidden="true" />
                      ) : (
                        <Truck size={10} aria-hidden="true" />
                      )}
                      {retailer.type}
                    </span>
                    <span className="absolute right-0 top-0">
                      <SponsorshipBadge sponsorship={sponsorshipFor(retailer.id)} />
                    </span>
                  </div>

                  {/* Retailer Details */}
                  <div className="flex-grow space-y-1">
                    <div className="flex items-center justify-between border-b border-brand-border pb-2 mb-2">
                      <label
                        htmlFor={`compare-${retailer.id}`}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-brand-muted"
                      >
                        <input
                          id={`compare-${retailer.id}`}
                          type="checkbox"
                          name="retailer"
                          value={retailer.id}
                          aria-label={`Compare ${retailer.name}`}
                          className="h-6 w-6 accent-[var(--brand-primary)]"
                        />
                        Compare
                      </label>
                      <FavoriteButton retailerId={retailer.id} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-brand-text transition-colors hover:text-brand-primary-text">
                        <Link href={`/retailer/${retailer.id}`} className="inline-block py-0.5">{retailer.name}</Link>
                      </h2>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        retailer.type === 'storefront'
                          ? 'bg-blue-500/10 border border-blue-500/20 text-blue-700'
                          : 'bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-text'
                      }`}>
                        {retailer.type}
                      </span>
                      <DataStatusBadge
                        dataStatus={retailer.dataStatus}
                        isDemonstration={retailer.isDemonstration}
                        verifiedAt={retailer.verifiedAt}
                        freshnessExpiresAt={retailer.freshnessExpiresAt}
                        compact
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-brand-muted">
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={13} aria-hidden="true" className="text-brand-primary-text/70" />
                        {retailer.address}, {retailer.city}
                      </span>
                      <span aria-hidden="true">•</span>
                      <span className="inline-flex items-center gap-1">
                        <ScrollText size={13} aria-hidden="true" className="text-brand-primary-text/70" />
                        Source: {retailer.dataSource}
                      </span>
                    </div>

                    {/* Loud relative freshness (evidence-only: renders nothing
                        when no verification was ever recorded, and never on
                        demonstration or stale records). */}
                    {isPubliclyVerified(retailer) &&
                      relativeFreshnessLabel({
                        verifiedAt: retailer.verifiedAt,
                        freshnessExpiresAt: retailer.freshnessExpiresAt,
                      }) && (
                      <p className="evidence-mono text-brand-primary-text/90">
                        {relativeFreshnessLabel({
                          verifiedAt: retailer.verifiedAt,
                          freshnessExpiresAt: retailer.freshnessExpiresAt,
                        })}
                      </p>
                    )}

                    {/* Record-backed service chips (no invented amenities) */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="inline-flex items-center gap-1 rounded border border-brand-border bg-brand-background px-2 py-0.5 text-[9px] font-bold text-brand-muted">
                        {retailer.type === 'storefront' ? (
                          <>
                            <Store size={9} aria-hidden="true" /> In-store shopping
                          </>
                        ) : (
                          <>
                            <Truck size={9} aria-hidden="true" /> Delivery service
                          </>
                        )}
                      </span>
                      {retailer.hours && (
                        <span className="inline-flex items-center gap-1 rounded border border-brand-border bg-brand-background px-2 py-0.5 text-[9px] font-bold text-brand-muted">
                          <Clock size={9} aria-hidden="true" /> {retailer.hours}
                          <span className="font-medium text-brand-muted/70">({retailer.hoursSource})</span>
                        </span>
                      )}
                      {retailer.licenseStatus === 'VERIFIED' && !retailer.isDemonstration && (
                        <span className="inline-flex items-center gap-1 rounded border border-brand-primary/25 bg-brand-primary/10 px-2 py-0.5 text-[9px] font-bold text-brand-primary-text">
                          <BadgeCheck size={9} aria-hidden="true" /> License verified · {retailer.licenseSource}
                        </span>
                      )}
                    </div>

                    {/* Direct Contact & Directions Action Bar */}
                    <div className="flex items-center gap-2 pt-2">
                      {retailer.phone && (
                        <a
                          href={`tel:${retailer.phone}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-background px-2.5 py-1 text-[10px] font-bold text-brand-text transition-colors hover:border-brand-primary hover:text-brand-primary-text"
                        >
                          <Phone size={10} aria-hidden="true" /> Call
                        </a>
                      )}
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          `${retailer.name} ${retailer.address} ${retailer.city} ${retailer.state}`,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-background px-2.5 py-1 text-[10px] font-bold text-brand-text transition-colors hover:border-brand-primary hover:text-brand-primary-text"
                      >
                        <Navigation size={10} aria-hidden="true" /> Directions
                      </a>
                    </div>

                    {/* active deals indicator */}
                    {retailer.deals.length > 0 && (
                      <div className="pt-2">
                        {retailer.deals.map((deal) => (
                          <span key={deal.id} className="mr-2 inline-flex items-center gap-1 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                            <Flame size={10} aria-hidden="true" />
                            {deal.isDemonstration ? 'Demo offer (not redeemable)' : deal.discount} - {deal.title}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-xs text-brand-muted pt-3 border-t border-brand-border/60 mt-3 flex justify-between items-center">
                      <div>
                        License:{' '}
                        <span className="font-semibold text-brand-text/80">
                          {retailer.isDemonstration ? 'Not published for demonstration records' : retailer.licenseNumber || 'Awaiting verification'}
                        </span>
                      </div>
                      <Link
                        href={`/retailer/${retailer.id}`}
                        className="inline-block py-1 font-bold text-brand-primary-text transition-colors hover:text-brand-secondary"
                      >
                        View Data Status &amp; Menu →
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
              </fieldset>
            </form>
          )}

          {totalPages > 1 && (
            <nav
              aria-label="Directory pagination"
              className="flex items-center justify-between gap-4 border-t border-brand-border pt-4"
            >
              {currentPage > 1 ? (
                <Link
                  href={directorySearchHref(
                    requestedFilters,
                    currentPage - 1,
                  )}
                  className="text-xs font-bold text-brand-primary-text hover:underline"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-brand-muted">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages ? (
                <Link
                  href={directorySearchHref(
                    requestedFilters,
                    currentPage + 1,
                  )}
                  className="text-xs font-bold text-brand-primary-text hover:underline"
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>

        {/* Right Side: Map & Geographic Sidebar */}
        <div className="space-y-4">
          <div className="relative flex h-[380px] flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface p-1 shadow-md shadow-emerald-950/10 sm:h-[500px]">
            <RetailerMapLoader
              retailers={retailers.map(r => ({
                id: r.id,
                name: r.name,
                lat: r.lat,
                lng: r.lng,
                type: r.type,
              }))}
            />
          </div>

          {/* Neighborhood guide links (internal SEO mesh) */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-brand-text">
              <MapPin size={14} className="text-brand-primary-text" aria-hidden="true" />
              Browse by neighborhood
            </h3>
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
              {[
                ['georgetown', 'Georgetown'],
                ['dupont-circle', 'Dupont Circle'],
                ['capitol-hill', 'Capitol Hill'],
                ['u-street-shaw', 'U Street & Shaw'],
                ['navy-yard-wharf', 'Navy Yard & Wharf'],
              ].map(([slug, label]) => (
                <li key={slug}>
                  <Link
                    href={`/neighborhoods/${slug}`}
                    className="block rounded-lg border border-brand-border bg-brand-background px-3 py-2 font-semibold text-brand-muted transition-colors hover:border-brand-primary/40 hover:text-brand-primary-text"
                  >
                    {label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/neighborhoods"
                  className="block rounded-lg border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 font-bold text-brand-primary-text transition-colors hover:bg-brand-primary/20"
                >
                  All neighborhoods →
                </Link>
              </li>
            </ul>
          </div>

          {/* D.C. Compliance Quick Guide */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-3">
            <h3 className="text-sm font-bold text-brand-text flex items-center">
              <span className="mr-2 h-2 w-2 rounded-full bg-brand-gold"></span>
              D.C. Medical Cannabis Rules
            </h3>
            <p className="text-xs leading-relaxed text-brand-muted">
              Licensing and operating status can change. Confirm any business or license claim with the relevant D.C. government source. Demonstration records on this site are synthetic and remain visibly labeled.
            </p>
            <Link
              href="/legal"
              className="inline-block text-xs font-bold text-brand-primary-text hover:underline"
            >
              Read the compliance guide →
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
