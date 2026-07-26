import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataStatusBadge } from '@/components/data-status-badge';
import { prisma } from '@/lib/prisma';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import {
  currentDealWhere,
  publicCatalogRecordWhere,
} from '@/lib/directory-search.mjs';
import {
  safePublicReferenceUrl,
  safePublicWebsiteUrl,
} from '@/lib/handoff.mjs';
import {
  RETAILER_COMPARE_LIMIT,
  parseRetailerCompareSelection,
  retailerCompareHref,
  retailerCompareWhere,
} from '@/lib/retailer-compare.mjs';

type Props = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{
    retailer?: string | string[];
  }>;
};

export const metadata = {
  title: 'Truth-first retailer comparison',
  description:
    'Compare public retailer records by source, freshness, sponsorship, and evidence eligibility.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = 'force-dynamic';

function formatTimestamp(value: Date | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

function formatConfidence(value: number | null) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return 'Not recorded';
  }
  return `${Math.round(value * 100)}%`;
}

function ComparisonRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <tr className="border-t border-brand-border align-top">
      <th
        scope="row"
        className="sticky left-0 z-10 min-w-40 bg-brand-background px-4 py-4 text-left text-xs font-bold uppercase tracking-wider text-brand-muted"
      >
        {label}
      </th>
      {children}
    </tr>
  );
}

