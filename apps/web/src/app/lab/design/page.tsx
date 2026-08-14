import type { ReactNode } from 'react';
import DealCard from '@/components/deal-card';
import EditorialCard from '@/components/editorial-card';
import EvidenceTrigger from '@/components/evidence-trigger';
import MerchantCard from '@/components/merchant-card';
import NeighborhoodTile from '@/components/neighborhood-tile';
import ProductCard from '@/components/product-card';
import Rail, { RailItem } from '@/components/rail';
import SmartImage from '@/components/smart-image';
import {
  dealCardStates,
  editorialCardStates,
  FIXTURE_DISCLAIMER,
  merchantCardStates,
  neighborhoodTileStates,
  productCardStates,
} from '@/components/card-fixtures.mjs';
import { CHIP_KINDS, chipLabel } from '@/lib/label-vocabulary.mjs';

/**
 * /lab/design — the internal styleguide (P0.7, final foundation slice).
 * Every P0 primitive rendered in its lawful states, on DEMONSTRATION fixtures
 * only. This page is the visual court's fixture stage: the screenshot harness
 * points here for state coverage, and humans point here for the taste gates.
 * Internal: noindexed, outside the tenant shell, never linked from consumer
 * chrome.
 */
export const metadata = {
  title: 'ORDERWEEDDC design system — internal styleguide',
  robots: { index: false, follow: false },
};

