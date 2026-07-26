import Link from 'next/link';
import { BadgeCheck, RefreshCw, Lock, DollarSign, Zap, ArrowRight } from 'lucide-react';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScriptProps,
} from '@/lib/structured-data.mjs';

export const metadata = {
  ...buildPublicMetadata({
    title: 'Published Pricing — The Only Cannabis Platform With No Sales Call',
    description:
      'Every competitor hides pricing behind sales calls. We publish ours. Verified Listing free forever, Featured from $249/mo, SiteMind AI audits from $499/mo — all month-to-month, no contracts.',
    canonicalPath: '/pricing',
  }),
  alternates: {
    canonical: '/pricing',
  },
};

const PRICING_FAQ_ENTRIES = [
  {
    question: 'Why do you publish pricing when no competitor does?',
    answer:
      'Weedmaps, Leafly, Where\'s Weed, and every regional competitor hide merchant pricing behind "request a demo" or sales calls — a verified industry-wide pattern as of 2026. We believe transparent pricing is a proxy for trustworthiness. If we won\'t publish what we charge, how can you trust our data labels?',
  },
  {
    question: 'Does a Featured placement change my organic ranking in directory search?',
    answer:
      'No. Featured spots occupy a clearly labeled rail that sits above organic results. Organic directory ordering is always truth-first: verified current records, then freshness, then completeness. No amount of spend reorders organic results. Every sponsored placement is labeled "SPONSORED" so consumers can see it.',
  },
  {
    question: 'Are there annual contracts or cancellation fees?',
    answer:
      'No contracts and no cancellation fees. Featured and SiteMind subscriptions are month-to-month. Cancel any time from your business dashboard with a single click. Founding pricing is locked for the life of your active subscription if you claim it before general availability.',
  },
  {
    question: 'What does ABCA verification require for a Verified Listing?',
    answer:
      'We cross-reference your license number against the D.C. Alcoholic Beverage and Cannabis Administration (ABCA) public records, confirm operating status, and record the verification source and date. If your license is current and publicly listed with ABCA, verification is typically completed within one business day at no cost.',
  },
  {
    question: 'What is Menu Sync and when will it exit beta?',
    answer:
      'Menu Sync ingests your live menu from Dutchie- or Jane-compatible point-of-sale systems and attaches evidence labels (data source, verification state, freshness window) to each entry. It is free during the beta period. When it exits beta we will give existing users at least 30 days notice before any pricing change.',
  },
];

const TIERS = [
  {
    name: 'Verified Listing',
    price: 'Free',
    cadence: 'forever',
    badge: null,
    description: 'Everything a legitimate D.C. dispensary needs to build trust online.',
    features: [
      'ABCA-verified badge + provenance schema on your listing',
      'Unlimited self-serve deals with freshness labels',
      'Basic analytics: profile views, menu views, handoff clicks',
      'A backlink + structured data that builds your own domain authority',
      'You own 100% of your customer data — always',
    ],
    cta: 'Claim your free listing',
    ctaHref: '/business/claim',
    highlight: false,
  },
  {
    name: 'Featured',
    price: '$249',
    cadence: '/mo · month-to-month',
    badge: 'Founding pricing',
    description: 'Gold-labeled placement rail that never reorders organic search results.',
    features: [
      'Gold-labeled placement rail (organic ordering is never affected)',
      'Deal spotlight on featured rail and neighborhood pages',
      'Neighborhood-page featured slots in your service area',
      'Priority support with dedicated onboarding',
      'Everything in Verified Listing',
    ],
    cta: 'Get started',
    ctaHref: '/business/claim',
    highlight: true,
  },
  {
    name: 'SiteMind for Dispensaries',
    price: '$499',
    cadence: '/mo · month-to-month',
    badge: 'Founding pricing',
    description: 'Monthly AI-visibility audit and fixes for your own dispensary website.',
    features: [
      'Monthly AI-visibility audit for your website (schema, llms.txt, agent-readability)',
      'Hands-on fixes: structured data, sitemap, canonicals',
      'Sentinel report: monitor your AI-answer-engine presence',
      'Private SiteMind dashboard with receipt-producing evidence trail',
      'Everything in Featured',
    ],
    cta: 'Get started',
    ctaHref: '/business/claim',
    highlight: false,
  },
  {
    name: 'Menu Sync',
    price: 'Free',
    cadence: 'during beta',
    badge: null,
    description: 'Dutchie/Jane-compatible menu ingestion with evidence labels on every entry.',
    features: [
      'Dutchie- and Jane-compatible menu ingestion',
      'Evidence labels on every menu entry (source, state, freshness)',
      'Auto-refresh on your POS schedule',
      'Structured data for verified menu items',
      '30-day notice before any pricing change at beta exit',
    ],
    cta: 'Join the beta',
    ctaHref: '/business/claim',
    highlight: false,
  },
];

