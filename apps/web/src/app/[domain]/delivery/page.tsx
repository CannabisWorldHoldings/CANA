import { notFound } from 'next/navigation';
import CustomerDirectoryPage from '@/components/customer-directory-page';
import { loadCustomerDirectory, normalizeCustomerQuery } from '@/lib/customer-marketplace-data';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';

export const metadata = buildPublicMetadata({
  title: 'Cannabis Delivery in Washington, D.C. — Source-Labeled Directory',
  description: 'Browse D.C. delivery participants with explicit data states and no invented service-area, fee, minimum, or arrival claims.',
  canonicalPath: '/delivery',
});

export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const query = normalizeCustomerQuery(filters.query);
  const directory = await loadCustomerDirectory({ domain, type: 'delivery', query });
  if (!directory) return notFound();

  return <CustomerDirectoryPage mode="delivery" query={query} listings={directory.retailers} />;
}
