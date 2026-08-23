import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';

import { assertAdmin, requireAdmin } from '@/lib/auth/session';
import {
  EXPERIENCE_REVIEW_CLOSED_STATES,
  EXPERIENCE_REVIEW_INBOX_PAGE_SIZE,
  buildExperienceReviewMutationInput,
  clampExperienceReviewPage,
  experienceReviewInboxHref,
  experienceReviewPageCount,
  experienceReviewPageOffset,
  parseExperienceReviewAction,
  parseExperienceReviewInboxSearch,
  projectExperienceReviewCandidate,
} from '@/lib/experience-review-inbox.mjs';
import { reviewExperienceCandidate } from '@/lib/experience-review-mutations.mjs';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type QueueKey = 'pendingPage' | 'reviewedPage';
type InboxPages = Record<QueueKey, number>;
type Props = {
  searchParams: Promise<Partial<Record<QueueKey, string | string[]>>>;
};

const candidateSelect = {
  id: true,
  tenant: true,
  siteId: true,
  merchantId: true,
  sourceKind: true,
  sourceArtifact: true,
  sourceRevision: true,
  payloadSha256: true,
  evidenceRefs: true,
  rightsState: true,
  accessibilityState: true,
  policyState: true,
  uncertaintyState: true,
  lifecycle: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  receipts: {
    select: {
      decision: true,
      reasonCode: true,
      createdAt: true,
    },
    orderBy: [{ sequence: 'desc' }],
    take: 1,
  },
} satisfies Prisma.ExperienceReviewCandidateSelect;

function formatUtc(value: Date | undefined) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return 'UNKNOWN';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function lifecycleStyle(lifecycle: string) {
  switch (lifecycle) {
    case 'PENDING_REVIEW':
      return 'border-amber-700/30 bg-amber-50 text-amber-900';
    case 'APPROVED_FOR_DRAFT_ONLY':
      return 'border-emerald-700/30 bg-emerald-50 text-emerald-900';
    case 'REJECTED':
      return 'border-rose-700/30 bg-rose-50 text-rose-900';
    case 'RETURNED_FOR_EVIDENCE':
      return 'border-sky-700/30 bg-sky-50 text-sky-900';
    default:
      return 'border-slate-400 bg-slate-100 text-slate-900';
  }
}

function QueuePagination({
  pages,
  queueKey,
  totalItems,
}: {
  pages: InboxPages;
  queueKey: QueueKey;
  totalItems: number;
}) {
  const currentPage = pages[queueKey];
  const totalPages = experienceReviewPageCount(totalItems);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={`${queueKey === 'pendingPage' ? 'Pending' : 'Reviewed'} candidates pagination`}
      className="flex items-center justify-between gap-4 border-t border-brand-border pt-5 text-sm"
    >
      {currentPage > 1 ? (
        <Link
          href={experienceReviewInboxHref(pages, queueKey, currentPage - 1)}
          className="font-semibold text-brand-primary-text hover:underline"
        >
          Previous
        </Link>
      ) : <span />}
      <span className="text-brand-muted">Page {currentPage} of {totalPages}</span>
      {currentPage < totalPages ? (
        <Link
          href={experienceReviewInboxHref(pages, queueKey, currentPage + 1)}
          className="font-semibold text-brand-primary-text hover:underline"
        >
          Next
        </Link>
      ) : <span />}
    </nav>
  );
}

