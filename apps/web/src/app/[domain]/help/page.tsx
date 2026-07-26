import Link from 'next/link';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { HelpCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = buildPublicMetadata({
  title: 'Help & Data Policy',
  description:
    'Answers to common questions about Washington D.C. medical cannabis laws, ABCA reciprocity, patient registration, and evidence verification.',
  canonicalPath: '/help',
});

const FAQS = [
  {
    question: 'How do I purchase medical cannabis in Washington, D.C.?',
    answer:
      'Washington D.C. permits both resident and non-resident patients (age 21+) to register for a temporary or permanent ABCA medical cannabis card online or in-person at licensed dispensaries.',
  },
  {
    question: 'Does D.C. accept out-of-state medical cannabis cards (Reciprocity)?',
    answer:
      'Yes! D.C. ABCA recognizes valid medical cannabis registrations from over 30 states and U.S. territories. Out-of-state patients can purchase directly from licensed D.C. dispensaries.',
  },
  {
    question: 'What is the legal possession limit for medical cannabis in D.C.?',
    answer:
      'Registered patients are allowed to purchase up to 8 ounces of medical cannabis (or equivalent concentrate/edible limit) per rolling 30-day window.',
  },
  {
    question: 'How does Order Weed DC verify dispensary listings?',
    answer:
      'Every active retailer profile is audited against official D.C. ABCA license records, physical storefront addresses, and public evidence URLs before receiving a Verified Current status label.',
  },
  {
    question: 'What is the difference between Storefront and Delivery retailers?',
    answer:
      'Storefront dispensaries operate physical retail locations for in-person shopping, while licensed delivery services deliver medical products directly to eligible D.C. residential addresses.',
  },
];

export default async function HelpPage() {
  return (
    <div className="flex-grow animate-fade-in">
      {/* Hero header */}
      <section className="hero-aurora border-b border-brand-border px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="text-xs font-bold text-brand-muted transition-colors hover:text-brand-primary-text">
            ← Back to directory
          </Link>
          <p className="kicker mt-5 mb-3">Patient Guidance &amp; FAQ</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand-text sm:text-4xl">
            Washington D.C. Medical Cannabis{' '}
            <span className="text-brand-primary-text">Help Desk</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-muted">
            Everything you need to know about D.C. ABCA medical cannabis regulations, patient registration, and verified dispensary listings.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* FAQ Accordion Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {FAQS.map((faq, index) => (
            <div
              key={index}
              className="record-card rounded-2xl p-6 space-y-3"
            >
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-brand-primary-fill-strong text-white font-black text-xs flex items-center justify-center shrink-0">
                  <HelpCircle size={12} aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-extrabold text-brand-text leading-snug">{faq.question}</h3>
              </div>
              <p className="text-xs text-brand-muted leading-relaxed pl-9">{faq.answer}</p>
            </div>
          ))}
        </div>

        {/* Contact & Support Section */}
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-8 text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="font-display text-lg font-bold text-brand-text">Have a question or correction request?</h2>
          <p className="text-xs text-brand-muted max-w-md mx-auto">
            Our compliance ledger ensures all business listings and primary sources remain accurate and up-to-date.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/business/claim"
              className="bg-brand-primary-fill-strong text-white font-bold text-xs px-5 py-2.5 rounded-xl hover:brightness-110 transition-all"
            >
              Claim Your Business →
            </Link>
            <Link
              href="/"
              className="border border-brand-border text-brand-text font-bold text-xs px-5 py-2.5 rounded-xl hover:bg-brand-background transition-colors"
            >
              Browse Dispensaries
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
