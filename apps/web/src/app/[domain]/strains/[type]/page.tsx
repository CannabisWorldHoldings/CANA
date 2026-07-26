import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, FlaskConical, Sprout } from 'lucide-react';
import { STRAIN_SLUGS, STRAIN_TYPES } from '@/lib/strain-content.mjs';
import { productDiscoveryWhere } from '@/lib/product-discovery.mjs';
import { clampSeoText } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScriptProps,
  strainProductJsonLd,
} from '@/lib/structured-data.mjs';

type Props = {
  params: Promise<{ domain: string; type: string }>;
};

function strainForSlug(slug: string) {
  return Object.prototype.hasOwnProperty.call(STRAIN_TYPES, slug)
    ? STRAIN_TYPES[slug as keyof typeof STRAIN_TYPES]
    : null;
}

export async function generateMetadata({ params }: Props) {
  const { type } = await params;
  const strain = strainForSlug(type);
  if (!strain) {
    return {
      title: 'Strain Type Not Found',
      robots: { index: false, follow: false, nocache: true },
    };
  }
  const title = clampSeoText(`${strain.headline} — What the Label Means`, 65);
  const description = clampSeoText(strain.summary, 160);
  return {
    title,
    description,
    alternates: { canonical: `/strains/${type}` },
    openGraph: {
      title,
      description,
      type: 'article',
      locale: 'en_US',
      url: `/strains/${type}`,
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

export default async function StrainTypePage({ params }: Props) {
  const { domain, type } = await params;
  const strain = strainForSlug(type);
  if (!strain) return notFound();

  const origin = await requestOrigin();
  const brand = await prisma.brand.findUnique({ where: { domain } });
  const asOf = new Date();
  const recordCount = brand
    ? await prisma.menuEntry.count({
        where: productDiscoveryWhere({
          brandId: brand.id,
          filters: { strainType: type },
          asOf,
        }),
      })
    : 0;

  const breadcrumb = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Strain types', url: `${origin.origin}/strains` },
    { name: strain.name, url: `${origin.origin}/strains/${type}` },
  ]);
  const faq = faqJsonLd(strain.faq);
  const productLd = strainProductJsonLd({ strain, slug: type, recordCount, origin: origin.origin });
  const otherSlugs = STRAIN_SLUGS.filter((slug) => slug !== type);

  return (
    <div className="flex-grow animate-fade-in">
      {breadcrumb && <script {...jsonLdScriptProps(breadcrumb)} />}
      {faq && <script {...jsonLdScriptProps(faq)} />}
      {productLd && <script {...jsonLdScriptProps(productLd)} />}

      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/strains"
            className="mb-6 inline-flex items-center gap-1 text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text"
          >
            <ArrowLeft size={12} aria-hidden="true" /> All strain types
          </Link>
          <p className="kicker mb-4">Strain guide · Not medical advice</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            {strain.name}{' '}
            <span className="text-brand-primary-text">in Washington, D.C.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-muted">
            {strain.summary}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/products?strainType=${type}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary-fill-strong px-5 py-2.5 text-xs font-bold text-white transition-all hover:brightness-110"
            >
              Browse {recordCount} evidence-eligible {strain.name.toLowerCase()} records
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border px-5 py-2.5 text-xs font-bold text-brand-muted transition-colors hover:border-brand-primary/40 hover:text-brand-text"
            >
              Find retailers
            </Link>
          </div>

          {/* Marketing-convention axis (adapted from Leafly's effect scale,
              recast honestly): shows where the INDUSTRY MARKETS this label,
              never a predicted effect. Hidden for types without an axis. */}
          {typeof strain.marketedAxis === 'number' && (
            <div className="mt-8 max-w-md">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                <span>Marketed as calming</span>
                <span>Marketed as energizing</span>
              </div>
              <div
                className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-indigo-300/60 via-brand-raised to-amber-300/70"
                role="img"
                aria-label={`${strain.name} is conventionally marketed ${
                  strain.marketedAxis >= 60
                    ? 'toward the energizing end'
                    : strain.marketedAxis <= 40
                      ? 'toward the calming end'
                      : 'in the middle'
                } of the industry axis. This describes marketing convention, not a predicted effect.`}
              >
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-brand-primary shadow"
                  style={{ left: `${strain.marketedAxis}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-brand-muted/80">
                Industry marketing convention only — labels do not predict
                effects. Tested cannabinoid and terpene content is a better
                guide.
              </p>
            </div>
          )}

          {/* Shop this label by format (record-backed filters, not claims). */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand-muted">
              Shop {strain.name.toLowerCase()} by format:
            </span>
            {[
              ['Flower', 'flower'],
              ['Vapes', 'vapes'],
              ['Pre-rolls', 'pre-rolls'],
              ['Edibles', 'edibles'],
            ].map(([label, category]) => (
              <Link
                key={category}
                href={`/products?strainType=${type}&category=${encodeURIComponent(category)}`}
                className="inline-flex items-center rounded-full border border-brand-border bg-brand-surface px-3 py-1 text-[11px] font-bold text-brand-muted transition-colors hover:border-brand-primary/50 hover:text-brand-primary-text"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-text">
            <FlaskConical size={18} className="text-brand-primary-text" aria-hidden="true" />
            What the label actually tells you
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-brand-muted">
            {strain.facts.map((fact) => (
              <li key={fact} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" aria-hidden="true" />
                {fact}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <h2 className="font-display text-lg font-bold text-brand-text">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-5">
            {strain.faq.map((entry) => (
              <div key={entry.question}>
                <dt className="text-sm font-bold text-brand-text">{entry.question}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-brand-muted">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        <nav aria-label="Other strain types" className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <p className="kicker mb-3">Keep exploring</p>
          <div className="flex flex-wrap gap-2">
            {otherSlugs.map((slug) => {
              const other = STRAIN_TYPES[slug as keyof typeof STRAIN_TYPES];
              return (
                <Link
                  key={slug}
                  href={`/strains/${slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-background px-3 py-1.5 text-xs font-bold text-brand-muted transition-colors hover:border-brand-primary/50 hover:text-brand-primary-text"
                >
                  <Sprout size={11} aria-hidden="true" />
                  {other.name}
                </Link>
              );
            })}
            <Link
              href="/education"
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-3 py-1.5 text-xs font-bold text-brand-primary-text transition-colors hover:bg-brand-primary/20"
            >
              Education hub →
            </Link>
          </div>
        </nav>

        <p className="text-center text-[11px] leading-relaxed text-brand-muted/80">
          Category labels are marketing shorthand, not clinical claims.
          Individual responses vary. 21+ only. See the{' '}
          <Link href="/legal" className="underline hover:text-brand-primary-text">
            legal &amp; compliance guide
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