const PRINCIPLES = [
  {
    icon: BadgeCheck,
    title: 'Labeled, never pay-to-rank',
    body: 'Sponsorship is clearly labeled and lives in a designated rail. Organic directory ordering is always truth-first, not spend-first.',
  },
  {
    icon: RefreshCw,
    title: 'Month-to-month, cancel anytime',
    body: 'No annual lock-ins. No cancellation fees. Your subscription lives or dies by the value we deliver each month.',
  },
  {
    icon: Lock,
    title: 'Your data stays yours',
    body: 'We never sell your customer or business data to third parties. You can export or delete your records at any time.',
  },
];

export default async function PricingPage() {
  const origin = await requestOrigin();
  const breadcrumb = breadcrumbJsonLd([
    { name: 'Home', url: `${origin.origin}/` },
    { name: 'Pricing', url: `${origin.origin}/pricing` },
  ]);
  const faq = faqJsonLd(PRICING_FAQ_ENTRIES);

  return (
    <div className="flex-grow animate-fade-in">
      {breadcrumb && <script {...jsonLdScriptProps(breadcrumb)} />}
      {faq && <script {...jsonLdScriptProps(faq)} />}

      {/* Hero */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="kicker mb-4">Transparent pricing · Industry first</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            Prices on the page.{' '}
            <span className="text-emerald-600">No sales call.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-muted">
            Every cannabis platform competitor — Weedmaps, Leafly, Where&apos;s
            Weed, and every regional player — hides merchant pricing behind
            &ldquo;request a demo&rdquo; and sales calls. We publish ours. If
            you have to ask what something costs, you&apos;re already being
            nudged into a funnel.
          </p>
        </div>
      </section>

      {/* Tier grid */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <article
              key={tier.name}
              className={`record-card rounded-2xl p-6 flex flex-col ${
                tier.highlight
                  ? 'ring-2 ring-brand-primary/40'
                  : ''
              }`}
            >
              {/* Badge */}
              <div className="mb-3 flex items-center gap-2">
                {tier.badge ? (
                  <span className="inline-flex items-center rounded-full bg-brand-gold/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">
                    {tier.badge}
                  </span>
                ) : (
                  <span className="h-5" aria-hidden="true" />
                )}
              </div>

              {/* Name + price */}
              <h2 className="font-display text-lg font-bold text-brand-text">
                {tier.name}
              </h2>
              <div className="mt-2 flex items-end gap-1">
                <span className="font-display text-3xl font-bold text-brand-text">
                  {tier.price}
                </span>
                <span className="mb-1 text-xs text-brand-muted">{tier.cadence}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-brand-muted">
                {tier.description}
              </p>

              {/* Features */}
              <ul className="mt-5 flex-grow space-y-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-brand-muted">
                    <BadgeCheck
                      size={14}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-brand-primary-text"
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href={tier.ctaHref}
                className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:brightness-110 ${
                  tier.highlight
                    ? 'bg-brand-primary text-black'
                    : 'border border-brand-border bg-brand-background text-brand-text hover:border-brand-primary/50 hover:text-brand-primary-text'
                }`}
              >
                {tier.cta}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Principles strip */}
      <section className="border-y border-brand-border bg-brand-surface/60 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="kicker mb-6 text-center">Our commitments</p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="flex flex-col items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/12 text-brand-primary-text ring-1 ring-brand-primary/25">
                  <p.icon size={18} aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-bold text-brand-text">
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed text-brand-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="font-display text-2xl font-bold text-brand-text">
          Frequently asked questions
        </h2>
        <dl className="mt-6 space-y-6">
          {PRICING_FAQ_ENTRIES.map((entry) => (
            <div key={entry.question} className="rounded-2xl border border-brand-border bg-brand-surface p-5">
              <dt className="text-sm font-bold text-brand-text">{entry.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-brand-muted">
                {entry.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Honest footnote */}
      <section className="border-t border-brand-border px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl flex flex-col items-center gap-3 text-center">
          <span className="flex items-center gap-1.5 text-xs text-brand-muted">
            <DollarSign size={12} aria-hidden="true" className="text-brand-primary-text" />
            <strong className="text-brand-text">Founding pricing note:</strong> Featured and SiteMind rates are founding prices, subject to change at general launch. Existing subscribers keep their rate for the life of their active subscription. Sponsorship never affects organic directory ordering — ever.
          </span>
          <Link
            href="/business/claim"
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-6 py-3 text-sm font-bold text-black transition-all hover:brightness-110"
          >
            <Zap size={14} aria-hidden="true" />
            Claim your listing — it&apos;s free
          </Link>
        </div>
      </section>
    </div>
  );
}