function CandidateCard({ candidate, reviewAction }: {
  candidate: ReturnType<typeof projectExperienceReviewCandidate>;
  reviewAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <article className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${lifecycleStyle(candidate.lifecycle)}`}>
              {candidate.lifecycle}
            </span>
            <span className="rounded-full bg-brand-raised px-2.5 py-1 text-xs font-semibold text-brand-primary-text">
              {candidate.sourceKind}
            </span>
          </div>
          <h3 className="break-words text-lg font-semibold text-brand-text">
            {candidate.sourceArtifact}
          </h3>
          <p className="text-sm text-brand-muted">
            {candidate.tenant} · {candidate.siteId ?? candidate.merchantId ?? 'Shared owner scope'}
          </p>
        </div>
        <div className="shrink-0 text-left text-xs text-brand-muted sm:text-right">
          <p>Version {candidate.version ?? 'UNKNOWN'}</p>
          <p>{formatUtc(candidate.createdAt)} UTC</p>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 rounded-xl bg-brand-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Rights', candidate.rightsState],
          ['Accessibility', candidate.accessibilityState],
          ['Policy', candidate.policyState],
          ['Uncertainty', candidate.uncertaintyState],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-brand-muted">{label}</dt>
            <dd className="mt-1 font-semibold text-brand-text">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <p className="text-xs font-medium text-brand-muted">Source revision</p>
          <p className="mt-1 break-all font-mono text-xs text-brand-text">{candidate.sourceRevision}</p>
          <p className="mt-3 text-xs font-medium text-brand-muted">Payload digest</p>
          <p className="mt-1 break-all font-mono text-xs text-brand-text">
            {candidate.payloadSha256 === 'UNKNOWN'
              ? 'UNKNOWN'
              : `sha256:${candidate.payloadSha256}`}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-brand-muted">
            Evidence · {candidate.evidenceState}
          </p>
          {candidate.evidenceRefs.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {candidate.evidenceRefs.map((evidence: { ref: string; sha256: string }) => (
                <li key={evidence.ref} className="rounded-lg border border-brand-border bg-white px-3 py-2">
                  <p className="break-words text-xs font-medium text-brand-text">{evidence.ref}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-brand-muted">sha256:{evidence.sha256}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              Digest-addressed evidence is unavailable. This candidate cannot be decided.
            </p>
          )}
        </div>
      </div>

      {candidate.latestReceipt ? (
        <div className="mt-5 rounded-xl border border-brand-border bg-brand-raised p-4 text-sm">
          <p className="font-semibold text-brand-text">Recorded decision: {candidate.latestReceipt.decision}</p>
          <p className="mt-1 text-brand-muted">
            {candidate.latestReceipt.reasonCode} · {formatUtc(candidate.latestReceipt.createdAt)} UTC
          </p>
          <p className="mt-2 text-xs font-medium text-brand-primary-text">
            Execution false · publication false · deployment false
          </p>
        </div>
      ) : null}

      {reviewAction && candidate.decisionEligible ? (
        <form action={reviewAction} className="mt-5 flex flex-col gap-3 border-t border-brand-border pt-5 sm:flex-row">
          <input type="hidden" name="candidateId" value={candidate.id} />
          <input type="hidden" name="candidateVersion" value={candidate.version} />
          <button
            type="submit"
            name="decision"
            value="APPROVED_FOR_DRAFT_ONLY"
            className="rounded-lg bg-brand-primary-fill-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Approve for draft
          </button>
          <button
            type="submit"
            name="decision"
            value="REJECTED"
            className="rounded-lg border border-rose-700/40 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-900 transition hover:bg-rose-100"
          >
            Reject
          </button>
          <button
            type="submit"
            name="decision"
            value="RETURNED_FOR_EVIDENCE"
            className="rounded-lg border border-sky-700/40 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-900 transition hover:bg-sky-100"
          >
            Return for evidence
          </button>
        </form>
      ) : null}
    </article>
  );
}

export default async function ExperienceReviewPage({ searchParams }: Props) {
  await requireAdmin();
  const requestedPages = parseExperienceReviewInboxSearch(await searchParams);
  const pendingWhere = { lifecycle: 'PENDING_REVIEW' } as const;
  const reviewedWhere = { lifecycle: { in: [...EXPERIENCE_REVIEW_CLOSED_STATES] } };

  const [pendingCount, reviewedCount] = await Promise.all([
    prisma.experienceReviewCandidate.count({ where: pendingWhere }),
    prisma.experienceReviewCandidate.count({ where: reviewedWhere }),
  ]);
  const pages: InboxPages = {
    pendingPage: clampExperienceReviewPage(requestedPages.pendingPage, pendingCount),
    reviewedPage: clampExperienceReviewPage(requestedPages.reviewedPage, reviewedCount),
  };

  const [pendingRows, reviewedRows] = await Promise.all([
    prisma.experienceReviewCandidate.findMany({
      where: pendingWhere,
      select: candidateSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: experienceReviewPageOffset(pages.pendingPage),
      take: EXPERIENCE_REVIEW_INBOX_PAGE_SIZE,
    }),
    prisma.experienceReviewCandidate.findMany({
      where: reviewedWhere,
      select: candidateSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: experienceReviewPageOffset(pages.reviewedPage),
      take: EXPERIENCE_REVIEW_INBOX_PAGE_SIZE,
    }),
  ]);

  async function settleExperienceReview(formData: FormData) {
    'use server';
    const actor = await assertAdmin();
    const action = parseExperienceReviewAction(formData);
    const candidate = await prisma.experienceReviewCandidate.findUnique({
      where: { id: action.candidateId },
      select: {
        id: true,
        tenant: true,
        payloadSha256: true,
        evidenceRefs: true,
      },
    });
    const request = buildExperienceReviewMutationInput({
      candidate,
      action,
      actor: { userId: actor.userId, role: actor.role },
    });
    await reviewExperienceCandidate(prisma, request);
    revalidatePath('/admin/experience-review');
    revalidatePath('/admin');
  }

  const pending = pendingRows.map(projectExperienceReviewCandidate);
  const reviewed = reviewedRows.map(projectExperienceReviewCandidate);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-6 border-b border-brand-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <span className="inline-flex rounded-full bg-brand-raised px-3 py-1 text-xs font-semibold text-brand-primary-text">
            CANA / Owner · authenticated
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-brand-text sm:text-4xl">
            Experience review inbox
          </h1>
          <p className="max-w-2xl text-base leading-7 text-brand-muted">
            Inspect digest-bound SiteMind, merchant media, and Experience Fabric candidates.
            Every decision is receipt-backed and draft-only. Nothing here can publish,
            deploy, promote, or execute a production effect.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex w-fit rounded-lg border border-brand-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-text transition hover:bg-brand-surface"
        >
          Back to control tower
        </Link>
      </header>

      <section aria-labelledby="pending-review-heading" className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-900">Decision required</p>
            <h2 id="pending-review-heading" className="mt-1 text-2xl font-semibold text-brand-text">
              Pending review
            </h2>
          </div>
          <p aria-live="polite" className="text-sm text-brand-muted">{pendingCount} pending</p>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-brand-border bg-brand-surface px-6 py-12 text-center">
            <p className="font-semibold text-brand-text">No candidates are waiting.</p>
            <p className="mt-2 text-sm text-brand-muted">New candidates appear only after their source court and evidence boundary pass.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} reviewAction={settleExperienceReview} />
            ))}
          </div>
        )}
        <QueuePagination pages={pages} queueKey="pendingPage" totalItems={pendingCount} />
      </section>

      <section aria-labelledby="reviewed-heading" className="space-y-5 border-t border-brand-border pt-9">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-primary-text">Receipt-backed history</p>
            <h2 id="reviewed-heading" className="mt-1 text-2xl font-semibold text-brand-text">
              Reviewed
            </h2>
          </div>
          <p className="text-sm text-brand-muted">{reviewedCount} reviewed</p>
        </div>
        {reviewed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-brand-border bg-brand-surface px-6 py-10 text-center">
            <p className="font-semibold text-brand-text">No review receipts yet.</p>
            <p className="mt-2 text-sm text-brand-muted">Completed decisions remain visible here without creating promotion authority.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviewed.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        )}
        <QueuePagination pages={pages} queueKey="reviewedPage" totalItems={reviewedCount} />
      </section>
    </main>
  );
}
