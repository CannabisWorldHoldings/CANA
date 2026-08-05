import { notFound } from 'next/navigation';
import CustomerDirectoryPage from '@/components/customer-directory-page';
import { loadCustomerDirectory } from '@/lib/customer-marketplace-data';
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
  searchParams: Promise<{ query?: string | string[]; page?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const directory = await loadCustomerDirectory({
    domain,
    type: 'delivery',
    query: filters.query,
    page: filters.page,
  });
  if (!directory) return notFound();

  return (
    <CustomerDirectoryPage
      mode="delivery"
      query={directory.query}
      listings={directory.retailers}
      totalResults={directory.totalResults}
      totalPages={directory.totalPages}
      currentPage={directory.currentPage}
    />
  );
}
