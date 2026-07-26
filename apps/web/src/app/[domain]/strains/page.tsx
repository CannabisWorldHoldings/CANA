import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ArrowRight, Sprout } from 'lucide-react';
import { STRAIN_SLUGS, STRAIN_TYPES } from '@/lib/strain-content.mjs';
import { productDiscoveryWhere } from '@/lib/product-discovery.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';

export const metadata = buildPublicMetadata({
  title: 'Cannabis Strain Types Explained — Sativa, Indica, Hybrid & CBD',
  description:
    'What strain-type labels actually mean, why tested cannabinoid content matters more, and where to find evidence-labeled sativa, indica, hybrid, and CBD products in Washington, D.C.',
  canonicalPath: '/strains',
});

export default async function StrainsIndexPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const origin = await requestOrigin();
  const brand = await prisma.brand.findUnique({ where: { domain } });
  const asOf = new Date();
  const counts = await Promise.all(
    STRAIN_SLUGS.map(async (slug) => {
      if (!brand) return [slug, 0] as const;
      const count = await prisma.menuEntry.count({
        where: productDiscoveryWhere({
          brandId: brand.id,
          filters: { strainType: slug },
          asOf,
        }),
      });
      return [slug, count] as const;
    }),
  );
  const countBySlug = Object.fromEntries(counts);
  const breadcrumb = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Strain types', url: `${origin.origin}/strains` },
  ]);

  return (
    <div className="flex-grow animate-fade-in">
      {breadcrumb && <script {...jsonLdScriptProps(breadcrumb)} />}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="kicker mb-4">Product knowledge · No effect guarantees</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            Strain types, <span className="text-brand-primary-text">honestly explained</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-muted">
            Sativa, indica, hybrid, and CBD are industry labels — useful for
            browsing, unreliable as effect promises. These guides explain what
            each label actually tells you and link to evidence-labeled product
            records. Not medical advice.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STRAIN_SLUGS.map((slug) => {
            const strain = STRAIN_TYPES[slug as keyof typeof STRAIN_TYPES];
            return (
              <Link
                key={slug}
                href={`/strains/${slug}`}
                className="record-card group flex flex-col rounded-2xl p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/12 text-brand-primary-text ring-1 ring-brand-primary/25">
                  <Sprout size={18} aria-hidden="true" />
                </span>
                <h2 className="mt-4 font-display text-xl font-bold text-brand-text transition-colors group-hover:text-brand-primary">
                  {strain.name}
                </h2>
                <p className="mt-2 flex-grow text-sm leading-relaxed text-brand-muted">
                  {strain.summary.split('.')[0]}.
                </p>
                <p className="evidence-mono mt-3 text-brand-muted/70">
                  {countBySlug[slug]} evidence-eligible records
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-primary-text">
                  Read the guide
                  <ArrowRight size={12} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
