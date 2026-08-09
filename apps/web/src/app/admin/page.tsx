import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { isPubliclyVerified } from '@/lib/data-status.mjs';
import { redirect } from 'next/navigation';
import {
  ADMIN_QUEUE_PAGE_SIZE,
  adminQueueHref,
  clampQueuePage,
  parseAdminDashboardSearch,
  queuePageCount,
  queuePageOffset,
} from '@/lib/admin-dashboard.mjs';
import {
  approveLicenseEvidence,
  rejectLicenseEvidence,
  refreshRetailerVerification,
  resolveCorrectionDispute,
  resolveRetailerClaim,
} from '@/lib/admin-mutations.mjs';
import {
  assertAdmin,
  destroySession,
  requireAdmin,
} from '@/lib/auth/session';
import { canonicalPlatformUrl } from '@/lib/server-request-url';
import { currentPublicRecordWhere } from '@/lib/seo-truth.mjs';

export const dynamic = 'force-dynamic';

type QueueKey =
  | 'evidencePage'
  | 'claimPage'
  | 'disputePage'
  | 'stalePage';

type AdminPages = Record<QueueKey, number>;

type Props = {
  searchParams: Promise<Partial<Record<QueueKey, string | string[]>>>;
};

function QueuePagination({
  pages,
  queueKey,
  totalItems,
}: {
  pages: AdminPages;
  queueKey: QueueKey;
  totalItems: number;
}) {
  const currentPage = pages[queueKey];
  const totalPages = queuePageCount(totalItems);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={`${queueKey} pagination`}
      className="flex items-center justify-between gap-3 border-t border-brand-border/50 pt-3 text-xs"
    >
      {currentPage > 1 ? (
        <Link
          href={adminQueueHref(pages, queueKey, currentPage - 1)}
          className="font-bold text-brand-primary-text hover:underline"
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-slate-500">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link
          href={adminQueueHref(pages, queueKey, currentPage + 1)}
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

export default async function AdminDashboardPage({ searchParams }: Props) {
  const adminSession = await requireAdmin();
  const canonicalHome = await canonicalPlatformUrl('/');
  const requestedPages = parseAdminDashboardSearch(await searchParams);

  const asOf = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const staleWhere = {
    OR: [
      { lastLicenseCheck: null },
      { lastLicenseCheck: { lt: thirtyDaysAgo } },
    ],
  };

  const [
    brandsCount,
    totalRetailers,
    verifiedRetailers,
    totalLeadsCount,
    pendingEvidenceCount,
    pendingDisputeCount,
    pendingClaimCount,
    staleRetailerCount,
  ] = await Promise.all([
    prisma.brand.count(),
    prisma.retailer.count(),
    prisma.retailer.count({ where: currentPublicRecordWhere(asOf) }),
    prisma.leadEvent.count(),
    prisma.licenseEvidence.count({
      where: { verificationStatus: 'PENDING' },
    }),
    prisma.dispute.count({ where: { status: 'PENDING' } }),
    prisma.claimRequest.count({ where: { status: 'PENDING' } }),
    prisma.retailer.count({ where: staleWhere }),
  ]);

  const pages: AdminPages = {
    evidencePage: clampQueuePage(
      requestedPages.evidencePage,
      pendingEvidenceCount,
    ),
    claimPage: clampQueuePage(requestedPages.claimPage, pendingClaimCount),
    disputePage: clampQueuePage(
      requestedPages.disputePage,
      pendingDisputeCount,
    ),
    stalePage: clampQueuePage(requestedPages.stalePage, staleRetailerCount),
  };

  const [
    pendingEvidence,
    pendingDisputes,
    pendingClaims,
    staleRetailers,
    auditLogs,
    leadEvents,
  ] = await Promise.all([
    prisma.licenseEvidence.findMany({
      where: { verificationStatus: 'PENDING' },
      select: {
        id: true,
        documentUrl: true,
        submittedAt: true,
        notes: true,
        retailer: {
          select: {
            name: true,
            licenseNumber: true,
          },
        },
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      skip: queuePageOffset(pages.evidencePage),
      take: ADMIN_QUEUE_PAGE_SIZE,
    }),
    prisma.dispute.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        filedBy: true,
        fieldName: true,
        oldValue: true,
        newValue: true,
        evidenceUrl: true,
        reason: true,
        retailer: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: queuePageOffset(pages.disputePage),
      take: ADMIN_QUEUE_PAGE_SIZE,
    }),
    prisma.claimRequest.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        email: true,
        phone: true,
        createdAt: true,
        retailer: {
          select: {
            id: true,
            name: true,
            licenseNumber: true,
            licenseStatus: true,
            dataStatus: true,
            isDemonstration: true,
            verifiedAt: true,
            freshnessExpiresAt: true,
            evidence: {
              select: {
                id: true,
                verificationStatus: true,
              },
              orderBy: { submittedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: queuePageOffset(pages.claimPage),
      take: ADMIN_QUEUE_PAGE_SIZE,
    }),
    prisma.retailer.findMany({
      where: staleWhere,
      select: {
        id: true,
        name: true,
        lastLicenseCheck: true,
      },
      // nulls:'first' keeps never-checked retailers at the top of the stale
      // queue. SQLite sorted ASC NULLS FIRST implicitly; PostgreSQL defaults
      // to NULLS LAST, which would silently bury unchecked retailers on the
      // final page of the queue.
      orderBy: [{ lastLicenseCheck: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      skip: queuePageOffset(pages.stalePage),
      take: ADMIN_QUEUE_PAGE_SIZE,
    }),
    prisma.auditLog.findMany({
      select: {
        id: true,
        action: true,
        details: true,
        timestamp: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 15,
    }),
    prisma.leadEvent.findMany({
      select: {
        id: true,
        eventType: true,
        createdAt: true,
        brand: { select: { name: true } },
        retailer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  // Server Actions for verification
  async function approveEvidence(formData: FormData) {
    'use server';
    const admin = await assertAdmin();
    await approveLicenseEvidence(prisma, {
      evidenceId: formData.get('evidenceId'),
      actorUserId: admin.userId,
    });
    revalidatePath('/admin');
  }

  async function markInformationFresh(formData: FormData) {
    'use server';
    const admin = await assertAdmin();
    await refreshRetailerVerification(prisma, {
      retailerId: formData.get('retailerId'),
      actorUserId: admin.userId,
    });
    revalidatePath('/admin');
  }

  async function rejectEvidence(formData: FormData) {
    'use server';
    const admin = await assertAdmin();
    await rejectLicenseEvidence(prisma, {
      evidenceId: formData.get('evidenceId'),
      actorUserId: admin.userId,
    });
    revalidatePath('/admin');
  }

  async function resolveDispute(formData: FormData) {
    'use server';
    const admin = await assertAdmin();
    await resolveCorrectionDispute(prisma, {
      disputeId: formData.get('disputeId'),
      actorUserId: admin.userId,
      decision: formData.get('action'),
    });
    revalidatePath('/admin');
  }

  async function resolveClaim(formData: FormData) {
    'use server';
    const admin = await assertAdmin();
    await resolveRetailerClaim(prisma, {
      claimId: formData.get('claimId'),
      actorUserId: admin.userId,
      decision: formData.get('action'),
    });
    revalidatePath('/admin');
  }

  async function logout() {
    'use server';
    await assertAdmin();
    await destroySession();
    redirect('/admin/login');
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-fade-in space-y-8">
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-brand-border pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-brand-text flex items-center">
            🏢 Administrative Headquarters
          </h1>
          <p className="text-sm text-slate-600">
            Control tower for the Order Weed DC multi-tenant network of {brandsCount} companies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600">{adminSession.email}</span>
          <Link
            href="/admin/site-intelligence"
            className="border border-brand-primary/40 bg-brand-primary/10 text-brand-primary-text text-xs font-bold px-4 py-2.5 rounded-md hover:bg-brand-primary/15 transition-all inline-block"
          >
            Site Brain
          </Link>
          <Link
            href={canonicalHome}
            className="bg-brand-primary text-black text-xs font-bold px-4 py-2.5 rounded-md hover:bg-opacity-95 transition-all inline-block"
          >
            ← View Customer Platform
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="border border-brand-border text-slate-700 text-xs font-bold px-4 py-2.5 rounded-md hover:bg-white/5"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-brand-border bg-brand-surface p-5 rounded-lg">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Configured Brands</div>
          <div className="text-2xl font-black text-brand-text mt-1">{brandsCount} <span className="text-xs text-slate-600 font-normal">Active domains</span></div>
        </div>
        <div className="border border-brand-border bg-brand-surface p-5 rounded-lg">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Retailers</div>
          <div className="text-2xl font-black text-brand-text mt-1">
            {totalRetailers} <span className="text-xs text-brand-primary-text font-normal">({verifiedRetailers} Verified)</span>
          </div>
        </div>
        <div className="border border-brand-border bg-brand-surface p-5 rounded-lg">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Outdated Audits (Stale)</div>
          <div className="text-2xl font-black text-orange-400 mt-1">
            {staleRetailerCount} <span className="text-xs text-slate-500 font-normal">Require checks</span>
          </div>
        </div>
        <div className="border border-brand-border bg-brand-surface p-5 rounded-lg">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Leads Route Attribution</div>
          <div className="text-2xl font-black text-brand-primary mt-1">{totalLeadsCount} <span className="text-xs text-slate-500 font-normal">Total handoffs</span></div>
        </div>
      </div>

      {/* Main Grid split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Verification Queue & Outdated checks */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Verification Queue */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              📥 License Verification Queue ({pendingEvidenceCount} pending)
            </h2>
            
            {pendingEvidence.length === 0 ? (
              <p className="text-xs text-slate-500 bg-brand-background/40 border border-brand-border p-4 rounded text-center">
                All uploaded documents and retailer licenses have been processed.
              </p>
            ) : (
              <div className="space-y-4">
                {pendingEvidence.map((evidence) => (
                  <div key={evidence.id} className="border border-brand-border bg-brand-background/60 p-4 rounded-md flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-brand-text">{evidence.retailer.name}</div>
                      <div className="text-xs text-slate-600">
                        License Type: <span className="font-semibold">{evidence.retailer.licenseNumber || 'Not Specified'}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        File: <span className="underline cursor-pointer">{evidence.documentUrl}</span> • Submitted: {new Date(evidence.submittedAt).toLocaleDateString()}
                      </div>
                      {evidence.notes && (
                        <p className="text-xs text-yellow-500 italic bg-yellow-500/5 px-2.5 py-1 rounded border border-yellow-500/10 mt-2">
                          Notes: {evidence.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <form action={approveEvidence}>
                        <input type="hidden" name="evidenceId" value={evidence.id} />
                        <button
                          type="submit"
                          className="bg-brand-primary text-black font-bold text-xs px-3 py-1.5 rounded hover:bg-opacity-90 active:scale-95 transition-all"
                        >
                          Approve & Verify
                        </button>
                      </form>
                      <form action={rejectEvidence}>
                        <input type="hidden" name="evidenceId" value={evidence.id} />
                        <button
                          type="submit"
                          className="bg-[#141A1E] border border-brand-border text-red-400 font-bold text-xs px-3 py-1.5 rounded hover:bg-red-500/10"
                        >
                          Reject Evidence
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <QueuePagination
              pages={pages}
              queueKey="evidencePage"
              totalItems={pendingEvidenceCount}
            />
          </div>

          {/* Business claim queue */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              Business Claim Queue ({pendingClaimCount} pending)
            </h2>

            {pendingClaims.length === 0 ? (
              <p className="text-xs text-slate-500 bg-brand-background/40 border border-brand-border p-4 rounded text-center">
                No business ownership claims are pending.
              </p>
            ) : (
              <div className="space-y-4">
                {pendingClaims.map((claim) => {
                  const readyForApproval = isPubliclyVerified(claim.retailer);
                  const latestEvidence = claim.retailer.evidence[0];
                  return (
                    <div
                      key={claim.id}
                      className="border border-brand-border bg-brand-background/60 p-4 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-brand-text">
                          {claim.retailer.name}
                        </div>
                        <div className="text-xs text-slate-600">
                          Contact: {claim.email} | {claim.phone}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          License: {claim.retailer.licenseNumber || 'Not provided'} |
                          Evidence: {latestEvidence?.verificationStatus || 'Missing'} |
                          Account: {readyForApproval ? 'Ready after evidence review' : 'Blocked until currently verified'}
                        </div>
                      </div>

                      <div className="flex gap-2 shrink-0">
                        <form action={resolveClaim}>
                          <input type="hidden" name="claimId" value={claim.id} />
                          <input type="hidden" name="action" value="APPROVE" />
                          <button
                            type="submit"
                            disabled={!readyForApproval}
                            className="bg-brand-primary disabled:bg-slate-700 disabled:text-slate-600 disabled:cursor-not-allowed text-black font-bold text-xs px-3 py-1.5 rounded"
                          >
                            Approve & Create Manager
                          </button>
                        </form>
                        <form action={resolveClaim}>
                          <input type="hidden" name="claimId" value={claim.id} />
                          <input type="hidden" name="action" value="REJECT" />
                          <button
                            type="submit"
                            className="bg-[#141A1E] border border-brand-border text-red-400 font-bold text-xs px-3 py-1.5 rounded hover:bg-red-500/10"
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <QueuePagination
              pages={pages}
              queueKey="claimPage"
              totalItems={pendingClaimCount}
            />
          </div>

          {/* Dispute Queue */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              ⚖️ Listing Correction & Contradiction Queue ({pendingDisputeCount} pending)
            </h2>

            {pendingDisputes.length === 0 ? (
              <p className="text-xs text-slate-500 bg-brand-background/40 border border-brand-border p-4 rounded text-center">
                No correction disputes or data contradictions are currently pending review.
              </p>
            ) : (
              <div className="space-y-4">
                {pendingDisputes.map((dispute) => (
                  <div key={dispute.id} className="border border-brand-border bg-brand-background/60 p-4 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-brand-text">{dispute.retailer.name}</div>
                      <div className="text-xs text-slate-600">
                        Contradiction: Field <span className="text-orange-400 font-bold">&quot;{dispute.fieldName}&quot;</span>
                      </div>
                      <div className="text-xs text-slate-600">
                        Current: <span className="text-red-400">{dispute.oldValue || 'None'}</span> → Correction: <span className="text-brand-primary-text">{dispute.newValue}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Submitted by: {dispute.filedBy} • Evidence: <span className="underline">{dispute.evidenceUrl}</span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Reason: {dispute.reason}
                      </p>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <form action={resolveDispute}>
                        <input type="hidden" name="disputeId" value={dispute.id} />
                        <input type="hidden" name="action" value="APPROVE" />
                        <button 
                          type="submit"
                          className="bg-brand-primary text-black font-bold text-xs px-3 py-1.5 rounded hover:bg-opacity-90 active:scale-95 transition-all"
                        >
                          Approve Correction
                        </button>
                      </form>

                      <form action={resolveDispute}>
                        <input type="hidden" name="disputeId" value={dispute.id} />
                        <input type="hidden" name="action" value="REJECT" />
                        <button 
                          type="submit"
                          className="bg-[#141A1E] border border-brand-border text-red-400 font-bold text-xs px-3 py-1.5 rounded hover:bg-red-500/10 active:scale-95 transition-all"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <QueuePagination
              pages={pages}
              queueKey="disputePage"
              totalItems={pendingDisputeCount}
            />
          </div>

          {/* Stale Data Monitor */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              ⚠️ Stale Information Warning List ({staleRetailerCount})
            </h2>

            {staleRetailers.length === 0 ? (
              <p className="text-xs text-slate-500 bg-brand-background/40 border border-brand-border p-4 rounded text-center">
                All retailer logs are fresh and verified within the last 30 days.
              </p>
            ) : (
              <div className="space-y-3">
                {staleRetailers.map((retailer) => (
                  <div key={retailer.id} className="border border-brand-border bg-brand-background/60 p-4 rounded-md flex justify-between items-center gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-brand-text">{retailer.name}</div>
                      <div className="text-[10px] text-slate-500">
                        Last checked: {retailer.lastLicenseCheck ? new Date(retailer.lastLicenseCheck).toLocaleDateString() : 'Never'}
                      </div>
                    </div>

                    <form action={markInformationFresh} className="shrink-0">
                      <input type="hidden" name="retailerId" value={retailer.id} />
                      <button 
                        type="submit"
                        className="bg-brand-surface border border-brand-border text-brand-primary-text font-bold text-xs px-3 py-1.5 rounded hover:bg-brand-primary/10 transition-all"
                      >
                        Mark Fresh / Audited
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <QueuePagination
              pages={pages}
              queueKey="stalePage"
              totalItems={staleRetailerCount}
            />
          </div>

        </div>

        {/* Audit Logs & Lead attribution */}
        <div className="space-y-8">
          
          {/* Lead Attribution statistics */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              📊 Recent Lead Handoff Attribution
            </h2>
            
            {leadEvents.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No click logs recorded yet.</p>
            ) : (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {leadEvents.map((evt) => (
                  <div key={evt.id} className="text-xs border-b border-brand-border/40 pb-2 flex justify-between">
                    <div>
                      <span className="font-semibold text-slate-700">{evt.retailer.name}</span>
                      <div className="text-[10px] text-slate-500">
                        via <span className="text-brand-primary-text">{evt.brand.name}</span> ({evt.eventType})
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compliance Audit Trail */}
          <div className="border border-brand-border bg-brand-surface rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              📜 Compliance Audit Ledger
            </h2>

            <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
              {auditLogs.map((log) => (
                <div key={log.id} className="text-[11px] border-b border-brand-border/40 pb-2 space-y-1">
                  <div className="flex justify-between font-bold text-slate-700">
                    <span className="text-brand-primary-text">{log.action}</span>
                    <span className="text-[9px] text-slate-500">
                      {new Date(log.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-slate-600 leading-tight">{log.details}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
