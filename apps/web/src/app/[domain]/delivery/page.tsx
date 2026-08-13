import { notFound } from 'next/navigation';
import CustomerWorldPage from '@/components/customer-world-page';
import { loadCustomerWorld } from '@/lib/customer-world.server';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';

export const metadata = buildPublicMetadata({
  title: 'Cannabis Delivery Discovery',
  description: 'A distinct delivery journey that preserves unknown eligibility, service area, fee, inventory, and ETA states.',
  canonicalPath: '/delivery',
});

export default async function DeliveryPage({ params, searchParams }: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ market?: string | string[]; query?: string | string[]; view?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const result = await loadCustomerWorld({
    journey: 'DELIVERY',
    market: filters.market,
    query: filters.query,
    view: filters.view,
    tenantDomain: domain,
  });
  if (!result) return notFound();
  return <CustomerWorldPage world={result.world} />;
}
