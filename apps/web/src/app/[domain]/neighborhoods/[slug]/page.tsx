import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataStatusBadge } from '@/components/data-status-badge';
import {
  currentDealWhere,
} from '@/lib/directory-search.mjs';
import { PUBLIC_DEAL_PREVIEW_LIMIT } from '@/lib/retailer-detail-search.mjs';
import {
  NEIGHBORHOOD_CANDIDATE_LIMIT,
  neighborhoodCandidateWhere,
} from '@/lib/neighborhood-search.mjs';
import { NEIGHBORHOOD_CONFIGS } from '@/lib/neighborhood-configs.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';
import { MapPin, Flame } from 'lucide-react';

type Props = {
  params: Promise<{ domain: string; slug: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { domain, slug } = await params;
  const neighborhood = (NEIGHBORHOOD_CONFIGS as Record<string, typeof NEIGHBORHOOD_CONFIGS[keyof typeof NEIGHBORHOOD_CONFIGS] | undefined>)[slug];

  if (!neighborhood) {
    return {
      title: 'Neighborhood Not Found | Order Weed DC',
      robots: { index: false, follow: false, nocache: true },
    };
  }

  const origin = await requestOrigin();
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true },
  });
  const demonstrationCount = brand
    ? await prisma.retailer.count({
        where: {
          isDemonstration: true,
          menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
        },
      })
    : 0;
  const isDemonstrationEnvironment =
    origin.hostname.endsWith('.localhost') || demonstrationCount > 0;

  const title = `${neighborhood.name} Cannabis Dispensaries & Directory | Order Weed DC`;
  const description = `Explore verified medical cannabis dispensaries, delivery services, and active deals in ${neighborhood.name}, Washington D.C.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/neighborhoods/${slug}`,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/neighborhoods/${slug}`,
      images: [{ url: '/og-default.jpg', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-default.jpg'],
    },
    // Demonstration-aware indexing: geographic demo windows must never be
    // cached or indexed as real coverage claims.
    robots: isDemonstrationEnvironment
      ? { index: false, follow: false, nocache: true }
      : { index: true, follow: true },
  };
}

function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function buildNeighborhoodFaq(name: string) {
  return [
    {
      question: `Are there licensed cannabis retailers in ${name}?`,
      answer: `This directory uses a deterministic geographic window centered on ${name} to surface records within a defined radius and ZIP code set. Each record carries an explicit evidence label (Verified Current, Awaiting Verification, Demonstration Only, etc.) and a named source. The presence of a record does not constitute a guarantee of a business location, service area, or active license — verify license status with D.C. ABCA (abca.dc.gov) before visiting.`,
    },
    {
      question: `How do I buy cannabis legally near ${name}?`,
      answer: `Adults 21 and older may self-certify at ABCA-licensed dispensaries under D.C.'s medical cannabis program — no prior registration is required. Bring a government-issued photo ID. This directory links to licensed retailer records; see each retailer's page for address and hours. For a plain-language guide to D.C. cannabis law, visit our legal guide.`,
    },
    {
      question: `Does ${name} have cannabis delivery?`,
      answer: `Some ABCA-licensed dispensaries offer delivery services within their approved service areas. On this platform, each retailer record includes a type label (dispensary, delivery service, etc.) and an evidence label indicating verification status. Check the individual retailer record to see whether delivery is listed and confirmed, then contact the retailer directly to verify current service area and availability.`,
    },
  ];
}

export default async function NeighborhoodHubPage({ params }: Props) {
  const { domain, slug } = await params;
  const origin = await requestOrigin();

  // 1. Fetch current brand configuration
  const brand = await prisma.brand.findUnique({
    where: { domain: domain },
  });

  if (!brand) return notFound();

  const config = (NEIGHBORHOOD_CONFIGS as Record<string, typeof NEIGHBORHOOD_CONFIGS[keyof typeof NEIGHBORHOOD_CONFIGS] | undefined>)[slug];
  if (!config) return notFound();

  // 2. Query Retailers matching this brand's catalog
  const asOf = new Date();
  const candidateWhere = neighborhoodCandidateWhere({
    brandId: brand.id,
    latitude: config.lat,
    longitude: config.lng,
    zips: config.zips,
    asOf,
  });
  const candidateCount = await prisma.retailer.count({
    where: candidateWhere,
  });
  const allRetailers = await prisma.retailer.findMany({
    where: candidateWhere,
    include: {
      deals: {
        where: currentDealWhere(asOf),
        orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
        take: PUBLIC_DEAL_PREVIEW_LIMIT,
      },
    },
    orderBy: { id: 'asc' },
    take: NEIGHBORHOOD_CANDIDATE_LIMIT,
  });

  // Filter retailers located within 2.5 miles of the neighborhood center or matching zip code
  const neighborhoodRetailers = allRetailers.filter(r => {
    const distance = getDistanceMiles(config.lat, config.lng, r.lat, r.lng);
    const matchesZip = r.zip ? config.zips.includes(r.zip) : false;
    return distance <= 2.5 || matchesZip;
  });

  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Neighborhoods', url: `${origin.origin}/neighborhoods` },
    { name: config.name, url: `${origin.origin}/neighborhoods/${slug}` },
  ]);

  const faqEntries = buildNeighborhoodFaq(config.name);
  const faqLd = faqJsonLd(faqEntries);

  return (
    <div className="flex-grow flex flex-col animate-fade-in">
      {breadcrumbLd && <script {...jsonLdScriptProps(breadcrumbLd)} />}
      {faqLd && <script {...jsonLdScriptProps(faqLd)} />}

      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <Link href="/neighborhoods" className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text">
              ← All neighborhoods
            </Link>
            <span aria-hidden="true" className="text-brand-border">·</span>
            <Link href="/" className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text">
              Home
            </Link>
          </div>
          <p className="kicker mt-4 mb-3">Geographic Demonstration</p>
          <h1 className="font-display text-2xl font-extrabold text-brand-text sm:text-3xl">
            {config.name}{' '}
            <span className="text-brand-primary-text">Cannabis Directory</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-muted leading-relaxed">
            {config.description} Results below are not evidence of a business location, service area, or license.
          </p>
        </div>
      </section>

      {/* Grid Layout */}
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 gap-8 lg:grid-cols-3 flex-grow">

        {/* Left: Neighborhood listings */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="font-display text-sm font-bold text-brand-text uppercase tracking-wider border-b border-brand-border pb-2 mb-2">
            Labeled Demo Records Near {config.name}
          </h2>
          {candidateCount > NEIGHBORHOOD_CANDIDATE_LIMIT && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-700">
              The geographic candidate window contains {candidateCount}{' '}
              records. This local view evaluates the first{' '}
              {NEIGHBORHOOD_CANDIDATE_LIMIT} stable candidates; use the
              directory filters for complete tenant discovery.
            </div>
          )}

          {neighborhoodRetailers.length === 0 ? (
            <div className="rounded-2xl border border-brand-border bg-brand-surface p-12 text-center text-brand-muted">
              No registered retailers found directly within {config.name} at this time.
            </div>
          ) : (
            <div className="space-y-4 sm:grid-cols-2">
              {neighborhoodRetailers.map((retailer, i) => (
                <div
                  key={retailer.id}
                  className={`record-card rounded-2xl p-5 flex flex-col gap-5 md:flex-row ${
                    retailer.isSponsored ? 'ring-1 ring-brand-gold/25' : ''
                  }`}
                >
                  {/* Pin label index */}
                  <div className="w-10 h-10 rounded-full bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-text font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>

                  {/* Details */}
                  <div className="flex-grow space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-brand-text hover:text-brand-primary-text transition-colors">
                        <Link href={`/retailer/${retailer.id}`}>{retailer.name}</Link>
                      </h3>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-brand-border bg-brand-background text-brand-muted">
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

                    <p className="text-sm text-brand-muted flex items-center gap-1">
                      <MapPin size={13} aria-hidden="true" className="text-brand-primary-text/70" />
                      {retailer.address}, {retailer.city} ({getDistanceMiles(config.lat, config.lng, retailer.lat, retailer.lng).toFixed(1)} miles away)
                    </p>

                    {retailer.deals.length > 0 && (
                      <div className="pt-2 flex flex-wrap gap-1">
                        {retailer.deals.map((deal) => (
                          <span key={deal.id} className="inline-flex items-center gap-1 text-[10px] text-orange-700 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-lg">
                            <Flame size={9} aria-hidden="true" />
                            {deal.isDemonstration ? 'Demo offer (not redeemable)' : deal.discount} - {deal.title}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-xs text-brand-muted pt-3 border-t border-brand-border/40 mt-3 flex justify-between items-center">
                      <div>
                        License: <span className="font-semibold text-brand-text/80">
                          {retailer.isDemonstration ? 'Not published for demonstration records' : retailer.licenseNumber || 'Awaiting verification'}
                        </span>
                      </div>
                      <Link
                        href={`/retailer/${retailer.id}`}
                        className="text-brand-primary-text font-bold hover:underline"
                      >
                        View Data Status &amp; Menu →
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* FAQ Section */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-6 mt-6">
            <h2 className="font-display text-lg font-bold text-brand-text mb-4">
              Frequently asked questions about {config.name}
            </h2>
            <dl className="space-y-5">
              {faqEntries.map((entry) => (
                <div key={entry.question}>
                  <dt className="text-sm font-bold text-brand-text">
                    {entry.question}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-brand-muted">
                    {entry.answer}{' '}
                    {entry.question.includes('legally') && (
                      <Link href="/legal" className="font-bold text-brand-primary-text hover:underline">
                        See our legal guide
                      </Link>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Right: Map sidebar centered on the neighborhood */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 flex flex-col h-[350px] relative overflow-hidden">
            <div className="absolute inset-0 bg-brand-background opacity-95 flex flex-col justify-between p-4 pointer-events-none select-none font-mono text-[9px] text-brand-muted">
              <div className="flex justify-between">
                <span>{config.name.toUpperCase()} MAP SECTOR</span>
                <span>LAT: {config.lat.toFixed(4)}</span>
              </div>

              {/* Centered target marker representing the neighborhood center */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border border-dashed border-brand-primary/40 animate-ping absolute"></div>
                <div className="w-3 h-3 rounded-full bg-brand-primary/30 border border-brand-primary flex items-center justify-center">
                  <div className="w-1 h-1 rounded-full bg-brand-primary"></div>
                </div>
                <span className="text-brand-muted bg-brand-surface border border-brand-border px-2 py-0.5 rounded text-[10px] font-sans font-bold tracking-wider mt-12 whitespace-nowrap">
                  {config.name} Center
                </span>
              </div>

              {/* Neighboring retailer pins relative to config center */}
              {neighborhoodRetailers.map((r, i) => {
                // Map coordinates range: +/- 0.03 relative to config lat/lng
                const leftPercent = 50 + ((r.lng - config.lng) / 0.06) * 100;
                const topPercent = 50 - ((r.lat - config.lat) / 0.04) * 100;
                return (
                  <div
                    key={r.id}
                    className="absolute flex flex-col items-center group pointer-events-auto"
                    style={{
                      left: `${Math.max(10, Math.min(90, leftPercent))}%`,
                      top: `${Math.max(10, Math.min(90, topPercent))}%`,
                    }}
                  >
                    <Link href={`/retailer/${r.id}`} className="flex flex-col items-center cursor-pointer">
                      <div className="w-5 h-5 rounded-full bg-brand-primary text-brand-text font-black flex items-center justify-center shadow-lg hover:scale-125 transition-transform text-[10px]">
                        {i + 1}
                      </div>
                      <span className="hidden group-hover:block absolute bottom-6 bg-brand-surface text-brand-text text-[9px] border border-brand-border px-2 py-0.5 rounded whitespace-nowrap shadow-xl z-20 font-sans">
                        {r.name}
                      </span>
                    </Link>
                  </div>
                );
              })}

              <div className="flex justify-between">
                <span>LNG: {config.lng.toFixed(4)}</span>
                <span>ZOOM: 14</span>
              </div>
            </div>
          </div>

          {/* Local Guide Callout */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 text-xs text-brand-muted leading-relaxed">
            <h4 className="font-display font-bold text-brand-text mb-2">Coordinate Preview Notice</h4>
            These points and distance calculations exercise the interface with synthetic records. Confirm real locations, service areas, and license status with primary sources.
          </div>

          {/* Legal link callout */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 text-xs text-brand-muted leading-relaxed">
            <h4 className="font-display font-bold text-brand-text mb-2">D.C. Cannabis Rules</h4>
            <p>New to D.C. cannabis? Read our plain-language overview of Initiative 71, the medical program, possession limits, and consumption rules.</p>
            <Link href="/legal" className="mt-2 inline-block font-bold text-brand-primary-text hover:underline">
              Legal guide →
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
