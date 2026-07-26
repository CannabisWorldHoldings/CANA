import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { DataStatusBadge } from '@/components/data-status-badge';
import {
  EDUCATION_PAGE_SIZE,
  EDUCATION_QUERY_MAX_LENGTH,
  clampEducationPage,
  educationHubHref,
  educationPageCount,
  educationPageOffset,
  parseEducationHubSearch,
} from '@/lib/education-search.mjs';
import { publicCatalogRecordWhere } from '@/lib/directory-search.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import DosageCalculator from '@/components/dosage-calculator';
import { BookOpen, Leaf } from 'lucide-react';

type Props = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{
    strain?: string | string[];
    articlePage?: string | string[];
    strainPage?: string | string[];
  }>;
};

type EducationPageKey = 'articlePage' | 'strainPage';

type EducationSearch = {
  strain: string;
  articlePage: number;
  strainPage: number;
};

export const dynamic = 'force-dynamic';

export const metadata = {
  ...buildPublicMetadata({
  title: 'Cannabis Education Hub — D.C. Rules, Strains & Safety Guides',
  description:
    'Explore D.C. cannabis legal frameworks, terpene science guides, and an evidence-labeled strain catalog for Washington D.C. residents.',
  canonicalPath: '/education',
}),
  alternates: {
    canonical: '/education',
  },
};

