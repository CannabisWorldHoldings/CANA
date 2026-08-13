import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataStatusBadge } from '@/components/data-status-badge';
import { currentDealWhere } from '@/lib/directory-search.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  dealItemListJsonLd,
  dealOfferJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';
import { Flame } from 'lucide-react';
import { DealAlertCard } from '@/components/deal-alert-card';

type Props = {
  params: Promise<{ domain: string }>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { domain } = await params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { name: true },
  });

  if (!brand) return { title: 'Deals Not Found | Order Weed DC' };

  const base = buildPublicMetadata({
    title: 'D.C. Cannabis Deals — Verified, Time-Bounded Offers',
    description:
      'Active dispensary deals, verified promotions, and time-bounded offers from D.C. licensed cannabis retailers — all source-labeled.',
    canonicalPath: '/deals',
  });

  return base;
}

export default async function DealsHubPage({ params }: Props) {
  const { domain } = await params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
  });

  if (!brand) return notFound();

  const asOf = new Date();
  const origin = await requestOrigin();
  const dealWhere = {
    ...currentDealWhere(asOf),
    retailer: {
      menus: {
        some: {
          brandMenus: {
            some: { brandId: brand.id },
          },
        },
      },
    },
  };

  const deals = await prisma.deal.findMany({
    where: dealWhere,
    include: {
      retailer: {
        select: {
          id: true,
          name: true,
          type: true,
          address: true,
          city: true,
          dataStatus: true,
          isDemonstration: true,
          verifiedAt: true,
          freshnessExpiresAt: true,
        },
      },
    },
    orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
    take: 50,
  });

  // Collect non-null offer JSON-LD for verified deals
  const offerLdItems = deals
    .map((deal) => dealOfferJsonLd({ deal, retailer: deal.retailer, origin: origin.origin }))
    .filter((ld): ld is NonNullable<typeof ld> => ld !== null);

  // Machine-readable deal COLLECTION — the crawlable DC deals index no
  // incumbent publishes. Null when nothing is verified (no empty list).
  const dealListLd = dealItemListJsonLd({ deals, origin: origin.origin });
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Deals', url: `${origin.origin}/deals` },
  ]);
  const verifiedCount = offerLdItems.length;

  return (
    <div className="flex-grow animate-fade-in">
      {/* Structured data: breadcrumb, the deal collection, and each offer */}
      {breadcrumbLd && <script {...jsonLdScriptProps(breadcrumbLd)} />}
      {dealListLd && <script {...jsonLdScriptProps(dealListLd)} />}
      {offerLdItems.map((ld, i) => (
        <script key={i} {...jsonLdScriptProps(ld)} />
      ))}

      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="text-xs font-bold text-brand-muted transition-colors hover:text-brand-primary-text">
            ← Back to directory
          </Link>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="kicker mb-3">Verified Promotion Hub</p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
                D.C. Dispensary{' '}
                <span className="text-brand-primary-text">Deals &amp; Offers</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-brand-muted">
                Discover active promotional discounts, daily specials, and verified promo codes from D.C. licensed cannabis retailers.
              </p>
              <p className="mt-3 max-w-2xl text-xs leading-relaxed text-brand-muted/90">
                Every deal shows an expiry date and a source label — and{' '}
                {verifiedCount > 0 ? `${verifiedCount} ` : ''}verified offer
                {verifiedCount === 1 ? '' : 's'} publish a machine-readable
                validity window so search and AI assistants never surface an
                expired promotion. We never reorder deals by who pays.
              </p>
            </div>
            <div className="text-right">
              <span className="font-display text-2xl font-black text-brand-text">{deals.length}</span>
              <span className="block text-xs font-bold uppercase tracking-wider text-brand-muted">Active Deals</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <DealAlertCard />
        {/* Deals Grid */}
        {deals.length === 0 ? (
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-12 text-center space-y-3">
            <p className="font-bold text-brand-text">No verified current deals are available right now. Sign up above and we'll let you know the moment we verify one.</p>
            <p className="text-xs max-w-md mx-auto text-brand-muted">Retailer promotions change frequently. Check back soon or browse our full business directory.</p>
            <Link href="/" className="inline-block bg-brand-primary-fill-strong text-white font-bold text-xs px-5 py-2.5 rounded-xl hover:brightness-110 transition-all">
              Explore Directory
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((deal) => (
              <div
                key={deal.id}
                className="record-card rounded-2xl p-6 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-orange-700 bg-orange-400/10 border border-orange-400/20 px-2.5 py-1 rounded-lg">
                      <Flame size={12} aria-hidden="true" />
                      {deal.isDemonstration ? 'DEMO OFFER' : deal.discount}
                    </span>
                    <DataStatusBadge
                      dataStatus={deal.dataStatus}
                      isDemonstration={deal.isDemonstration}
                      verifiedAt={deal.verifiedAt}
                      freshnessExpiresAt={deal.freshnessExpiresAt}
                      compact
                    />
                  </div>

                  <h3 className="font-display text-lg font-extrabold text-brand-text leading-snug">{deal.title}</h3>
                  <p className="text-xs text-brand-muted leading-relaxed line-clamp-3">{deal.description}</p>
                </div>

                <div className="space-y-3 border-t border-brand-border/60 pt-4">
                  {/* Code & Expiry */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="bg-brand-background border border-brand-border px-3 py-1.5 rounded-lg font-mono font-bold text-brand-text">
                      Code: {deal.code || 'NO CODE NEEDED'}
                    </div>
                    <span className="text-[10px] text-brand-muted font-semibold">
                      Expires {new Date(deal.expiryDate).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Retailer Card Footer */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-bold text-brand-text block">{deal.retailer.name}</span>
                      <span className="text-[10px] text-brand-muted capitalize">{deal.retailer.type} • {deal.retailer.city}</span>
                    </div>
                    <Link
                      href={`/retailer/${deal.retailer.id}`}
                      className="text-xs font-bold text-brand-primary-text hover:underline"
                    >
                      View Menu →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
