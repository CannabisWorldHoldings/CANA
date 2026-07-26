import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  assertAdmin,
  requireAdmin,
} from '@/lib/auth/session';
import { collectSiteIntelligenceSnapshot } from '@/lib/site-intelligence';
import {
  persistSiteIntelligenceSnapshot,
  SITE_ROUTE_INVENTORY,
} from '@/lib/site-intelligence.mjs';
import {
  collectSitemindCounts,
  buildSitemindReceipt,
} from '@/lib/sitemind.mjs';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';

export const dynamic = 'force-dynamic';

const RECOVERY_PACKAGE_SHA256 =
  '9F4F364A8625684DEAE6935310A78AE07023548E9BC69489345FA97C8CBC5282';

function statusStyle(status: string) {
  switch (status) {
    case 'READY':
    case 'HEALTHY':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
    case 'GUARDED':
      return 'border-sky-400/30 bg-sky-400/10 text-sky-300';
    case 'ATTENTION':
      return 'border-amber-400/30 bg-amber-400/10 text-amber-300';
    case 'BLOCKED':
      return 'border-rose-400/30 bg-rose-400/10 text-rose-300';
    default:
      return 'border-brand-border bg-white/5 text-slate-700';
  }
}

function formatUtc(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function SiteIntelligencePage() {
  const admin = await requireAdmin();
  const snapshot = await collectSiteIntelligenceSnapshot();

  // SiteMind Marketing Audit
  const canonicalBrand = await prisma.brand.findUnique({
    where: { domain: CANONICAL_TENANT_DOMAIN },
    select: { id: true },
  });
  const auditAsOf = new Date();

  type SitemindCheck = {
    id: string;
    title: string;
    status: string;
    evidence: string;
    recommendation: string;
    authority: string;
    weight: number;
  };
  type SitemindReceipt = {
    module: string;
    schemaVersion: string;
    generatedAt: string;
    gitRevision: string;
    authorityBoundary: string;
    routeContract: readonly object[];
    counts: object;
    score: number;
    grade: string;
    checks: readonly SitemindCheck[];
  };

  const sitemindReceipt: SitemindReceipt | null = canonicalBrand
    ? await collectSitemindCounts(prisma, {
        brandId: canonicalBrand.id,
        asOf: auditAsOf,
      }).then(
        (counts) =>
          buildSitemindReceipt({
            counts,
            asOf: auditAsOf,
            gitRevision: 'ADMIN_VIEW',
          }) as unknown as SitemindReceipt,
      )
    : null;

  const [totalRetailers, verifiedRetailers, demoRetailers, recentSnapshots] = await Promise.all([
    prisma.retailer.count(),
    prisma.retailer.count({ where: { dataStatus: 'VERIFIED_CURRENT', isDemonstration: false } }),
    prisma.retailer.count({ where: { isDemonstration: true } }),
    prisma.siteIntelligenceSnapshot.findMany({
      select: {
        id: true,
        capturedAt: true,
        capturedById: true,
        observationCount: true,
        attentionCount: true,
        blockedCount: true,
        localEvidenceStatus: true,
        externalEvidenceStatus: true,
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: 10,
    }),
  ]);

  async function captureEvidenceSnapshot() {
    'use server';
    const actor = await assertAdmin();
    const currentSnapshot = await collectSiteIntelligenceSnapshot();
    await persistSiteIntelligenceSnapshot(prisma, {
      snapshot: currentSnapshot,
      actorUserId: actor.userId,
    });
    revalidatePath('/admin/site-intelligence');
    revalidatePath('/admin');
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-5 border-b border-brand-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-brand-primary/30 bg-brand-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-primary-text">
              orderweeddc Site Intelligence
            </span>
            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">
              Read + capture only
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-brand-text sm:text-4xl">
            Site intelligence with proof attached
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            A deterministic view of orderweeddc&apos;s routes, truth state, evidence
            queues, index eligibility, and outcome gaps. It can preserve an
            immutable local snapshot, but it cannot publish, deploy, or expand
            its own authority.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">{admin.email}</span>
          <Link
            href="/admin"
            className="rounded-md border border-brand-border px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-white/5"
          >
            Back to control tower
          </Link>
          <a
            href={`data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(snapshot, null, 2))}`}
            download={`site-intelligence-audit-${new Date().toISOString().split('T')[0]}.json`}
            className="rounded-md border border-brand-border bg-brand-surface px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-white/5 inline-flex items-center gap-1.5"
          >
            📥 Export Audit Ledger
          </a>
          <form action={captureEvidenceSnapshot}>
            <button
              type="submit"
              className="rounded-md bg-brand-primary px-4 py-2.5 text-xs font-black text-black transition hover:brightness-110 cursor-pointer"
            >
              Capture evidence snapshot
            </button>
          </form>
        </div>
      </header>

      <section
        aria-label="Current intelligence summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        <article className="rounded-xl border border-brand-border bg-brand-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Real Retailers
          </p>
          <p className="mt-3 text-2xl font-black text-emerald-500">
            {verifiedRetailers} / {totalRetailers}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {demoRetailers} demo records
          </p>
        </article>
        <article className="rounded-xl border border-brand-border bg-brand-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Local evidence
          </p>
          <p className="mt-3 text-2xl font-black text-emerald-300">
            {snapshot.localEvidenceStatus}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Database and route inventory, as of {formatUtc(snapshot.asOf)} UTC
          </p>
        </article>
        <article className="rounded-xl border border-brand-border bg-brand-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Findings
          </p>
          <p className="mt-3 text-2xl font-black text-brand-text">
            {snapshot.observationCount}
          </p>
          <p className="mt-1 text-xs text-amber-300">
            {snapshot.attentionCount} need attention
          </p>
        </article>
        <article className="rounded-xl border border-brand-border bg-brand-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            External reality
          </p>
          <p className="mt-3 text-2xl font-black text-rose-300">
            {snapshot.externalEvidenceStatus}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {snapshot.blockedCount} gates reported as unknown, never as zero
          </p>
        </article>
        <article className="rounded-xl border border-brand-border bg-brand-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Proof locker
          </p>
          <p className="mt-3 text-2xl font-black text-sky-300">
            {snapshot.metrics.persistedSnapshots}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Bounded to the newest 100 immutable captures
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-brand-border bg-brand-surface p-6">
        <div className="flex flex-col gap-2 border-b border-brand-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary-text">
              Operating model
            </p>
            <h2 className="mt-1 text-xl font-black text-brand-text">
              Five planes, one explicit authority boundary
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Observation → intelligence → memory → prepared action → measured
            reality
          </p>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-5">
          {snapshot.planes.map(
            (plane: { name: string; status: string; proof: string }) => (
              <article
                key={plane.name}
                className="rounded-lg border border-brand-border bg-brand-background/60 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-brand-text">{plane.name}</h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-black tracking-wide ${statusStyle(plane.status)}`}
                  >
                    {plane.status}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  {plane.proof}
                </p>
              </article>
            ),
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary-text">
              Growth radar
            </p>
            <h2 className="mt-1 text-xl font-black text-brand-text">
              Findings, uncertainty, and safe next action
            </h2>
          </div>
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            Every finding discloses what changed, what proves it, what remains
            unknown, and who has authority to act.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.observations.map(
            (item: {
              key: string;
              plane: string;
              state: string;
              severity: string;
              title: string;
              summary: string;
              evidence: string;
              uncertainty: string;
              preparedAction: string;
              authority: string;
            }) => (
              <article
                key={item.key}
                className="rounded-xl border border-brand-border bg-brand-surface p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${statusStyle(item.state)}`}
                    >
                      {item.state}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      {item.plane} · {item.severity}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-600">
                    {item.key}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-black text-brand-text">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {item.summary}
                </p>
                <dl className="mt-5 space-y-3 border-t border-brand-border/70 pt-4 text-xs">
                  <div>
                    <dt className="font-bold uppercase tracking-wide text-emerald-300">
                      Evidence
                    </dt>
                    <dd className="mt-1 break-words font-mono leading-5 text-slate-500">
                      {item.evidence}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold uppercase tracking-wide text-amber-300">
                      Uncertainty
                    </dt>
                    <dd className="mt-1 leading-5 text-slate-600">
                      {item.uncertainty}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold uppercase tracking-wide text-sky-300">
                      Prepared action
                    </dt>
                    <dd className="mt-1 leading-5 text-slate-600">
                      {item.preparedAction}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-md border border-brand-border bg-brand-background/50 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Authority: {item.authority}
                </div>
              </article>
            ),
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="min-w-0 rounded-xl border border-brand-border bg-brand-surface p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary-text">
            Route memory
          </p>
          <h2 className="mt-1 text-xl font-black text-brand-text">
            Canonical surface inventory
          </h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="border-b border-brand-border pb-3">Surface</th>
                  <th className="border-b border-brand-border pb-3">Pattern</th>
                  <th className="border-b border-brand-border pb-3">
                    Index policy
                  </th>
                  <th className="border-b border-brand-border pb-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {SITE_ROUTE_INVENTORY.map((route) => (
                  <tr key={route.id} className="text-slate-600">
                    <td className="border-b border-brand-border/50 py-3 font-bold text-brand-text">
                      {route.id}
                    </td>
                    <td className="border-b border-brand-border/50 py-3 font-mono">
                      {route.pathPattern}
                    </td>
                    <td className="border-b border-brand-border/50 py-3">
                      {route.indexable ? 'Evidence-gated' : 'Excluded'}
                    </td>
                    <td className="border-b border-brand-border/50 py-3 font-mono text-[10px]">
                      {route.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 break-all font-mono text-[10px] text-slate-600">
            Inventory SHA-256: {snapshot.routeInventoryHash}
          </p>
        </article>

        <article className="rounded-xl border border-brand-border bg-brand-surface p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary-text">
            Proof locker
          </p>
          <h2 className="mt-1 text-xl font-black text-brand-text">
            Recent immutable captures
          </h2>
          {recentSnapshots.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-brand-border bg-brand-background/40 p-5 text-sm leading-6 text-slate-500">
              No snapshot has been captured yet. The live analysis above is
              current but not durable until an administrator captures it.
            </div>
          ) : (
            <ol className="mt-5 space-y-3">
              {recentSnapshots.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-brand-border bg-brand-background/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-brand-text">
                        {formatUtc(item.capturedAt)} UTC
                      </p>
                      <p className="mt-1 font-mono text-[9px] text-slate-600">
                        {item.id}
                      </p>
                    </div>
                    <span className="rounded-full border border-brand-border px-2 py-1 text-[9px] font-bold text-slate-600">
                      {item.observationCount} findings
                    </span>
                  </div>
                  <p className="mt-3 text-[10px] text-slate-500">
                    {item.attentionCount} attention · {item.blockedCount}{' '}
                    external blocks · local {item.localEvidenceStatus.toLowerCase()}
                    {' · '}external{' '}
                    {item.externalEvidenceStatus.toLowerCase()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      <aside className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-5 text-xs leading-6 text-slate-600">
        <strong className="text-sky-300">Recovery-package lineage:</strong>{' '}
        architecture and anti-regression laws were integrated from the supplied
        RSI/SEO recovery package. The package states that the original SiteMind
        runtime archives were unavailable, so CANA does not claim to have
        recovered them. Archive SHA-256:{' '}
        <span className="break-all font-mono text-slate-500">
          {RECOVERY_PACKAGE_SHA256}
        </span>
        .
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* SiteMind Marketing Audit                                            */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="SiteMind Marketing Audit" className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary-text">
              SiteMind Marketing Audit v1
            </p>
            <h2 className="mt-1 text-xl font-black text-brand-text">
              Marketing health score with evidence receipts
            </h2>
          </div>
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            Deterministic scoring from local database state only. Production HTTP, search-console,
            and analytics remain unproven external gates.
          </p>
        </div>

        {sitemindReceipt === null ? (
          <div className="rounded-xl border border-dashed border-brand-border bg-brand-surface p-6 text-sm text-slate-500">
            SiteMind audit unavailable: canonical brand record not found for domain{' '}
            <span className="font-mono">{CANONICAL_TENANT_DOMAIN}</span>.
          </div>
        ) : (
          <>
            {/* Score summary card */}
            <div className="grid gap-4 sm:grid-cols-3">
              <article className="rounded-xl border border-brand-border bg-brand-surface p-5 sm:col-span-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Marketing Score
                </p>
                <p
                  className={`mt-3 text-5xl font-black ${
                    sitemindReceipt.grade === 'A'
                      ? 'text-emerald-400'
                      : sitemindReceipt.grade === 'B'
                      ? 'text-emerald-300'
                      : sitemindReceipt.grade === 'C'
                      ? 'text-amber-300'
                      : sitemindReceipt.grade === 'D'
                      ? 'text-orange-400'
                      : 'text-rose-400'
                  }`}
                >
                  {sitemindReceipt.score}
                  <span className="ml-2 text-2xl">/ 100</span>
                </p>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  Grade:{' '}
                  <span
                    className={
                      sitemindReceipt.grade === 'A' || sitemindReceipt.grade === 'B'
                        ? 'text-emerald-300'
                        : sitemindReceipt.grade === 'C'
                        ? 'text-amber-300'
                        : 'text-rose-400'
                    }
                  >
                    {sitemindReceipt.grade}
                  </span>
                </p>
              </article>
              <article className="rounded-xl border border-brand-border bg-brand-surface p-5 sm:col-span-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Authority boundary
                </p>
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  {sitemindReceipt.authorityBoundary}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center text-[10px] text-slate-500">
                  <div>
                    <p className="text-lg font-black text-brand-text">
                      {sitemindReceipt.checks.filter((c) => c.status === 'PASS').length}
                    </p>
                    <p className="font-bold uppercase tracking-wide text-emerald-300">Pass</p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-brand-text">
                      {sitemindReceipt.checks.filter((c) => c.status === 'WARN').length}
                    </p>
                    <p className="font-bold uppercase tracking-wide text-amber-300">Warn</p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-brand-text">
                      {sitemindReceipt.checks.filter((c) => c.status === 'FAIL').length}
                    </p>
                    <p className="font-bold uppercase tracking-wide text-rose-400">Fail</p>
                  </div>
                </div>
              </article>
            </div>

            {/* Checks table */}
            <div className="overflow-x-auto rounded-xl border border-brand-border bg-brand-surface">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4">Status</th>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4">Check</th>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4">Evidence</th>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4">Recommendation</th>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4">Authority</th>
                    <th className="border-b border-brand-border px-5 pb-3 pt-4 text-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {sitemindReceipt.checks.map((check) => (
                      <tr key={check.id} className="align-top text-slate-600">
                        <td className="border-b border-brand-border/50 px-5 py-3">
                          <span
                            className={`inline-block rounded-full border px-2.5 py-0.5 text-[9px] font-black tracking-wide ${
                              check.status === 'PASS'
                                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                : check.status === 'WARN'
                                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                                : 'border-rose-400/30 bg-rose-400/10 text-rose-400'
                            }`}
                          >
                            {check.status}
                          </span>
                        </td>
                        <td className="border-b border-brand-border/50 px-5 py-3">
                          <p className="font-bold text-brand-text">{check.title}</p>
                          <p className="mt-0.5 font-mono text-[9px] text-slate-600">{check.id}</p>
                        </td>
                        <td className="border-b border-brand-border/50 px-5 py-3">
                          <p className="break-all font-mono text-[10px] leading-5 text-slate-500">
                            {check.evidence}
                          </p>
                        </td>
                        <td className="border-b border-brand-border/50 px-5 py-3 leading-5">
                          {check.recommendation}
                        </td>
                        <td className="border-b border-brand-border/50 px-5 py-3">
                          <span className="rounded-md border border-brand-border px-2 py-0.5 font-mono text-[9px] text-slate-500">
                            {check.authority}
                          </span>
                        </td>
                        <td className="border-b border-brand-border/50 px-5 py-3 text-right font-mono text-slate-500">
                          {check.weight}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