function EducationPagination({
  search,
  pageKey,
  totalItems,
  label,
}: {
  search: EducationSearch;
  pageKey: EducationPageKey;
  totalItems: number;
  label: string;
}) {
  const currentPage = search[pageKey];
  const totalPages = educationPageCount(totalItems);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex items-center justify-between gap-3 border-t border-brand-border pt-4 text-xs"
    >
      {currentPage > 1 ? (
        <Link
          href={educationHubHref(search, pageKey, currentPage - 1)}
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
          href={educationHubHref(search, pageKey, currentPage + 1)}
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

export default async function EducationHubPage({ params, searchParams }: Props) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const requestedSearch = parseEducationHubSearch(resolvedSearchParams);
  const asOf = new Date();
  const publicRecordWhere = publicCatalogRecordWhere(asOf);

  // 1. Fetch brand
  const brand = await prisma.brand.findUnique({
    where: { domain: resolvedParams.domain },
  });

  if (!brand) {
    return <div className="text-center p-8 bg-brand-background text-brand-text">Error: Brand not found.</div>;
  }

  const strainWhere = {
    ...publicRecordWhere,
    category: 'flower',
    name: requestedSearch.strain
      ? { contains: requestedSearch.strain }
      : undefined,
  };
  const [articleCount, strainCount] = await Promise.all([
    prisma.article.count({ where: publicRecordWhere }),
    prisma.product.count({ where: strainWhere }),
  ]);
  const search: EducationSearch = {
    strain: requestedSearch.strain,
    articlePage: clampEducationPage(
      requestedSearch.articlePage,
      articleCount,
    ),
    strainPage: clampEducationPage(requestedSearch.strainPage, strainCount),
  };

  // 2. Fetch independently bounded public education collections.
  const [articles, strains] = await Promise.all([
    prisma.article.findMany({
      where: publicRecordWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: educationPageOffset(search.articlePage),
      take: EDUCATION_PAGE_SIZE,
    }),
    prisma.product.findMany({
      where: strainWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: educationPageOffset(search.strainPage),
      take: EDUCATION_PAGE_SIZE,
    }),
  ]);

  return (
    <div className="flex-grow animate-fade-in">

      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text">
            ← Back to directory
          </Link>
          <p className="kicker mt-5 mb-3">Science &amp; Legislation</p>
          <h1 className="font-display text-2xl font-extrabold text-brand-text sm:text-3xl">
            D.C. Cannabis{' '}
            <span className="text-brand-primary-text">Education &amp; Strain Guide</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-muted">
            Explore legal frameworks, terpene science guides, and cataloged strains in Washington D.C.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Interactive Dosage Calculator */}
        <DosageCalculator />

        {/* Columns: Articles vs Strain Dictionary */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

          {/* Left Column: Educational Articles */}
          <div className="lg:col-span-2 space-y-6">
            <h2 className="font-display flex items-center gap-2 text-lg font-bold text-brand-text border-b border-brand-border pb-2">
              <BookOpen size={18} aria-hidden="true" className="text-brand-primary-text" />
              Published Articles
            </h2>

            <div className="space-y-6">
              {articles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-brand-border bg-brand-surface p-8 text-center text-sm text-brand-muted">
                  No evidence-eligible educational articles are available.
                </div>
              ) : (
                articles.map((article) => (
                  <div key={article.id} className="record-card rounded-2xl p-5 space-y-3 hover:border-brand-primary/20 transition-all">
                    <h3 className="font-display text-base font-bold text-brand-text hover:text-brand-primary-text transition-colors">
                      <Link href={`/education/${encodeURIComponent(article.slug)}`} className="inline-block py-0.5">{article.title}</Link>
                    </h3>
                    <DataStatusBadge
                      dataStatus={article.dataStatus}
                      isDemonstration={article.isDemonstration}
                      verifiedAt={article.verifiedAt}
                      freshnessExpiresAt={article.freshnessExpiresAt}
                      compact
                    />

                    <p className="text-xs text-brand-muted leading-relaxed line-clamp-3">
                      {article.content}
                    </p>

                    <div className="text-[10px] text-brand-muted flex justify-between pt-2 border-t border-brand-border/40">
                      <div>By <span className="font-semibold text-brand-text/80">{article.author}</span></div>
                      <div>Published: {new Date(article.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))
              )}
              <EducationPagination
                search={search}
                pageKey="articlePage"
                totalItems={articleCount}
                label="Article"
              />
            </div>
          </div>

          {/* Right Column: Strain Glossary */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-4">
              <h2 className="font-display flex items-center gap-2 text-sm font-bold text-brand-text">
                <Leaf size={16} aria-hidden="true" className="text-brand-primary-text" />
                Strain Dictionary Glossary
              </h2>

              {/* Strain Search form */}
              <form method="GET" className="flex gap-2">
                <label htmlFor="strain-search" className="sr-only">
                  Search the demonstration strain catalog
                </label>
                <input
                  id="strain-search"
                  type="text"
                  name="strain"
                  placeholder="Search strains (e.g. Sour)..."
                  defaultValue={search.strain}
                  maxLength={EDUCATION_QUERY_MAX_LENGTH}
                  className="bg-brand-background border border-brand-border text-brand-text px-3 py-1.5 rounded-xl text-xs focus:outline-none focus:border-brand-primary w-full transition-colors"
                />
                {search.articlePage > 1 && (
                  <input
                    type="hidden"
                    name="articlePage"
                    value={search.articlePage}
                  />
                )}
                <button type="submit" className="bg-brand-primary-fill-strong text-white font-bold text-xs px-3.5 py-1.5 rounded-xl hover:brightness-110 transition-all">
                  Go
                </button>
              </form>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {strains.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-4">No strains matching your query in the catalog.</p>
                ) : (
                  strains.map((strain) => (
                    <div key={strain.id} className="bg-brand-background/40 border border-brand-border p-3.5 rounded-xl space-y-1">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-xs font-bold text-brand-text">{strain.name}</h3>
                        <span className="text-[9px] bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-text font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                          {strain.strainType}
                        </span>
                      </div>
                      <DataStatusBadge
                        dataStatus={strain.dataStatus}
                        isDemonstration={strain.isDemonstration}
                        verifiedAt={strain.verifiedAt}
                        freshnessExpiresAt={strain.freshnessExpiresAt}
                        compact
                      />

                      <p className="text-[10px] text-brand-muted leading-normal">
                        {strain.description}
                      </p>

                      <div className="text-[9px] text-brand-muted flex gap-2 pt-1">
                        {strain.thcPercent && <span>THC: {strain.thcPercent}%</span>}
                        {strain.cbdPercent && <span>• CBD: {strain.cbdPercent}%</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <p className="text-[10px] text-brand-muted">
                {strainCount} eligible strain record
                {strainCount === 1 ? '' : 's'} match this search.
              </p>
              <EducationPagination
                search={search}
                pageKey="strainPage"
                totalItems={strainCount}
                label="Strain"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
