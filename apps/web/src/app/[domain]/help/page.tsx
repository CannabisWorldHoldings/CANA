import Link from 'next/link';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import SupportCenter from '@/components/support-center';
import { PUBLIC_SUPPORT_EMAIL } from '@/lib/product-brand';

export const dynamic = 'force-dynamic';

export const metadata = buildPublicMetadata({
  title: 'Help & Data Policy',
  description:
    'Answers to common questions about Washington D.C. medical cannabis laws, ABCA reciprocity, patient registration, and evidence verification.',
  canonicalPath: '/help',
});

export default async function HelpPage() {
  return (
    <div className="flex-grow animate-fade-in">
      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="text-xs font-bold text-brand-muted transition-colors hover:text-brand-primary">
            ← Back to directory
          </Link>
          <p className="kicker mt-5 mb-3">Patient Guidance &amp; FAQ</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
            Answers, corrections, and{' '}
            <span className="text-brand-primary">human support.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-muted">
            Search the most common D.C. access and listing questions, review
            our source boundaries, or contact the team without a tracking
            widget.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <SupportCenter supportEmail={PUBLIC_SUPPORT_EMAIL} />
      </div>
    </div>
  );
}