const CHIP_DEMO_VALUES: Record<string, string | undefined> = {
  DEAL: '20% off first verified order',
  NEIGHBORHOOD: 'Dupont Circle',
};

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="owd-container-commerce" style={{ paddingBlock: 'var(--owd-sect-pad-sm)' }}>
      <h2 className="owd-h3 text-brand-text">{title}</h2>
      {note ? <p className="owd-body-reduced mt-1 max-w-2xl text-brand-muted">{note}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function DesignStyleguidePage() {
  const fullMerchants = Array.from({ length: 6 }, (_, index) => ({
    ...merchantCardStates.full,
    name: `${merchantCardStates.full.name} ${index + 1}`,
  }));

  return (
    <div className="canonical-tenant-shell min-h-screen bg-brand-background pb-24 text-brand-text">
      <aside className="demonstration-banner border-b px-4 py-2.5 text-center text-xs font-semibold">
        {FIXTURE_DISCLAIMER}
      </aside>

      <header className="owd-container-commerce" style={{ paddingBlock: 'var(--owd-sect-pad-md)' }}>
        <p className="owd-eyebrow text-brand-primary-text">Internal — P0 foundation</p>
        <h1 className="owd-h1 mt-2 text-brand-text">
          The design system.{' '}
          <span className="owd-quiet">Every primitive, every lawful state.</span>
        </h1>
        <p className="owd-intro mt-3 max-w-2xl text-brand-muted">
          Tokens, type trios, five card species, the rail, the disclosure ladder and the
          image pipeline — rendered on demonstration fixtures for the visual court and
          the human taste gates.
        </p>
      </header>

      <Section
        title="Typography trios"
        note="Sizes drop at exactly 1068px and 734px (the measured mechanism). Body never leaves 17px."
      >
        <div className="flex flex-col gap-3">
          <p className="owd-display">Display 64 · 52 · 40</p>
          <p className="owd-h1">Heading one 48 · 40 · 32</p>
          <p className="owd-h2">
            Heading two 40 · 32 · 28. <span className="owd-quiet">The two-tone pattern.</span>
          </p>
          <p className="owd-h3">Heading three 28 · 24 · 21</p>
          <p className="owd-intro">Intro 21 · 19 · 17 — a supporting sentence, never a paragraph.</p>
          <p className="owd-body">Body 17px constant — the reading floor on every surface.</p>
          <p className="owd-body-reduced">Body reduced 14px — card metadata and secondary copy.</p>
          <p className="owd-caption">Caption 12px — footnotes and disclosure text.</p>
        </div>
      </Section>

      <Section
        title="The closed chip vocabulary"
        note="Exactly eight kinds. Anything else throws at render time and fails the court (law A9)."
      >
        <div className="flex flex-wrap gap-2">
          {CHIP_KINDS.map((kind) => (
            <span key={kind} className="tint-chip">
              {chipLabel(kind, CHIP_DEMO_VALUES[kind])}
            </span>
          ))}
        </div>
      </Section>

      <Section
        title="Merchant cards"
        note="Exactly one fact chip (evidence > deal > distance). No photography renders the honest typographic variant — never a stock or generated storefront."
      >
        <div className="flex flex-wrap gap-5">
          <MerchantCard {...merchantCardStates.full} />
          <MerchantCard {...merchantCardStates.partial} />
          <MerchantCard {...merchantCardStates.zero} />
        </div>
      </Section>

      <Section
        title="Product cards"
        note="The middle card carries a price that is lawfully HIDDEN (source unverified) — absence is the design."
      >
        <div className="flex flex-wrap gap-5">
          <ProductCard {...productCardStates.full} />
          <ProductCard {...productCardStates.partial} />
          <ProductCard {...productCardStates.zero} />
        </div>
      </Section>

      <Section
        title="Deal cards"
        note="Temporal truth: expiring counts down honestly, expired says so and mutes. Offers live in type, never baked into imagery."
      >
        <div className="flex flex-wrap gap-5">
          <DealCard {...dealCardStates.full} />
          <DealCard {...dealCardStates.expiringSoon} />
          <DealCard {...dealCardStates.expired} />
        </div>
      </Section>

      <Section title="Editorial cards" note="Learning has a visible citation date, always.">
        <div className="flex flex-wrap gap-5">
          <EditorialCard {...editorialCardStates.full} />
          <EditorialCard {...editorialCardStates.zero} />
        </div>
      </Section>

      <Section
        title="Neighborhood tiles"
        note="Counts never inflate: zero renders as verification in progress."
      >
        <div className="flex flex-wrap gap-5">
          <NeighborhoodTile {...neighborhoodTileStates.full} />
          <NeighborhoodTile {...neighborhoodTileStates.zero} />
        </div>
      </Section>

      <div style={{ paddingBlock: 'var(--owd-sect-pad-sm)' }}>
        <Rail
          label="The rail."
          sublabel="Snap, structural peek, paddles on pointer devices."
          itemCount={fullMerchants.length}
        >
          {fullMerchants.map((merchant) => (
            <RailItem key={merchant.name}>
              <MerchantCard {...merchant} />
            </RailItem>
          ))}
        </Rail>
        <p className="owd-container-commerce owd-caption mt-3 text-brand-muted">
          A rail below its minimum ({'<'}4 items) renders nothing at all — the refusal law. There is
          deliberately no half-empty rail on this page to screenshot.
        </p>
      </div>

      <Section
        title="The disclosure ladder"
        note="Glance chip → receipt modal (desktop dialog / mobile bottom sheet). A trigger with zero claim rows renders NOTHING — there is intentionally no second trigger here."
      >
        <EvidenceTrigger
          entityName="Demonstration Dispensary"
          claims={[
            {
              field: 'License',
              value: 'DEMO-0000',
              source: 'DEMONSTRATION fixture',
              checkedAt: '2026-08-10T12:00:00Z',
              verification: 'VERIFIED',
            },
            {
              field: 'Hours',
              value: '9–9',
              source: 'DEMONSTRATION fixture',
              checkedAt: '2026-08-12T12:00:00Z',
              verification: 'SUPPORTED',
            },
            { field: 'Delivery eligibility', verification: 'UNKNOWN' },
          ]}
          unknowns={['Current inventory']}
        />
      </Section>

      <Section
        title="The image pipeline"
        note="Registry-resolved assets with reserved aspect ratios (zero CLS). The illustrative asset says what it is — it may never stand in for a real business."
      >
        <div className="flex flex-wrap items-start gap-8">
          <div className="w-64">
            <SmartImage assetId="brand.wordmark.light" context="chrome" />
            <p className="owd-caption mt-2 text-brand-muted">brand.wordmark.light — BRAND_MARK, OWNED</p>
          </div>
          <div className="w-80">
            <SmartImage assetId="marketplace.hero.v2" context="styleguide" allowPendingRights />
            <p className="owd-caption mt-2 text-brand-muted">
              marketplace.hero.v2 — GENERIC_ILLUSTRATIVE, demonstration contexts only
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
