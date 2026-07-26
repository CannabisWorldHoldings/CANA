import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Administrator Sign In | Order Weed DC',
  description: 'Authorized administrator access for the Order Weed DC platform.',
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const existingSession = await getSession();
  if (existingSession?.role === 'ADMIN') {
    redirect('/admin');
  }

  const { error } = await searchParams;

  return (
    <main className="min-h-screen bg-[#0B0F12] text-brand-text flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <span className="text-brand-primary-text font-black text-xs border border-brand-primary/20 bg-brand-primary/5 px-3 py-1 rounded-full uppercase tracking-widest">
          Authorized Staff
        </span>
        <h1 className="text-3xl font-extrabold">Administrator Sign In</h1>
        <p className="text-sm text-slate-600">
          Administrative data and mutations require an active administrator session.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[#141A1E] border border-white/5 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form action="/admin/session" method="post" className="space-y-6">
            {error === 'invalid' && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded text-xs"
              >
                Invalid email, password, or account type.
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                className="w-full bg-[#0B0F12] border border-white/10 rounded-md px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                className="w-full bg-[#0B0F12] border border-white/10 rounded-md px-3 py-2.5 text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-brand-primary text-black font-extrabold text-sm py-3 px-4 rounded-md"
            >
              Sign In
            </button>
          </form>

          <div className="mt-6 border-t border-white/5 pt-4 text-center">
            <Link href="/business/login" className="text-xs text-slate-500 hover:text-brand-text">
              Retailer manager sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
