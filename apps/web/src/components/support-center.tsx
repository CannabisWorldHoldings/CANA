'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  ChevronDown,
  CircleHelp,
  Mail,
  Search,
  ShieldCheck,
} from 'lucide-react';

const FAQS = [
  {
    category: 'Account',
    question: 'Do I need an account to browse or compare listings?',
    answer:
      'No. Browsing the directory, reviewing evidence, and comparing public records do not require an account. Account-only actions identify themselves before asking you to sign in.',
  },
  {
    category: 'Access',
    question: 'How do I purchase medical cannabis in Washington, D.C.?',
    answer:
      'Washington, D.C. permits eligible residents and visitors age 21+ to register for temporary or permanent medical cannabis access. Confirm current requirements directly with the D.C. Alcoholic Beverage and Cannabis Administration before visiting a retailer.',
  },
  {
    category: 'Access',
    question: 'Does D.C. accept out-of-state medical cannabis cards?',
    answer:
      'D.C. recognizes registrations from participating states and territories. Reciprocity rules can change, so use the government source linked from our legal guide before relying on a card.',
  },
  {
    category: 'Rules',
    question: 'What is the legal possession or purchase limit?',
    answer:
      'Limits depend on the applicable D.C. program and product type. ORDERWEEDDC does not calculate legal eligibility. Check the current ABCA guidance linked in the legal center.',
  },
  {
    category: 'Data',
    question: 'How does ORDERWEEDDC verify a retailer listing?',
    answer:
      'A record can receive Verified Current status only when its license, business identity, source URL, and freshness window satisfy the public evidence policy. Every status remains visible on the record.',
  },
  {
    category: 'Data',
    question: 'Why does a listing say awaiting verification or stale?',
    answer:
      'The label means the evidence is incomplete or outside its freshness window. It is a warning to re-check the primary source, not a claim that the business is open or closed.',
  },
  {
    category: 'Shopping',
    question: 'What is the difference between storefront and delivery records?',
    answer:
      'Storefront records describe physical locations. Delivery records describe services that may offer delivery. Availability, service area, and eligibility must be confirmed with the retailer.',
  },
  {
    category: 'Shopping',
    question: 'Does ORDERWEEDDC sell or deliver cannabis?',
    answer:
      'No. ORDERWEEDDC is an evidence-aware discovery directory. Any eligible handoff goes to the retailer, which controls inventory, fulfillment, pricing, and customer support.',
  },
];

export default function SupportCenter({
  supportEmail,
}: {
  supportEmail: string;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visibleFaqs = useMemo(
    () =>
      normalized
        ? FAQS.filter((faq) =>
            `${faq.category} ${faq.question} ${faq.answer}`
              .toLowerCase()
              .includes(normalized),
          )
        : FAQS,
    [normalized],
  );

  return (
    <div className="space-y-10">
      <section aria-labelledby="support-search-title">
        <h2 id="support-search-title" className="sr-only">
          Search help topics
        </h2>
        <div className="relative mx-auto max-w-3xl">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted"
          />
          <label htmlFor="support-search" className="sr-only">
            Search help topics
          </label>
          <input
            id="support-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search access, listings, delivery, rules…"
            className="w-full rounded-2xl border border-brand-border bg-brand-surface py-4 pl-12 pr-4 text-sm text-brand-text shadow-sm placeholder:text-brand-muted/70 focus:border-brand-primary focus:outline-none"
          />
        </div>
      </section>

      <section
        aria-label="Support channels"
        className="grid gap-4 md:grid-cols-3"
      >
        <a
          href={`mailto:${supportEmail}?subject=ORDERWEEDDC%20support`}
          className="record-card rounded-2xl p-6"
        >
          <Mail size={20} className="text-brand-primary" aria-hidden="true" />
          <h2 className="mt-4 text-base font-bold text-brand-text">
            Email support
          </h2>
          <p className="mt-2 break-all text-xs font-semibold text-brand-primary">
            {supportEmail}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-brand-muted">
            Include the page URL and the evidence you want us to review.
          </p>
        </a>
        <Link href="/business/claim" className="record-card rounded-2xl p-6">
          <Building2
            size={20}
            className="text-brand-primary"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-base font-bold text-brand-text">
            Business support
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-brand-muted">
            Claim a listing, submit primary sources, or manage a verified
            business record.
          </p>
        </Link>
        <Link href="/legal" className="record-card rounded-2xl p-6">
          <ShieldCheck
            size={20}
            className="text-brand-primary"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-base font-bold text-brand-text">
            Rules and data policy
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-brand-muted">
            Review the D.C. source links, verification policy, and legal
            disclosures.
          </p>
        </Link>
      </section>

      <section aria-labelledby="frequent-questions-title">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="kicker mb-2">Frequently asked</p>
            <h2
              id="frequent-questions-title"
              className="font-display text-2xl font-bold text-brand-text"
            >
              Answers with source boundaries.
            </h2>
          </div>
          <span className="hidden text-xs text-brand-muted sm:block">
            {visibleFaqs.length} topic{visibleFaqs.length === 1 ? '' : 's'}
          </span>
        </div>

        {visibleFaqs.length === 0 ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-brand-border bg-brand-surface p-10 text-center"
          >
            <CircleHelp
              size={24}
              className="mx-auto text-brand-primary"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-bold text-brand-text">
              No matching help topic
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              Try a broader search or email {supportEmail}.
            </p>
          </div>
        ) : (
          <div className="mt-5 divide-y divide-brand-border overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
            {visibleFaqs.map((faq) => (
              <details key={faq.question} className="group p-5 sm:p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-brand-text">
                  <span>
                    <span className="mr-2 text-[10px] uppercase tracking-wider text-brand-primary">
                      {faq.category}
                    </span>
                    {faq.question}
                  </span>
                  <ChevronDown
                    size={17}
                    aria-hidden="true"
                    className="shrink-0 text-brand-muted transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-brand-muted">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