export default async function RetailerComparePage({
  params,
  searchParams,
}: Props) {
  const [{ domain }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true, name: true },
  });
  if (!brand) return notFound();

  const selection = parseRetailerCompareSelection(
    resolvedSearchParams.retailer,
  );
  const asOf = new Date();
  const publicCatalogWhere = publicCatalogRecordWhere(asOf);
  const records =
    selection.ids.length === 0
      ? []
      : await prisma.retailer.findMany({
          where: retailerCompareWhere({
            brandId: brand.id,
            retailerIds: selection.ids,
            asOf,
          }),
          select: {
            id: true,
            name: true,
            type: true,
            city: true,
            state: true,
            dataStatus: true,
            isDemonstration: true,
            dataSource: true,
            sourceUrl: true,
            retrievedAt: true,
            verifiedAt: true,
            freshnessExpiresAt: true,
            confidence: true,
            isSponsored: true,
            licenseNumber: true,
            website: true,
            menuUpdatedAt: true,
            dealUpdatedAt: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: RETAILER_COMPARE_LIMIT,
        });

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const orderedRecords = selection.ids
    .map((id) => recordsById.get(id))
    .filter((record): record is NonNullable<typeof record> => Boolean(record));
  const comparison = await Promise.all(
    orderedRecords.map(async (retailer) => {
      const [menuCount, offerCount] = await Promise.all([
        prisma.menuEntry.count({
          where: {
            retailerId: retailer.id,
            ...publicCatalogWhere,
            product: publicCatalogWhere,
            brandMenus: {
              some: {
                brandId: brand.id,
              },
            },
          },
        }),
        prisma.deal.count({
          where: {
            retailerId: retailer.id,
            ...currentDealWhere(asOf),
          },
        }),
      ]);
      const websiteUrl = safePublicWebsiteUrl(retailer.website);
      return {
        ...retailer,
        menuCount,
        offerCount,
        sourceUrl: safePublicReferenceUrl(retailer.sourceUrl),
        handoffEligible:
          isPubliclyVerified(retailer, asOf) && websiteUrl !== null,
      };
    }),
  );
  const unavailableCount = selection.ids.length - comparison.length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-grow flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <Link
          href="/"
          className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text"
        >
          ← Back to directory
        </Link>
      </div>

      <section className="overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
        <div className="border-b border-brand-border bg-gradient-to-br from-brand-primary/15 via-brand-surface to-brand-surface px-6 py-8 sm:px-8">
          <p className="kicker mb-2">orderweeddc Trust Lens</p>
          <h1 className="font-display text-3xl font-black tracking-tight text-brand-text sm:text-4xl">
            Compare records, not hype.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-brand-muted">
            Compare up to {RETAILER_COMPARE_LIMIT} public records by the
            evidence and freshness orderweeddc can actually prove. This view does not
            rank businesses, infer quality, or turn sponsored placement into a
            trust signal.
          </p>
        </div>
        <div className="grid gap-px bg-brand-border sm:grid-cols-3">
          {[
            ['Evidence', 'Source and review provenance stay visible.'],
            ['Freshness', 'Expired windows cannot appear current.'],
            ['Influence', 'Paid placement is separated from trust.'],
          ].map(([title, description]) => (
            <div key={title} className="bg-brand-background px-6 py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-text">
                {title}
              </p>
              <p className="mt-1 text-xs leading-5 text-brand-muted">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {selection.rejectedCount > 0 && (
        <aside className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-800">
          {selection.rejectedCount} duplicate, malformed, or excess selection
          {selection.rejectedCount === 1 ? ' was' : 's were'} ignored. orderweeddc
          evaluates no more than {RETAILER_COMPARE_LIMIT} records at once.
        </aside>
      )}

      {unavailableCount > 0 && (
        <aside className="rounded-xl border border-brand-border bg-brand-surface px-4 py-3 text-sm text-brand-muted">
          {unavailableCount} selection{unavailableCount === 1 ? '' : 's'} could
          not be displayed inside this tenant&apos;s public evidence boundary.
          No private record details were disclosed.
        </aside>
      )}

      {comparison.length === 0 ? (
        <section className="rounded-2xl border border-brand-border bg-brand-surface px-6 py-16 text-center">
          <h2 className="font-display text-xl font-bold text-brand-text">
            Choose records from the directory
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-brand-muted">
            Select two or three retailer cards to build a bounded comparison.
            Your selection is carried only in the URL; orderweeddc does not create a
            profile or tracking record.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 transition-all"
          >
            Select retailers
          </Link>
        </section>
      ) : (
        <>
          {comparison.length === 1 && (
            <p className="rounded-lg border border-blue-400/20 bg-blue-400/5 px-4 py-3 text-sm text-blue-800">
              One public record is shown. Select at least one more retailer for
              a side-by-side comparison.
            </p>
          )}

          <section
            aria-label="Retailer truth comparison"
            className="overflow-x-auto rounded-xl border border-brand-border bg-brand-surface"
          >
            <table className="w-full min-w-[760px] border-collapse">
              <caption className="sr-only">
                Side-by-side retailer evidence and freshness comparison
              </caption>
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 min-w-40 bg-brand-background px-4 py-5 text-left text-xs font-bold uppercase tracking-wider text-brand-muted">
                    Trust dimension
                  </th>
                  {comparison.map((retailer) => (
                    <th
                      key={retailer.id}
                      scope="col"
                      className="min-w-64 border-l border-brand-border bg-brand-surface px-5 py-5 text-left"
                    >
                      <Link
                        href={`/retailer/${retailer.id}`}
                        className="text-lg font-black text-brand-text hover:text-brand-primary-text"
                      >
                        {retailer.name}
                      </Link>
                      <p className="mt-1 text-xs capitalize text-brand-muted">
                        {retailer.type} · {retailer.city}, {retailer.state}
                      </p>
                      <Link
                        href={retailerCompareHref(
                          selection.ids.filter((id) => id !== retailer.id),
                        )}
                        className="mt-3 inline-flex text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-brand-text"
                      >
                        Remove
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <ComparisonRow label="Public truth state">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4"
                    >
                      <DataStatusBadge
                        dataStatus={retailer.dataStatus}
                        isDemonstration={retailer.isDemonstration}
                        verifiedAt={retailer.verifiedAt}
                        freshnessExpiresAt={retailer.freshnessExpiresAt}
                      />
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Record source">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {retailer.dataSource || 'Unspecified'}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Cited source">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm"
                    >
                      {retailer.sourceUrl ? (
                        <a
                          href={retailer.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-brand-primary-text hover:underline"
                        >
                          Open safe HTTPS source ↗
                        </a>
                      ) : (
                        <span className="text-brand-muted">
                          No safe public source URL
                        </span>
                      )}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Source retrieved">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.retrievedAt)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Verified at">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.verifiedAt)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Freshness expires">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.freshnessExpiresAt)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Recorded confidence">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatConfidence(retailer.confidence)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="License claim">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {retailer.isDemonstration
                        ? 'Not published for demonstration records'
                        : retailer.licenseNumber || 'Awaiting verification'}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Paid placement">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {retailer.isSponsored
                        ? 'Yes — separated from trust state'
                        : 'No paid placement recorded'}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Evidence-eligible menu">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm font-bold text-brand-text"
                    >
                      {retailer.menuCount} item
                      {retailer.menuCount === 1 ? '' : 's'}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Evidence-eligible offers">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm font-bold text-brand-text"
                    >
                      {retailer.offerCount} offer
                      {retailer.offerCount === 1 ? '' : 's'}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Menu last updated">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.menuUpdatedAt)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Offers last updated">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.dealUpdatedAt)}
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Public handoff">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm"
                    >
                      <span
                        className={
                          retailer.handoffEligible
                            ? 'font-bold text-brand-primary'
                            : 'text-brand-muted'
                        }
                      >
                        {retailer.handoffEligible
                          ? 'Eligible after current verification'
                          : 'Locked by truth or destination policy'}
                      </span>
                    </td>
                  ))}
                </ComparisonRow>
                <ComparisonRow label="Record last changed">
                  {comparison.map((retailer) => (
                    <td
                      key={retailer.id}
                      className="border-l border-brand-border px-5 py-4 text-sm text-brand-text"
                    >
                      {formatTimestamp(retailer.updatedAt)}
                    </td>
                  ))}
                </ComparisonRow>
              </tbody>
            </table>
          </section>
        </>
      )}

      <aside className="rounded-lg border border-violet-400/20 bg-violet-400/5 px-5 py-4 text-xs leading-5 text-violet-800">
        Comparison is descriptive, not a recommendation. A visible record is
        not proof of licensure, product availability, service area, quality, or
        legality. Confirm consequential claims with the cited primary source.
      </aside>
    </div>
  );
}
