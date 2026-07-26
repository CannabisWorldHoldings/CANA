import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRetailerManager } from '@/lib/auth/session';
import { buildGrowthView } from '@/lib/growth-os.mjs';

/**
 * MERCHANT GROWTH OS.
 *
 * The existing merchant dashboard renders counts — menu entries, deals,
 * referrals — and nothing from the visibility audit, the attribution ledger, or
 * proof of value. Those are precisely the figures a merchant would decide to
 * spend against, so they were the ones missing from the merchant's own view.
 *
 * Every number on this page is computed by growth-os.mjs, which is a pure module
 * attacked directly by 26 tests. The page's only jobs are to fetch and to
 * present honestly:
 *
 *  - A withheld figure is shown as WITHHELD with the reason, never as a zero.
 *    A zero reads as "we measured and found nothing"; withheld reads as
 *    "this cannot be claimed", which is the truth.
 *  - Priority actions appear even when proof of value is withheld. Holding a
 *    merchant's own findings hostage to spend would be a sales tactic.
 *  - Nothing on the page implies ranking, traffic, leads, lift, or revenue.
 */

export const dynamic = 'force-dynamic';

export default async function MerchantGrowthPage() {
  const session = await requireRetailerManager();
  const retailerId = session.managedRetailerId ?? redirect('/business/login');

  const retailer = await prisma.retailer.findUnique({
    where: { id: retailerId },
    select: {
      id: true, name: true, dataStatus: true, isDemonstration: true,
      licenseStatus: true, verifiedAt: true, freshnessExpiresAt: true,
    },
  });
  if (!retailer) redirect('/business/login');

  const [ledger, menuTotal, menuDemo] = await Promise.all([
    prisma.demandCreditEntry.findMany({ where: { merchantId: retailerId }, orderBy: { seq: 'asc' } }),
    prisma.menuEntry.count({ where: { retailerId } }),
    prisma.menuEntry.count({ where: { retailerId, isDemonstration: true } }),
  ]);

  const view = buildGrowthView({
    retailer,
    ledger,
    menu: { total: menuTotal, demonstration: menuDemo },
  });

  const isDemo = view.truth_label !== 'LIVE_RECORD';
  const pov = view.proof_of_value;

  return (
    <div className="min-h-screen bg-[#0B0F12] text-brand-text">
      <div className="mx-auto max-w-4xl px-[6%] py-10">
        <nav className="mb-8 flex items-center gap-4 text-sm">
          <Link href="/business/dashboard" className="text-[#1EC36A] hover:underline">
            &larr; Dashboard
          </Link>
          <span className="text-white/40">Growth OS</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold">{retailer.name}</h1>
          <p className="mt-2 text-sm text-white/60">
            Everything here is derived from observable records. Each figure names the
            field it came from, and anything that cannot be evidenced is withheld
            rather than estimated.
          </p>
        </header>

        {/* Truth label first. A merchant must never mistake demonstration data
            for a commercial result, and burying this would invite exactly that. */}
        <section
          className={`mb-8 rounded-lg border p-4 ${
            isDemo ? 'border-amber-500/50 bg-amber-500/10' : 'border-[#1EC36A]/40 bg-[#1EC36A]/10'
          }`}
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">
            Record status
          </h2>
          <p className="mt-1 font-mono text-sm">{view.truth_label}</p>
        </section>

        {/* Visibility — completeness, explicitly not performance. */}
        {view.visibility && (
          <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">Visibility completeness</h2>
            <p className="mt-1 text-4xl font-bold tabular-nums">
              {view.visibility.score}
              <span className="text-lg font-normal text-white/50">/100</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/60">{view.visibility.means}</p>
          </section>
        )}

        {/* Proof of value — shown only when it can be evidenced. */}
        <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold">Attributed actions</h2>

          {pov ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-white/50">Actions</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">{pov.attributed_actions}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-white/50">Credits spent</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">{pov.credits_spent}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-white/50">Cost per action</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">
                    {pov.cost_per_attributed_action ?? '—'}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-white/60">
                Counted only when the action&rsquo;s evidence chain re-hashes to its
                recorded digest. You own this relationship.
              </p>
            </>
          ) : (
            /* WITHHELD, not zero. A zero would read as a measured result. */
            <div className="mt-4">
              <p className="font-mono text-sm text-amber-400">WITHHELD</p>
              <ul className="mt-2 space-y-1 text-sm text-white/70">
                {view.proof_of_value_blockers.map((b) => (
                  <li key={b}>&bull; {b}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-white/50">
                Nothing is being estimated in place of these figures.
              </p>
            </div>
          )}

          {/* The rejection ledger, shown openly. A merchant is entitled to know
              what was NOT counted and why. */}
          <details className="mt-5">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-white/50">
              What was not counted
            </summary>
            <dl className="mt-3 space-y-1 text-sm text-white/70">
              <div className="flex justify-between">
                <dt>Rows seen</dt><dd className="tabular-nums">{view.attribution.rows_seen}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Counted</dt><dd className="tabular-nums">{view.attribution.counted}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Rejected — not this merchant</dt>
                <dd className="tabular-nums">{view.attribution.rejected_foreign_merchant}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Rejected — evidence not verifiable</dt>
                <dd className="tabular-nums">{view.attribution.rejected_unverifiable_evidence}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Rejected — duplicate of an action already counted</dt>
                <dd className="tabular-nums">{view.attribution.rejected_duplicate_evidence}</dd>
              </div>
            </dl>
          </details>
        </section>

        {/* Priority actions — always shown, spend or no spend. */}
        {view.priority_actions.length > 0 && (
          <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">Your highest-weight fixes</h2>
            <ol className="mt-4 space-y-4">
              {(view.priority_actions as Array<{
                rank: number; weight: number; finding: string;
                evidence_field: string; observed: unknown; action: string;
              }>).map((a) => (
                <li key={a.rank} className="border-l-2 border-[#1EC36A]/50 pl-4">
                  <p className="font-medium">{a.finding}</p>
                  <p className="mt-1 text-sm text-white/60">
                    Observed: <span className="font-mono">{String(a.observed)}</span>
                  </p>
                  <p className="text-xs text-white/40">
                    Field: <span className="font-mono">{a.evidence_field}</span>
                  </p>
                  <p className="mt-1 text-sm text-[#1EC36A]">{a.action}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* The disclaimer is part of the product, not fine print. */}
        <footer className="rounded-lg border border-white/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">
            What this page does not claim
          </h2>
          <p className="mt-2 text-sm text-white/60">{view.not_claimed.join(' &middot; ')}</p>
          <p className="mt-3 text-xs leading-relaxed text-white/50">{view.disclaimer}</p>
        </footer>
      </div>
    </div>
  );
}
