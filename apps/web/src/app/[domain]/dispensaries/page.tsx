import { notFound } from 'next/navigation';
import CustomerDirectoryPage from '@/components/customer-directory-page';
import { loadCustomerDirectory } from '@/lib/customer-marketplace-data';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';

export const metadata = buildPublicMetadata({
  title: 'Cannabis Dispensaries in Washington, D.C. — Source-Labeled Directory',
  description: 'Browse D.C. dispensary storefront records with explicit source, freshness, menu and deal states.',
  canonicalPath: '/dispensaries',
});

export default async function DispensariesPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ query?: string | string[]; page?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const directory = await loadCustomerDirectory({
    domain,
    type: 'storefront',
    query: filters.query,
    page: filters.page,
  });
  if (!directory) return notFound();

  return (
    <CustomerDirectoryPage
      mode="dispensaries"
      query={directory.query}
      listings={directory.retailers}
      totalResults={directory.totalResults}
      totalPages={directory.totalPages}
      currentPage={directory.currentPage}
    />
  );
}
