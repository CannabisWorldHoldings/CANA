import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { MapPin, ArrowRight } from 'lucide-react';
import {
  NEIGHBORHOOD_CONFIGS,
  NEIGHBORHOOD_SLUGS,
} from '@/lib/neighborhood-configs.mjs';
import {
  NEIGHBORHOOD_CANDIDATE_LIMIT,
  neighborhoodCandidateWhere,
} from '@/lib/neighborhood-search.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';

export const metadata = buildPublicMetadata({
  title: 'D.C. Cannabis by Neighborhood — Dispensaries & Delivery Coverage',
  description:
    'Browse Washington, D.C. cannabis retailers by neighborhood: Georgetown, Dupont Circle, Capitol Hill, U Street & Shaw, Navy Yard & The Wharf. Evidence-labeled listings, no pay-to-rank.',
  canonicalPath: '/neighborhoods',
});

export default async function NeighborhoodsIndexPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const origin = await requestOrigin();
  const brand = await prisma.brand.findUnique({ where: { domain } });
  const asOf = new Date();
  const counts = await Promise.all(
    NEIGHBORHOOD_SLUGS.map(async (slug) => {
      const config =
        NEIGHBORHOOD_CONFIGS[slug as keyof typeof NEIGHBORHOOD_CONFIGS];
      if (!brand) return [slug, 0];
      const count = await prisma.retailer.count({
        where: neighborhoodCandidateWhere({
          brandId: brand.id,
          latitude: config.lat,
          longitude: config.lng,
          zips: config.zips,
          asOf,
        }),
      });
      return [slug, Math.min(count, NEIGHBORHOOD_CANDIDATE_LIMIT)];
    }),
  );
  const countBySlug = Object.fromEntries(counts);
  const breadcrumb = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Neighborhoods', url: `${origin.origin}/neighborhoods` },
  ]);

  return (
    <div className="flex-grow animate-fade-in">
      {breadcrumb && <script {...jsonLdScriptProps(breadcrumb)} />}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="kicker mb-4">Washington, D.C. · Coverage map</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            Cannabis by <span className="text-brand-primary-text">neighborhood</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-muted">
            Every neighborhood page lists retailers whose recorded coordinates
            fall inside a fixed geographic window — a deterministic boundary,
            not an advertising radius. Listings keep their evidence and
            freshness labels everywhere they appear.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NEIGHBORHOOD_SLUGS.map((slug) => {
            const config =
        NEIGHBORHOOD_CONFIGS[slug as keyof typeof NEIGHBORHOOD_CONFIGS];
            return (
              <Link
                key={slug}
                href={`/neighborhoods/${slug}`}
                className="record-card group flex flex-col rounded-2xl p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/12 text-brand-primary-text ring-1 ring-brand-primary/25">
                    <MapPin size={18} aria-hidden="true" />
                  </span>
                  <span className="evidence-mono rounded-full border border-brand-border bg-brand-background px-2.5 py-1 text-brand-muted">
                    {countBySlug[slug]} in window
                  </span>
                </div>
                <h2 className="mt-4 font-display text-xl font-bold text-brand-text transition-colors group-hover:text-brand-primary">
                  {config.name}
                </h2>
                <p className="mt-2 flex-grow text-sm leading-relaxed text-brand-muted">
                  {config.blurb}
                </p>
                <p className="evidence-mono mt-3 text-brand-muted/70">
                  ZIP {config.zips.join(' · ')}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-primary-text">
                  View retailers
                  <ArrowRight size={12} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border border-brand-border bg-brand-surface p-6 text-sm leading-relaxed text-brand-muted">
          <h2 className="font-display text-base font-bold text-brand-text">
            How neighborhood pages work
          </h2>
          <p className="mt-2">
            Each page filters by recorded coordinates inside a fixed
            latitude/longitude window around the neighborhood center. Records
            missing verified coordinates are excluded rather than guessed.
            Demonstration records stay visibly labeled, and sponsorship never
            changes ordering.
          </p>
        </div>
      </section>
    </div>
  );
}
