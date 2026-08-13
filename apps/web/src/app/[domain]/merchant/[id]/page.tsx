import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCustomerMerchantProfile } from '@/lib/customer-world.server';
import { normalizeCustomerMerchantId } from '@/lib/customer-world.mjs';

type EvidenceField = { state: string; value: unknown };

function text(field: EvidenceField, fallback: string) {
  return field?.state === 'KNOWN' && typeof field.value === 'string' ? field.value : fallback;
}

export default async function MerchantProfilePage({ params, searchParams }: {
  params: Promise<{ domain: string; id: string }>;
  searchParams: Promise<{ market?: string | string[]; query?: string | string[] }>;
}) {
  const [{ domain, id }, filters] = await Promise.all([params, searchParams]);
  const merchantId = normalizeCustomerMerchantId(id);
  if (!merchantId) return notFound();
  const result = await loadCustomerMerchantProfile({
    merchantId,
    market: filters.market,
    query: filters.query,
    tenantDomain: domain,
  });
  if (!result) return notFound();
  const { merchant, request } = result.profile;
  const merchantFacts: ReadonlyArray<readonly [string, EvidenceField]> = [
    ['Regulatory state', merchant.regulatory_state],
    ['Hours', merchant.open_now],
    ['Price', merchant.price],
    ['Inventory', merchant.inventory],
    ['Delivery eligibility', merchant.delivery_eligibility],
    ['Service area', merchant.service_area],
  ];
  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-10" data-customer-merchant-id={merchant.id}>
      <p className="kicker">Canonical verified merchant profile</p>
      <h1 className="mt-3 font-display text-4xl font-bold text-brand-text">
        {text(merchant.name, 'Merchant name UNKNOWN')}
      </h1>
      <p className="mt-4 text-base text-brand-muted">
        {text(merchant.location.address, 'Address UNKNOWN')}, {' '}
        {text(merchant.location.city, 'City UNKNOWN')}, {' '}
        {text(merchant.location.region, 'Region UNKNOWN')}
      </p>
      <dl className="mt-8 grid gap-3 sm:grid-cols-2">
        {merchantFacts.map(([label, field]) => (
          <div key={label} className="rounded-xl border border-brand-border bg-brand-surface p-4">
            <dt className="text-xs font-semibold text-brand-muted">{label}</dt>
            <dd className="mt-1 font-bold text-brand-text">{field.state}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-xs text-brand-muted">Source: {merchant.provenance.source ?? 'UNKNOWN'}</p>
      <Link href={`/search?${new URLSearchParams({ market: request.market_id, ...(request.customer_query ? { query: request.customer_query } : {}) })}`} className="mt-7 inline-flex min-h-11 items-center font-bold text-brand-primary-text">
        Browse customer search
      </Link>
    </article>
  );
}
