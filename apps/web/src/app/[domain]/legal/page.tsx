import Link from 'next/link';
import { Scale, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';
import { PUBLIC_PRODUCT_NAME } from '@/lib/product-brand';
import { LEGAL_FAQ_ENTRIES as FAQ_ENTRIES } from '@/lib/legal-faq.mjs';

export const metadata = buildPublicMetadata({
  title: 'D.C. Cannabis Laws & Compliance Guide — 21+, Limits, and Rules',
  description:
    'Plain-language overview of Washington, D.C. cannabis rules: age requirements, Initiative 71 basics, the medical program, purchase limits, and where consumption is prohibited. Not legal advice.',
  canonicalPath: '/legal',
});

export default async function LegalPage() {
  const origin = await requestOrigin();
  const breadcrumb = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Legal & Compliance', url: `${origin.origin}/legal` },
  ]);
  const faq = faqJsonLd(FAQ_ENTRIES);

  return (
    <div className="flex-grow animate-fade-in">
      {breadcrumb && <script {...jsonLdScriptProps(breadcrumb)} />}
      {faq && <script {...jsonLdScriptProps(faq)} />}

      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="kicker mb-4">Trust &amp; legal</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            D.C. cannabis rules,{' '}
            <span className="text-brand-primary-text">in plain language</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-muted">
            A short, source-aware orientation to Washington, D.C. cannabis
            law and to how {PUBLIC_PRODUCT_NAME} handles data. This page is
            general information, not legal or medical advice — laws change,
            and the D.C. Alcoholic Beverage and Cannabis Administration
            (ABCA) is the authority of record.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-text">
            <Scale size={18} className="text-brand-primary-text" aria-hidden="true" />
            The basics
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-brand-muted">
            <li>
              <strong className="text-brand-text">21+ only.</strong> Adults 21
              and older (or registered patients) may possess cannabis under
              D.C. law. Dispensaries check ID.
            </li>
            <li>
              <strong className="text-brand-text">Initiative 71.</strong>{' '}
              Allows possession of up to two ounces, home cultivation within
              plant limits, and gifting between adults — but not street sales.
            </li>
            <li>
              <strong className="text-brand-text">Medical program.</strong>{' '}
              D.C.&apos;s medical cannabis program allows adults 21+ to
              self-certify and purchase from ABCA-licensed dispensaries.
            </li>
            <li>
              <strong className="text-brand-text">No public consumption.</strong>{' '}
              Consumption in public spaces is illegal, and cannabis remains
              prohibited on federal land — a large share of the District.
            </li>
            <li>
              <strong className="text-brand-text">Never drive impaired.</strong>{' '}
              Driving under the influence of cannabis is illegal and dangerous.
            </li>
          </ul>
        </article>

        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-text">
            <ShieldCheck size={18} className="text-brand-primary-text" aria-hidden="true" />
            How this platform handles truth
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-brand-muted">
            <li>
              Every public record carries a{' '}
              <strong className="text-brand-text">data-status label</strong>{' '}
              (Verified Current, Awaiting Verification, Stale, Disputed, or
              Demonstration Only), a named source, and a freshness window.
            </li>
            <li>
              <strong className="text-brand-text">Sponsorship is labeled and
              never changes directory order.</strong> Ranking is truth-first,
              not pay-to-rank.
            </li>
            <li>
              Records that fail the public evidence boundary are{' '}
              <strong className="text-brand-text">excluded from
              search-engine structured data</strong> — synthetic or unverified
              facts are never presented to machines as truth.
            </li>
            <li>
              This platform does not fulfill, deliver, or sell controlled
              substances directly. Handoffs go to the retailer&apos;s own
              published channels.
            </li>
          </ul>
        </article>

        <article className="rounded-2xl border border-orange-400/25 bg-orange-400/5 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-orange-800">
            <AlertTriangle size={18} aria-hidden="true" />
            Important caveats
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-brand-muted">
            Cannabis remains a controlled substance under U.S. federal law.
            Licensing and operating status can change without notice — confirm
            any business or license claim with the relevant D.C. government
            source before relying on it. Nothing on this site is legal or
            medical advice. Keep products away from children and pets.
          </p>
          <a
            href="https://abca.dc.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand-primary-text hover:underline"
          >
            D.C. ABCA — authority of record
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </article>

        <article className="rounded-2xl border border-brand-border bg-brand-surface p-6">
          <h2 className="font-display text-lg font-bold text-brand-text">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-5">
            {FAQ_ENTRIES.map((entry) => (
              <div key={entry.question}>
                <dt className="text-sm font-bold text-brand-text">
                  {entry.question}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-brand-muted">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        <p className="text-center text-xs text-brand-muted">
          Questions about a specific record?{' '}
          <Link href="/help" className="font-bold text-brand-primary-text hover:underline">
            Read the help &amp; data policy
          </Link>{' '}
          or submit a correction from any retailer page.
        </p>
      </section>
    </div>
  );
}
