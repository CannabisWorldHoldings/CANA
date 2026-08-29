import { notFound } from 'next/navigation';
import CustomerWorldPage from '@/components/customer-world-page';
import { loadCustomerWorld } from '@/lib/customer-world.server';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { loadRuntimeExperienceManifest } from '@/lib/experience/runtime-manifest.server';

export const metadata = buildPublicMetadata({
  title: 'Verified Dispensary Discovery',
  description: 'Find regulator-backed dispensary records without inferred hours, inventory, popularity, or availability.',
  canonicalPath: '/dispensaries',
});

export default async function DispensariesPage({ params, searchParams }: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ market?: string | string[]; query?: string | string[]; view?: string | string[] }>;
}) {
  const [{ domain }, filters] = await Promise.all([params, searchParams]);
  const [result, manifest] = await Promise.all([
    loadCustomerWorld({
      journey: 'DISPENSARIES',
      market: filters.market,
      query: filters.query,
      view: filters.view,
      tenantDomain: domain,
    }),
    loadRuntimeExperienceManifest({ tenant: domain, journey: 'DISPENSARIES' }),
  ]);
  if (!result) return notFound();
  return <CustomerWorldPage world={result.world} manifest={manifest} tenant={domain} />;
}
