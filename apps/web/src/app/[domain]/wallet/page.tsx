import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireCustomer } from '@/lib/auth/session';
import { loadCustomerWallet } from '@/lib/customer-wallet.mjs';
import { Star, TrendingUp } from 'lucide-react';

type Props = {
  params: Promise<{ domain: string }>;
};

type WalletView = {
  brand: {
    id: string;
    name: string;
    domain: string;
  };
  customer: {
    id: string;
    name: string | null;
  };
  currentLoyalty: {
    id: string;
    points: number;
    tier: string;
    transactions: Array<{
      id: string;
      pointsChanged: number;
      description: string;
      createdAt: Date;
    }>;
  } | null;
  accounts: Array<{
    id: string;
    brandId: string;
    points: number;
    tier: string;
    brand: {
      name: string;
      domain: string;
    };
  }>;
  totalNetworkPoints: number;
};

export const dynamic = 'force-dynamic';

export default async function CustomerWalletPage({ params }: Props) {
  const session = await requireCustomer();
  const { domain } = await params;
  const wallet = (await loadCustomerWallet(prisma, {
    userId: session.userId,
    domain,
  })) as WalletView | null;

  if (!wallet) {
    return (
      <div className="flex-grow flex flex-col justify-center items-center p-8 bg-brand-background">
        <p className="text-red-600 font-bold">This host brand is not configured.</p>
        <Link href="/" className="mt-4 text-sm text-brand-primary-text hover:underline">
          Return to the directory
        </Link>
      </div>
    );
  }

  const { brand, customer, currentLoyalty, accounts, totalNetworkPoints } =
    wallet;

  return (
    <div className="flex-grow animate-fade-in">
      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="text-xs font-semibold text-brand-muted transition-colors hover:text-brand-primary-text"
            >
              ← Back to listings
            </Link>
            <form action="/customer/logout" method="post">
              <button
                type="submit"
                className="text-xs font-semibold text-brand-muted hover:text-brand-text transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>

          <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="kicker mb-3">Private customer wallet</p>
              <h1 className="font-display text-2xl font-extrabold text-brand-text sm:text-3xl">
                Welcome back{customer.name ? `, ${customer.name}` : ''}
              </h1>
              <p className="text-xs text-brand-muted mt-1">
                This view is bound to your authenticated account.
              </p>
            </div>

            <div className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-3 shrink-0">
              <div className="text-[10px] text-brand-muted font-bold uppercase tracking-wider">
                Network points balance
              </div>
              <div className="font-display text-xl font-black text-brand-primary mt-0.5">
                {totalNetworkPoints}{' '}
                <span className="text-xs text-brand-muted font-normal">Pts</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <section className="record-card rounded-2xl p-6 space-y-6 relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-brand-primary/5 blur-xl" />

              <div className="flex justify-between items-start border-b border-brand-border/40 pb-4">
                <div>
                  <h2 className="font-display text-md font-bold text-brand-text uppercase tracking-wider">
                    {brand.name} points account
                  </h2>
                  <span className="text-[10px] text-brand-muted">
                    Attributed to {brand.domain}
                  </span>
                </div>
                <span className="text-[10px] font-black text-white bg-brand-primary px-3 py-1 rounded-lg">
                  {currentLoyalty?.tier || 'NO'} TIER
                </span>
              </div>

              <div className="flex items-baseline space-x-2">
                <span className="font-display text-5xl font-black text-brand-text">
                  {currentLoyalty?.points || 0}
                </span>
                <span className="text-brand-muted font-semibold">
                  Available points
                </span>
              </div>

              <div className="rounded-xl border border-brand-border bg-brand-background/40 p-4 text-xs text-brand-muted leading-relaxed">
                Points and transactions in this development environment are
                synthetic. This wallet does not establish age, eligibility,
                legal status, cash value, or an active redemption right.
              </div>

              <div className="space-y-3 pt-2">
                <h3 className="font-display text-xs font-bold text-brand-text">
                  Recent transactions
                </h3>
                {!currentLoyalty ||
                currentLoyalty.transactions.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-2">
                    No point movements recorded for this brand.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {currentLoyalty.transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="text-xs border-b border-brand-border/30 pb-2 flex justify-between items-center"
                      >
                        <div>
                          <div className="font-semibold text-brand-text">
                            {transaction.description}
                          </div>
                          <div className="text-[10px] text-brand-muted">
                            {new Date(transaction.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span
                          className={`font-black ${
                            transaction.pointsChanged >= 0
                              ? 'text-brand-primary-text'
                              : 'text-red-600'
                          }`}
                        >
                          {transaction.pointsChanged >= 0
                            ? `+${transaction.pointsChanged}`
                            : transaction.pointsChanged}{' '}
                          pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-4">
              <h2 className="font-display text-sm font-bold text-brand-text flex items-center gap-2">
                <TrendingUp size={14} aria-hidden="true" className="text-brand-primary-text" />
                Cross-brand balances
              </h2>

              {accounts.length === 0 ? (
                <p className="text-xs text-brand-muted">
                  No loyalty accounts are linked to this customer.
                </p>
              ) : (
                <div className="space-y-3">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className={`p-3.5 rounded-xl border flex justify-between items-center gap-4 ${
                        account.brandId === brand.id
                          ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                          : 'border-brand-border bg-brand-background/30'
                      }`}
                    >
                      <div>
                        <h3 className="text-xs font-bold text-brand-text">
                          {account.brand.name}
                        </h3>
                        <span className="text-[9px] text-brand-muted">
                          {account.brand.domain}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-black text-brand-text">
                          {account.points} Pts
                        </div>
                        <span className="text-[8px] font-bold text-brand-muted uppercase tracking-wider">
                          {account.tier}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 text-[10px] text-brand-muted leading-normal text-center border-t border-brand-border">
                Only accounts owned by the current authenticated customer are
                included.
              </div>
            </section>

            {/* Bookmarked Dispensaries & Saved Deals */}
            <section className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-brand-text flex items-center gap-1.5">
                  <Star size={14} aria-hidden="true" className="text-brand-primary-text" />
                  Saved Dispensaries
                </h2>
                <span className="text-[10px] font-bold text-brand-muted bg-brand-background border border-brand-border px-2 py-0.5 rounded-lg">
                  Verified D.C.
                </span>
              </div>
              <p className="text-xs text-brand-muted leading-relaxed">
                Bookmark dispensaries to track live menu updates and active promotions in real-time.
              </p>
              <Link
                href="/"
                className="mt-2 block w-full text-center bg-brand-primary-fill-strong text-white font-bold text-xs py-2 px-3 rounded-xl hover:brightness-110 transition-all"
              >
                Browse Directory →
              </Link>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
