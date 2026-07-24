import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BadgePercent,
  BookOpenCheck,
  MapPinned,
  SearchCheck,
  Store,
} from 'lucide-react';

type MarketplaceHomeHeroProps = {
  activeDealCount: number;
  articleCount: number;
  totalResults: number;
  verifiedCurrentCount: number;
};

const TRUST_POINTS = [
  { label: 'Source-labeled', icon: SearchCheck },
  { label: 'No pay-to-rank', icon: BadgeCheck },
  { label: 'D.C. focused', icon: MapPinned },
];

export default function MarketplaceHomeHero({
  activeDealCount,
  articleCount,
  totalResults,
  verifiedCurrentCount,
}: MarketplaceHomeHeroProps) {
  const snapshot = [
    {
      label: 'Labeled listings',
      value: totalResults,
      icon: Store,
    },
    {
      label: 'Verified current',
      value: verifiedCurrentCount,
      icon: BadgeCheck,
    },
    {
      label: 'Current offers',
      value: activeDealCount,
      icon: BadgePercent,
    },
    {
      label: 'D.C. guides',
      value: articleCount,
      icon: BookOpenCheck,
    },
  ];

  return (
    <section className="marketplace-hero relative overflow-hidden border-b border-brand-border">
      <img
        src="/marketplace/hero-marketplace-v2.webp"
        alt=""
        width={1800}
        height={900}
        className="marketplace-hero__image absolute inset-0 h-full w-full object-cover"
      />
      <div className="marketplace-hero__veil absolute inset-0" />

      <div className="relative mx-auto grid min-h-[570px] max-w-screen-2xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-10 lg:py-16">
        <div className="max-w-2xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-primary/35 bg-brand-background/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-primary backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-brand-primary" />
            Washington, D.C. cannabis discovery
          </p>
          <h1 className="max-w-3xl font-display text-5xl font-bold leading-[0.96] tracking-[-0.055em] text-brand-text sm:text-6xl lg:text-7xl">
            The D.C. market,
            <span className="block text-brand-primary">without the guesswork.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-brand-muted sm:text-lg">
            Browse dispensaries, delivery services, products, offers, and
            neighborhood guides with the source and data status visible before
            you decide.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#directory"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-3.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5"
            >
              Explore listings
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <Link
              href="/deals"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-border bg-brand-surface/80 px-5 py-3.5 text-sm font-bold text-brand-text backdrop-blur-md transition-colors hover:border-brand-primary/50"
            >
              Browse current offers
              <BadgePercent size={16} aria-hidden="true" />
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {TRUST_POINTS.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted"
              >
                <Icon
                  size={15}
                  className="text-brand-primary"
                  aria-hidden="true"
                />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <aside
          aria-label="Current directory snapshot"
          className="marketplace-snapshot ml-auto w-full max-w-xl rounded-2xl border border-brand-border p-5 shadow-2xl sm:p-6"
        >
          <div className="flex items-center justify-between border-b border-brand-border pb-4">
            <div>
              <p className="kicker">Directory snapshot</p>
              <h2 className="mt-1 font-display text-xl font-bold text-brand-text">
                What the evidence supports now
              </h2>
            </div>
            <span className="rounded-full border border-brand-primary/25 bg-brand-primary/10 px-2.5 py-1 text-[10px] font-bold text-brand-primary">
              Live database
            </span>
          </div>

          <dl className="mt-2 divide-y divide-brand-border">
            {snapshot.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-3 py-3.5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <dt className="text-sm font-medium text-brand-muted">{label}</dt>
                <dd className="ml-auto font-display text-xl font-bold text-brand-text">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-primary/10 px-4 py-3 text-xs font-semibold leading-relaxed text-brand-text">
            <BadgeCheck
              size={16}
              className="shrink-0 text-brand-primary"
              aria-hidden="true"
            />
            Counts come from the current directory. Demonstration records remain
            explicitly labeled.
          </p>
        </aside>
      </div>
    </section>
  );
}
