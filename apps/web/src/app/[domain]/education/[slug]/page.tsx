import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataStatusBadge } from '@/components/data-status-badge';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import { publicCatalogRecordWhere } from '@/lib/directory-search.mjs';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';
import { ShieldAlert } from 'lucide-react';

type Props = {
  params: Promise<{ domain: string; slug: string }>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { domain, slug } = await params;
  const asOf = new Date();
  const [brand, article] = await Promise.all([
    prisma.brand.findUnique({
      where: { domain },
      select: { name: true },
    }),
    prisma.article.findFirst({
      where: {
        slug,
        ...publicCatalogRecordWhere(asOf),
      },
      select: {
        title: true,
        content: true,
        dataStatus: true,
        isDemonstration: true,
        verifiedAt: true,
        freshnessExpiresAt: true,
      },
    }),
  ]);
  if (!brand || !article) {
    return { title: 'Article Not Found | Order Weed DC' };
  }

  const indexable = isPubliclyVerified(article);
  const description = article.content.slice(0, 160);
  return {
    title: `${article.title} | ${brand.name}`,
    description,
    robots: {
      index: indexable,
      follow: indexable,
    },
    alternates: {
      canonical: `/education/${encodeURIComponent(slug)}`,
    },
    openGraph: {
      title: `${article.title} | ${brand.name}`,
      description,
      type: 'article',
      url: `/education/${encodeURIComponent(slug)}`,
      images: [{ url: '/og-default.jpg', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${article.title} | ${brand.name}`,
      description,
      images: ['/og-default.jpg'],
    },
  };
}

export default async function EducationalArticleDetailPage({ params }: Props) {
  const { domain, slug } = await params;
  const origin = await requestOrigin();
  const asOf = new Date();

  // 1. Fetch brand context
  const brand = await prisma.brand.findUnique({
    where: { domain: domain },
  });

  if (!brand) return notFound();

  // 2. Fetch the educational article by slug
  const article = await prisma.article.findFirst({
    where: {
      slug,
      ...publicCatalogRecordWhere(asOf),
    },
  });

  if (!article) return notFound();

  // 3. Truth-aware structured data using articleJsonLd from structured-data.mjs
  const indexable = isPubliclyVerified(article);
  const articleLd = articleJsonLd({ article, origin: origin.origin });
  if (articleLd && article.verifiedAt) {
    // Truth law: the published date machines see is the verification date.
    articleLd.datePublished = article.verifiedAt.toISOString();
  }
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Education', url: `${origin.origin}/education` },
    { name: article.title, url: `${origin.origin}/education/${encodeURIComponent(article.slug)}` },
  ]);

  return (
    <div className="flex-grow animate-fade-in">
      {/* Truth-aware JSON-LD (only for index-eligible records) */}
      {indexable && (
        <>
          {articleLd && <script {...jsonLdScriptProps(articleLd)} />}
          {breadcrumbLd && <script {...jsonLdScriptProps(breadcrumbLd)} />}
        </>
      )}

      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Link href="/education" className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text">
            ← Back to educational guide
          </Link>
          <p className="kicker mt-5 mb-3">Article</p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand-text sm:text-4xl leading-tight">
            {article.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-brand-muted">
            <DataStatusBadge
              dataStatus={article.dataStatus}
              isDemonstration={article.isDemonstration}
              verifiedAt={article.verifiedAt}
              freshnessExpiresAt={article.freshnessExpiresAt}
            />
            <div>By <span className="font-semibold text-brand-text/80">{article.author}</span></div>
            <div>•</div>
            <div>Published: {new Date(article.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </section>

      {/* Article Container */}
      <div className="mx-auto max-w-4xl w-full px-4 sm:px-6 py-8 space-y-6">
        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6 sm:p-8 space-y-6">

          {/* Content Body */}
          <div className="text-sm text-brand-text leading-relaxed space-y-4 whitespace-pre-line">
            {article.content}
          </div>

          {/* Informational Legal Notice */}
          <div className="flex items-start gap-3 rounded-2xl border border-brand-border bg-brand-background/40 p-4 text-xs text-brand-muted mt-8">
            <ShieldAlert size={14} aria-hidden="true" className="shrink-0 text-brand-muted mt-0.5" />
            <p>
              <strong className="text-brand-text">Content Notice:</strong> This record&apos;s status and source are shown above. Demonstration drafts are synthetic and unpublished. Nothing on this page constitutes medical, health, legal, safety, or regulatory advice; consult an authoritative primary source.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
