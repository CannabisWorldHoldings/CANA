import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataStatusBadge } from '@/components/data-status-badge';
import ReviewModal from '@/components/review-modal';
import ShareButton from '@/components/share-button';
import FavoriteButton from '@/components/favorite-button';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import {
  currentDealWhere,
  publicCatalogRecordWhere,
} from '@/lib/directory-search.mjs';
import { safePublicWebsiteUrl } from '@/lib/handoff.mjs';
import { tenantRetailerWhere } from '@/lib/tenant-retailer.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
  retailerAnswerJsonLd,
  retailerJsonLd,
} from '@/lib/structured-data.mjs';
import { clampSeoText } from '@/lib/seo-meta.mjs';
import { BadgeCheck, MapPin, Phone, Clock, Globe, Mail, ShieldCheck, Star, FileEdit } from 'lucide-react';
import {
  RETAILER_DEAL_PAGE_SIZE,
  RETAILER_MENU_PAGE_SIZE,
  clampRetailerDetailPage,
  parseRetailerDetailSearch,
  retailerDetailHref,
  retailerDetailPageCount,
  retailerDetailPageOffset,
} from '@/lib/retailer-detail-search.mjs';

type Props = {
  params: Promise<{ domain: string; id: string }>;
  searchParams: Promise<{
    menuPage?: string | string[];
    dealPage?: string | string[];
    menuQuery?: string | string[];
  }>;
};

type RetailerPageKey = 'menuPage' | 'dealPage';

type RetailerSearch = {
  menuPage: number;
  dealPage: number;
};

