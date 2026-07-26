import Link from 'next/link';
import { publicSubmissionErrorMessage } from '@/lib/public-submission.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { BadgeCheck, LineChart, ShieldCheck, Store } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = buildPublicMetadata({
  title: 'Claim Your D.C. Dispensary Listing — Verified Badge & Menu Control',
  description:
    'Own a licensed D.C. cannabis business? Claim your listing to manage menus, hours, and deals, submit license evidence, and earn the Verified Current label customers filter for.',
  canonicalPath: '/business/claim',
});

const CLAIM_BENEFITS = [
  {
    icon: BadgeCheck,
    title: 'Earn the Verified Current label',
    text: 'Submit license evidence once; reviewed records get the trust label customers filter for.',
  },
  {
    icon: Store,
    title: 'Control your menu & hours',
    text: 'Manage products, prices, deals, and operating hours from a private dashboard.',
  },
  {
    icon: LineChart,
    title: 'Truth-first ranking',
    text: 'No pay-to-rank anywhere. Verified, fresh records simply outrank stale ones.',
  },
  {
    icon: ShieldCheck,
    title: 'Private until approved',
    text: 'Claims and evidence stay private until administrator review. No public exposure.',
  },
];

export default async function BusinessClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const submitted = resolvedSearchParams.submitted === '1';
  const errorMessage = publicSubmissionErrorMessage(resolvedSearchParams.error);

  return (
    <main className="min-h-screen bg-brand-background text-brand-text flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg text-center space-y-2">
        <span className="text-black font-black text-xs border border-brand-border bg-brand-surface px-3 py-1 rounded-full uppercase tracking-widest">
          Compliance Ledger
        </span>
        <h1 className="font-display text-3xl font-extrabold text-brand-text tracking-tight">Claim Your Business Listing</h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Submit your contact details and a public HTTPS evidence reference for administrator review.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-3xl">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CLAIM_BENEFITS.map((benefit) => (
            <li
              key={benefit.title}
              className="rounded-xl border border-brand-border bg-brand-surface p-4 text-left"
            >
              <benefit.icon size={16} className="text-brand-primary-text" aria-hidden="true" />
              <p className="mt-2 text-xs font-bold text-brand-text">{benefit.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{benefit.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-brand-surface border border-brand-border py-8 px-4 shadow-sm rounded-xl sm:px-10 space-y-6">
          
          {submitted ? (
            <div className="bg-brand-primary/10 border border-brand-primary/20 text-brand-text p-5 rounded-lg space-y-3">
              <h2 className="text-sm font-bold">📥 Claim Received Successfully</h2>
              <p className="text-xs text-slate-700 leading-relaxed">
                Your claim, evidence reference, and one-way password hash were
                submitted for administrator review. Sign-in becomes available
                only after evidence and claim approval. The submitted listing
                is not publicly discoverable before evidence approval.
              </p>
              <div className="pt-2">
                <Link href="/business/login" className="bg-black text-white font-bold text-xs px-4 py-2 rounded inline-block hover:bg-slate-800 transition-all">
                  Go to Login
                </Link>
              </div>
            </div>
          ) : (
            <form
              action="/business/claim/submission"
              method="post"
              className="space-y-5"
            >
              
              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-3 rounded text-xs">
                  Error: {errorMessage}
                </div>
              )}

              <div>
                <label htmlFor="claim-name" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Business / Dispensary Name
                </label>
                <input
                  id="claim-name"
                  name="name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Business name"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                />
              </div>

              <div>
                <label htmlFor="claim-address" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Storefront Physical Address
                </label>
                <input
                  id="claim-address"
                  name="address"
                  type="text"
                  required
                  minLength={5}
                  maxLength={240}
                  placeholder="Street address, Washington, DC"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="claim-email" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Contact Email
                  </label>
                  <input
                    id="claim-email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    placeholder="manager@dispensary.com"
                    className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="claim-phone" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Contact Phone
                  </label>
                  <input
                    id="claim-phone"
                    name="phone"
                    type="tel"
                    required
                    minLength={7}
                    maxLength={32}
                    autoComplete="tel"
                    placeholder="202-555-0100"
                    className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="claim-license" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  DC ABCA Medical License Number
                </label>
                <input
                  id="claim-license"
                  name="licenseNumber"
                  type="text"
                  required
                  minLength={3}
                  maxLength={64}
                  placeholder="License number shown by the source"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                />
              </div>

              <div>
                <label htmlFor="claim-evidence" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Public HTTPS Evidence URL (PDF / Image)
                </label>
                <input
                  id="claim-evidence"
                  name="evidenceUrl"
                  type="url"
                  required
                  maxLength={2048}
                  inputMode="url"
                  placeholder="https://public-source.example/license.pdf"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="claim-password" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Manager Account Password
                  </label>
                  <input
                    id="claim-password"
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="claim-password-confirmation" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Confirm Password
                  </label>
                  <input
                    id="claim-password-confirmation"
                    name="passwordConfirmation"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-black transition-colors"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Use 12-128 characters with uppercase, lowercase, a number, and
                a symbol. Only a salted one-way hash is retained.
              </p>

              <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded text-xs text-amber-700 leading-relaxed">
                ℹ️ <strong>Transparency notice:</strong> A submission remains labeled “Awaiting verification” until an administrator reviews acceptable primary-source evidence. Submission does not guarantee publication or approval.
              </div>

              <div>
                <button
                  type="submit"
                  className="w-full bg-black text-white font-extrabold text-sm py-3 px-4 rounded-md hover:bg-slate-800 active:scale-98 transition-all cursor-pointer shadow"
                >
                  Submit Listing Claim
                </button>
              </div>
            </form>
          )}

          <div className="border-t border-brand-border pt-4 text-center">
            <Link href="/business/login" className="text-xs text-slate-500 hover:text-brand-text transition-colors">
              Already claimed? Sign in to your dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
