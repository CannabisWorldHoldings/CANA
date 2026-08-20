import { resolveSponsorship, dedupeSponsoredCards, SPONSORSHIP_STATES as S } from '@/lib/sponsorship-entitlement.mjs';
import { SponsorshipBadge, type SponsorshipView } from '@/components/sponsorship-badge';

export const dynamic = 'force-static';

/**
 * M-001 sponsorship state matrix, rendered from REAL entitlement resolution.
 *
 * Every card below runs the same resolver the production surfaces use, against
 * ledger-shaped rows. Nothing is hardcoded to "look sponsored": if the resolver
 * refuses, the badge is absent. That makes this page inspectable by the
 * sponsorship court through the browser.
 */
const M = 'merchant_alpha';
const future = new Date(Date.now() + 30 * 86400_000);
const past = new Date(Date.now() - 86400_000);

type LedgerEntry = Record<string, unknown>;
type ScenarioOptions = Record<string, unknown>;

const issue = (o: LedgerEntry = {}) => ({ merchantId: M, kind: 'ISSUE', seq: 0, amount: 500, authorizationRef: 'PO-1', expiresAt: future, prevHash: 'genesis', entryHash: 'h0', ...o });
const spend = (o: LedgerEntry = {}) => ({ merchantId: M, kind: 'SPEND', seq: 1, amount: -100, placement: 'FEATURED_CARD', disclosureLabel: 'Sponsored placement', affectsOrganicOrder: false, prevHash: 'h0', entryHash: 'h1', ...o });
const refund = (o: LedgerEntry = {}) => ({ merchantId: M, kind: 'REFUND', seq: 2, amount: 100, originalSeq: 1, reason: 'under-delivered', prevHash: 'h1', entryHash: 'h2', ...o });

const SCENARIOS: Array<{ id: string; title: string; note: string; entries: LedgerEntry[]; opts?: ScenarioOptions }> = [
  { id: 'active', title: 'Entitled placement', note: 'chain-linked, funded, unexpired', entries: [issue(), spend()] },
  { id: 'organic', title: 'Organic listing', note: 'no paid placement — no badge', entries: [] },
  { id: 'loading', title: 'Entitlement resolving', note: 'space reserved, no claim made', entries: [issue(), spend()], opts: { loading: true } },
  { id: 'expired', title: 'Expired campaign', note: 'funding past its expiry', entries: [issue({ expiresAt: past }), spend()] },
  { id: 'refunded', title: 'Refunded placement', note: 'spend fully reversed', entries: [issue(), spend(), refund()] },
  { id: 'unavailable', title: 'Ledger unavailable', note: 'fails closed, never assumes paid', entries: [issue(), spend()], opts: { ledgerAvailable: false } },
  { id: 'disguised', title: 'Undisclosed placement', note: 'paid but unlabeled — refused', entries: [issue(), spend({ disclosureLabel: '' })] },
  { id: 'forged', title: 'Forged entitlement', note: 'row not linked into the chain', entries: [issue(), spend({ entryHash: null })] },
  { id: 'rankbuy', title: 'Rank purchase attempt', note: 'claims to alter ordering — refused', entries: [issue(), spend({ affectsOrganicOrder: true })] },
];

export default function SponsorshipMatrix() {
  const resolved = SCENARIOS.map((s) => ({
    ...s,
    sponsorship: resolveSponsorship({ merchantId: M, entries: s.entries, placement: 'FEATURED_CARD', ...(s.opts ?? {}) }) as SponsorshipView,
  }));
  // Duplicate-campaign suppression across the rendered set.
  const allowed = dedupeSponsoredCards(
    resolved.map((r) => ({ id: r.id, merchantId: M, placement: 'FEATURED_CARD', sponsorshipState: r.sponsorship.state })),
  );

  return (
    <main style={{ background: '#FFFFFF', color: '#07120C', minHeight: '100vh', padding: '32px 5vw' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sponsorship state matrix</h1>
      <p style={{ marginTop: 8, fontSize: 13.5, maxWidth: 640, opacity: 0.72 }}>
        Every card resolves through the production entitlement gate. A badge appears only when a
        persisted, chain-linked, unexpired, unrefunded, order-neutral placement entitles it.
        Sponsorship never changes the order of results.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {resolved.map((r) => {
          const suppressed = r.sponsorship.state === S.ACTIVE && !allowed.has(r.id);
          const view = suppressed
            ? ({ ...r.sponsorship, state: S.NONE, label: null, reason: 'duplicate campaign suppressed', evidence: null } as SponsorshipView)
            : r.sponsorship;
          return (
            <li
              key={r.id}
              data-scenario={r.id}
              data-resolved-state={view.state}
              style={{ border: '1px solid #D8E4DC', borderRadius: 6, padding: '14px 15px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 14.5, fontWeight: 650 }}>{r.title}</span>
                <SponsorshipBadge sponsorship={view} />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.66 }}>{r.note}</p>
              <p style={{ margin: '6px 0 0', fontSize: 11, fontFamily: 'ui-monospace, monospace', opacity: 0.5 }}>
                {view.state} · {view.reason}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