function RetailerPagination({
  retailerId,
  search,
  pageKey,
  totalItems,
  label,
}: {
  retailerId: string;
  search: RetailerSearch;
  pageKey: RetailerPageKey;
  totalItems: number;
  label: string;
}) {
  const currentPage = search[pageKey];
  const totalPages = retailerDetailPageCount(totalItems, pageKey);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex items-center justify-between gap-3 border-t border-brand-border pt-4 text-xs"
    >
      {currentPage > 1 ? (
        <Link
          href={retailerDetailHref(
            retailerId,
            search,
            pageKey,
            currentPage - 1,
          )}
          className="font-bold text-brand-primary-text hover:underline"
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-brand-muted">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link
          href={retailerDetailHref(
            retailerId,
            search,
            pageKey,
            currentPage + 1,
          )}
          className="font-bold text-brand-primary-text hover:underline"
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export async function generateMetadata({ params }: Props) {
  const { domain, id } = await params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true, name: true },
  });
  if (!brand) {
    return { title: 'Retailer Not Found | Order Weed DC' };
  }

  const retailer = await prisma.retailer.findFirst({
    where: tenantRetailerWhere(brand.id, id),
    select: {
      name: true,
      dataStatus: true,
      isDemonstration: true,
      verifiedAt: true,
      freshnessExpiresAt: true,
    },
  });

  if (!retailer) {
    return { title: 'Retailer Not Found | Order Weed DC' };
  }

  const indexable = isPubliclyVerified(retailer);
  const title = clampSeoText(`${retailer.name} — Menu, Deals & Verified Info`, 65);
  const description = retailer.isDemonstration
    ? 'A visibly labeled demonstration retailer record with synthetic menu and offer data.'
    : clampSeoText(
        `${retailer.name} in Washington, D.C.: menu, active deals, license status, and contact details — with explicit source and freshness labels.`,
        160,
      );
  return {
    title,
    description,
    robots: {
      index: indexable,
      follow: indexable,
    },
    alternates: {
      canonical: `/retailer/${encodeURIComponent(id)}`,
    },
    openGraph: {
      title,
      description,
      siteName: brand.name,
      type: 'website',
      locale: 'en_US',
      url: `/retailer/${encodeURIComponent(id)}`,
      images: [{ url: '/og-default.jpg', width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-default.jpg'],
    },
  };
}

export default async function RetailerDetailPage({
  params,
  searchParams,
}: Props) {
  const { domain, id } = await params;
  const rawSearchParams = await searchParams;
  const requestedSearch = parseRetailerDetailSearch(rawSearchParams);

  // 1. Fetch current brand configuration
  const brand = await prisma.brand.findUnique({
    where: { domain: domain },
  });

  if (!brand) return notFound();

  // 2. Fetch the tenant-scoped, publicly discoverable retailer.
  const asOf = new Date();
  const retailer = await prisma.retailer.findFirst({
    where: tenantRetailerWhere(brand.id, id, asOf),
  });

  if (!retailer) return notFound();
  const websiteUrl = safePublicWebsiteUrl(retailer.website);
  const canHandoff = isPubliclyVerified(retailer, asOf) && websiteUrl !== null;

  // PAGE-BOUND EVIDENCE. Mint a challenge HERE, during the render, and embed it in
  // the handoff form. A submission that later presents it proves it possessed bytes
  // only this render produced — a real causal link from render to submission.
  //
  // The previous design issued and consumed a token inside the handoff request
  // itself, so it could only ever prove the server ran its own route. The client
  // never held it. Fixing the causal direction is the whole point.
  let pageChallenge: string | null = null;
  if (canHandoff && websiteUrl) {
    try {
      const secret = process.env.CANA_INTERACTION_SECRET ?? '';
      if (secret) {
        const { mintPageChallenge } = await import('@/lib/page-challenge.mjs');
        const minted = mintPageChallenge({
          secret, tenant: domain, merchantId: retailer.id,
          pagePath: `/retailer/${retailer.id}`, actionKind: 'HANDOFF',
          destination: websiteUrl,
        }) as { challenge: string };
        pageChallenge = minted.challenge;
      }
    } catch {
      // A render must never fail because attribution bookkeeping could not mint.
      // The handoff still works; it simply grades lower, which is the honest
      // outcome rather than a broken page.
      pageChallenge = null;
    }
  }

  // 3. Fetch only public catalog records associated with this retailer and brand.
  const catalogRecordWhere = publicCatalogRecordWhere(asOf);
  const dealWhere = {
    retailerId: retailer.id,
    ...currentDealWhere(asOf),
  };
  const menuWhere = {
    retailerId: retailer.id,
    ...catalogRecordWhere,
    brandMenus: {
      some: {
        brandId: brand.id,
      },
    },
    product: catalogRecordWhere,
  };
  const [dealCount, menuCount] = await Promise.all([
    prisma.deal.count({ where: dealWhere }),
    prisma.menuEntry.count({ where: menuWhere }),
  ]);
  const search: RetailerSearch = {
    dealPage: clampRetailerDetailPage(
      requestedSearch.dealPage,
      dealCount,
      'dealPage',
    ),
    menuPage: clampRetailerDetailPage(
      requestedSearch.menuPage,
      menuCount,
      'menuPage',
    ),
  };
  const [deals, menuEntries] = await Promise.all([
    prisma.deal.findMany({
      where: dealWhere,
      orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
      skip: retailerDetailPageOffset(search.dealPage, 'dealPage'),
      take: RETAILER_DEAL_PAGE_SIZE,
    }),
    prisma.menuEntry.findMany({
      where: menuWhere,
      include: {
        product: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: retailerDetailPageOffset(search.menuPage, 'menuPage'),
      take: RETAILER_MENU_PAGE_SIZE,
    }),
  ]);

  // Group menu entries by category
  const categories: Record<string, typeof menuEntries> = {};
  menuEntries.forEach((entry) => {
    const cat = entry.product.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(entry);
  });

  // Truth boundary: structured data is only emitted for records that passed
  // public verification, so machines never ingest synthetic business facts.
  const origin = await requestOrigin();
  const storeLd = retailerJsonLd({ retailer, origin: origin.origin, asOf });
  // The answer block: the questions a person actually asks, answered only where
  // the underlying field is sourced. Unanswerable questions are omitted rather
  // than answered vaguely, and a record with nothing answerable yields null.
  const answerLd = retailerAnswerJsonLd({ retailer, asOf });
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Retailers', url: `${origin.origin}/` },
    { name: retailer.name, url: `${origin.origin}/retailer/${retailer.id}` },
  ]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-fade-in space-y-8 flex-grow">
      {storeLd && <script {...jsonLdScriptProps(storeLd)} />}
      {breadcrumbLd && <script {...jsonLdScriptProps(breadcrumbLd)} />}
      {answerLd && <script {...jsonLdScriptProps(answerLd)} />}
      
      {/* Back button */}
      <div>
        <Link href="/" className="text-xs font-semibold text-brand-muted hover:text-brand-primary-text transition-colors flex items-center">
          ← Back to directory
        </Link>
      </div>

      {/* Header Profile Section */}
      <div className="record-card rounded-2xl overflow-hidden">
        <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-text">{retailer.name}</h1>
            <span className="text-xs bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-text font-bold px-2.5 py-0.5 rounded-full uppercase">
              {retailer.type}
            </span>
            <DataStatusBadge
              dataStatus={retailer.dataStatus}
              isDemonstration={retailer.isDemonstration}
              verifiedAt={retailer.verifiedAt}
              freshnessExpiresAt={retailer.freshnessExpiresAt}
            />
            <div className="flex items-center gap-2 ml-auto">
              <ShareButton title={retailer.name} />
              <FavoriteButton retailerId={retailer.id} />
            </div>
          </div>

          <p className="text-sm text-brand-muted">
            <MapPin size={13} className="mr-1 inline text-brand-primary-text/70" aria-hidden="true" /> {retailer.address}, {retailer.city}, {retailer.state} {retailer.zip}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-brand-muted">
            {retailer.phone && (
              <div className="inline-flex items-center gap-1"><Phone size={11} aria-hidden="true" /> {retailer.phone}</div>
            )}
            {retailer.hours && (
              <div className="flex items-center gap-x-4">
                {retailer.phone && <span>•</span>}
                <div className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" /> {retailer.hours}</div>
              </div>
            )}
            {websiteUrl && (
              <div className="flex items-center gap-x-4">
                {(retailer.phone || retailer.hours) && <span>•</span>}
                <div className="inline-flex items-center gap-1"><Globe size={11} aria-hidden="true" /> <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-brand-primary-text underline transition-colors">{retailer.website}</a></div>
              </div>
            )}
            {retailer.email && (
              <div className="flex items-center gap-x-4">
                {(retailer.phone || retailer.hours || retailer.website) && <span>•</span>}
                <div className="inline-flex items-center gap-1"><Mail size={11} aria-hidden="true" /> <a href={`mailto:${retailer.email}`} className="hover:text-brand-primary-text underline transition-colors">{retailer.email}</a></div>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic handoff trigger */}
        {canHandoff ? (
          <form
            action={`/retailer/${retailer.id}/handoff`}
            method="post"
            className="w-full md:w-auto shrink-0"
          >
            {pageChallenge && (
              <input type="hidden" name="page_challenge" value={pageChallenge} />
            )}
            <button 
              type="submit"
              className="w-full md:w-auto bg-brand-primary-fill-strong text-white font-extrabold text-sm px-6 py-3 rounded-lg hover:brightness-110 active:scale-98 transition-all shadow-md shadow-brand-primary/25 cursor-pointer"
            >
              Route to Retailer Menu / Contact →
            </button>
          </form>
        ) : (
          <div className="w-full md:w-auto shrink-0 bg-brand-surface text-brand-muted border border-brand-border text-center font-bold text-xs px-6 py-3 rounded-md cursor-not-allowed select-none">
            🔒 Handoff Locked ({retailer.isDemonstration ? 'Demonstration Record' : websiteUrl ? 'Awaiting Current Verification' : 'No Safe Public Website'})
          </div>
        )}
        </div>
      </div>

      {/* Profile Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Menu & Deals) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Active Deals Banner */}
          {deals.length > 0 && (
            <div className="border border-orange-500/30 bg-orange-500/10 rounded-lg p-5 space-y-3">
              <h2 className="text-md font-bold text-orange-700 flex items-center">
                🔥 Offers (check the data label before use)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {deals.map((deal) => (
                  <div key={deal.id} className="bg-brand-surface border border-brand-border p-4 rounded-md space-y-1">
                    <span className="text-xs font-black text-orange-700 bg-orange-400/10 px-2 py-0.5 rounded">
                      {deal.isDemonstration ? 'DEMO OFFER — NOT REDEEMABLE' : deal.discount}
                    </span>
                    <DataStatusBadge
                      dataStatus={deal.dataStatus}
                      isDemonstration={deal.isDemonstration}
                      verifiedAt={deal.verifiedAt}
                      freshnessExpiresAt={deal.freshnessExpiresAt}
                      compact
                    />
                    <h3 className="text-sm font-bold text-brand-text pt-1">{deal.title}</h3>
                    <p className="text-xs text-brand-muted">{deal.description}</p>
                    <div className="text-[10px] text-brand-muted pt-2">
                      Code: <span className="font-semibold text-brand-text">{deal.code || 'None'}</span> • Expires: {new Date(deal.expiryDate).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-brand-muted">
                {dealCount} evidence-eligible offer
                {dealCount === 1 ? '' : 's'}.
              </p>
              <RetailerPagination
                retailerId={retailer.id}
                search={search}
                pageKey="dealPage"
                totalItems={dealCount}
                label="Offer"
              />
            </div>
          )}

          {/* Catalog Menu Grid */}
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-brand-border pb-3 gap-3">
              <h2 className="text-lg font-bold text-brand-text">
                Menu & Availability ({menuCount})
              </h2>
              <form method="GET" className="flex items-center gap-2">
                <label htmlFor="menu-search-input" className="sr-only">Filter menu items</label>
                <input
                  id="menu-search-input"
                  name="menuQuery"
                  type="text"
                  placeholder="Search products..."
                  defaultValue={typeof rawSearchParams.menuQuery === 'string' ? rawSearchParams.menuQuery : ''}
                  className="bg-brand-background border border-brand-border text-brand-text px-3 py-1.5 rounded text-xs focus:border-brand-primary focus:outline-none transition-colors"
                />
                <button type="submit" className="bg-brand-primary-fill-strong text-white text-xs font-bold px-3.5 py-1.5 rounded hover:brightness-110 transition-colors cursor-pointer">
                  Search
                </button>
              </form>
            </div>

            {/* Category Quick Filter Pills */}
            <div className="flex flex-wrap gap-2 pt-1 pb-2">
              {['All', 'Flower', 'Vapes', 'Edibles', 'Concentrates', 'Pre-Rolls'].map((cat) => (
                <Link
                  key={cat}
                  href={`/retailer/${retailer.id}?menuQuery=${cat === 'All' ? '' : cat}`}
                  className="text-[11px] font-extrabold px-3 py-1 rounded-full border border-brand-border bg-brand-surface text-brand-muted hover:border-brand-primary hover:text-brand-primary-text transition-all"
                >
                  {cat === 'Flower' ? '🌱 Flower' : cat === 'Vapes' ? '💨 Vapes' : cat === 'Edibles' ? '🍬 Edibles' : cat === 'Concentrates' ? '🧴 Concentrates' : cat}
                </Link>
              ))}
            </div>

            {Object.keys(categories).length === 0 ? (
              <div className="border border-brand-border rounded-lg bg-brand-surface p-12 text-center text-brand-muted">
                This retailer has not uploaded any menu items for the {brand.name} platform yet.
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(categories).map(([cat, entries]) => (
                  <div key={cat} className="space-y-3">
                    <h3 className="text-xs font-bold text-brand-muted uppercase tracking-widest bg-brand-surface border border-brand-border px-3 py-1.5 rounded-md w-fit">
                      {cat}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {entries.map((entry) => (
                        <div key={entry.id} className="border border-brand-border bg-brand-surface/50 p-4 rounded-lg flex justify-between items-center gap-4 hover:border-brand-primary/20 transition-all">
                          <div className="space-y-1">
                            <h4 className="text-sm font-bold text-brand-text">{entry.product.name}</h4>
                            <DataStatusBadge
                              dataStatus={entry.dataStatus}
                              isDemonstration={entry.isDemonstration}
                              verifiedAt={entry.verifiedAt}
                              freshnessExpiresAt={entry.freshnessExpiresAt}
                              compact
                            />
                            <p className="text-xs text-brand-muted leading-relaxed max-w-xs">{entry.product.description}</p>
                            <div className="flex gap-2 text-[10px] text-brand-muted">
                              {entry.product.strainType && (
                                <span className="capitalize">{entry.product.strainType}</span>
                              )}
                              {entry.product.thcPercent && (
                                <span>• THC: {entry.product.thcPercent}%</span>
                              )}
                            </div>
                          </div>
                          
                          <div className="text-right shrink-0">
                            <div className="text-[9px] uppercase text-brand-muted">
                              {entry.isDemonstration ? 'Sample price' : 'Listed price'}
                            </div>
                            <div className="text-sm font-black text-brand-primary-text">${entry.price.toFixed(2)}</div>
                            <span className="text-[10px] text-brand-primary-text/80 font-semibold bg-brand-primary/5 border border-brand-primary/10 px-2 py-0.5 rounded">
                              {entry.isDemonstration ? 'Sample availability' : entry.inStock ? 'In stock' : 'Out of stock'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <RetailerPagination
              retailerId={retailer.id}
              search={search}
              pageKey="menuPage"
              totalItems={menuCount}
              label="Menu"
            />
          </div>

        </div>

        {/* Right Column: Truth Card & Audited Meta */}
        <div className="space-y-6">
          
          {/* TRUTH CARD */}
          <div className="rounded-2xl border border-brand-primary/30 bg-brand-surface p-5 space-y-4 shadow-[0_0_24px_rgba(46,226,127,0.05)]">
            <div className="flex items-center justify-between border-b border-brand-border pb-3">
              <h2 className="text-sm font-bold text-brand-text flex items-center">
                <ShieldCheck size={14} className="mr-1.5 text-brand-primary-text" aria-hidden="true" /> Truth Card
              </h2>
              <DataStatusBadge
                dataStatus={retailer.dataStatus}
                isDemonstration={retailer.isDemonstration}
                verifiedAt={retailer.verifiedAt}
                freshnessExpiresAt={retailer.freshnessExpiresAt}
              />
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Record Source:</span>
                <span className="font-semibold text-brand-text/85">{retailer.dataSource}</span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">License Claim:</span>
                <span className="font-semibold text-brand-text/85">
                  {retailer.isDemonstration ? 'Not published for demonstration records' : retailer.licenseNumber || 'Awaiting verification'}
                </span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Verified At:</span>
                <span className="font-semibold text-brand-text/85">
                  {retailer.verifiedAt ? new Date(retailer.verifiedAt).toLocaleDateString() : 'Not verified'}
                </span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Freshness Expires:</span>
                <span className="font-semibold text-brand-text/85">
                  {retailer.freshnessExpiresAt ? new Date(retailer.freshnessExpiresAt).toLocaleDateString() : 'No verified freshness window'}
                </span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Confidence:</span>
                <span className="font-semibold text-brand-text/85">
                  {retailer.confidence === null ? 'Not scored' : `${Math.round(retailer.confidence * 100)}%`}
                </span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Reviewer:</span>
                <span className="font-semibold text-brand-text/85">{retailer.reviewedBy || 'None'}</span>
              </div>
              <div className="flex justify-between border-b border-brand-border/40 pb-2">
                <span className="text-brand-muted">Hours Source:</span>
                <span className="font-semibold text-brand-text/85">{retailer.hoursSource}</span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-brand-muted">Listing Status:</span>
                <span className="font-semibold text-brand-text/85">
                  {retailer.isSponsored ? 'Paid Placement / Sponsored' : 'Organic directory listing'}
                </span>
              </div>
            </div>

            {/* Claim / Dispute / Correction Callout */}
            <div className="pt-2 border-t border-brand-border">
              <Link 
                href={`/retailer/${retailer.id}/correction`}
                className="w-full text-center block text-[10px] font-bold text-brand-muted hover:text-brand-primary-text border border-brand-border hover:border-brand-primary/20 py-2 rounded transition-all bg-brand-background/40"
              >
                <FileEdit size={11} className="mr-1 inline" aria-hidden="true" /> Submit Information Correction
              </Link>
            </div>
          </div>

          {/* CUSTOMER REVIEWS (honest empty state — no synthetic ratings) */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-brand-border pb-3">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-brand-text">
                <Star size={14} className="text-brand-gold" aria-hidden="true" />
                Customer Reviews
              </h2>
              <span className="evidence-mono rounded border border-brand-border bg-brand-background px-2 py-0.5 text-brand-muted">
                No published reviews yet
              </span>
            </div>
            <p className="text-xs leading-relaxed text-brand-muted">
              Reviews appear here only after passing evidence review —
              no synthetic ratings, ever. Be the first to submit one.
            </p>
            <ReviewModal retailerName={retailer.name} />
          </div>

          {/* BUSINESS CLAIM CTA */}
          <div className="hero-aurora rounded-2xl border border-brand-primary/25 bg-brand-surface p-5 space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-brand-text">
              <BadgeCheck size={14} className="text-brand-primary-text" aria-hidden="true" />
              Own this business?
            </h2>
            <p className="text-xs leading-relaxed text-brand-muted">
              Claim this listing to manage your menu, hours, deals, and
              license evidence — and earn the Verified Current label customers
              filter for. Claims stay private until administrator review.
            </p>
            <Link
              href="/business/claim"
              className="block w-full rounded-lg bg-brand-primary-fill-strong px-4 py-2.5 text-center text-xs font-bold text-white transition-all hover:brightness-110"
            >
              Claim this listing →
            </Link>
          </div>

        </div>

      </div>
    </div>
  );
}
