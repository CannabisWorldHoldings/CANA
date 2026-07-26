import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const existingSession = await getSession();
  if (existingSession?.role === 'CUSTOMER') {
    redirect('/wallet');
  }

  const { error } = await searchParams;

  return (
    <div className="flex-grow flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-brand-background text-brand-text">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <span className="text-brand-primary-text font-black text-xs border border-brand-primary/20 bg-brand-primary/5 px-3 py-1 rounded-full uppercase tracking-widest">
          Private customer access
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Sign in to your wallet
        </h1>
        <p className="text-sm text-brand-muted">
          Your balances and transaction history are available only after
          customer authentication.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-brand-surface border border-brand-border py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form action="/customer/session" method="post" className="space-y-6">
            {error === 'invalid' && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/20 text-red-700 p-3 rounded text-xs"
              >
                Invalid email, password, or account type.
              </div>
            )}

            <div>
              <label
                htmlFor="customer-email"
                className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2"
              >
                Email
              </label>
              <input
                id="customer-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                className="w-full bg-brand-background border border-brand-border rounded-xl px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="customer-password"
                className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2"
              >
                Password
              </label>
              <input
                id="customer-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                className="w-full bg-brand-background border border-brand-border rounded-xl px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-brand-primary-fill-strong text-white font-extrabold text-sm py-3 px-4 rounded-xl hover:brightness-110 transition-all"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 border-t border-brand-border pt-4 text-center">
            <Link
              href="/"
              className="text-xs text-brand-muted hover:text-brand-text transition-colors"
            >
              Return to the public directory
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
