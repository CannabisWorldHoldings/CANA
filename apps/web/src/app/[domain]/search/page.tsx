import { notFound } from 'next/navigation';
import CustomerWorldPage from '@/components/customer-world-page';
import { loadCustomerWorld } from '@/lib/customer-world.server';

export const metadata = {
  title: 'Search Verified Merchant Reality',
  robots: { index: false, follow: true },
};

export default async function SearchPage({ params, searchParams }: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ market?: string | string[]; query?: string | string[]; view?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const result = await loadCustomerWorld({
    journey: 'SEARCH',
    market: filters.market,
    query: filters.query,
    view: filters.view,
    tenantDomain: domain,
  });
  if (!result) return notFound();
  return <CustomerWorldPage world={result.world} />;
}
