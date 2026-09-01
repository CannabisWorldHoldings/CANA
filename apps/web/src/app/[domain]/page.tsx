import { notFound } from 'next/navigation';
import CustomerWorldPage from '@/components/customer-world-page';
import { loadCustomerWorld } from '@/lib/customer-world.server';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import { issuePendingRightsCapability } from '@/lib/asset-registry.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { loadRuntimeExperienceManifest } from '@/lib/experience/runtime-manifest.server';

type Props = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{
    market?: string | string[];
    query?: string | string[];
    view?: string | string[];
  }>;
};

export const metadata = {
  ...buildPublicMetadata({
    title: 'Verified Cannabis Discovery in D.C., Maryland, and Virginia',
    description: 'Search regulator-backed merchant records through one evidence-gated CANA Reality path. Unknown facts remain explicit.',
    canonicalPath: '/',
  }),
  alternates: { canonical: '/' },
};

export default async function TenantHomePage({ params, searchParams }: Props) {
  const [{ domain }, filters, origin] = await Promise.all([
    params,
    searchParams,
    requestOrigin(),
  ]);
  const [result, manifest] = await Promise.all([
    loadCustomerWorld({
      journey: 'HOME',
      market: filters.market,
      query: filters.query,
      view: filters.view,
      tenantDomain: domain,
    }),
    loadRuntimeExperienceManifest({ tenant: domain, journey: 'HOME' }),
  ]);
  if (!result) return notFound();
  return (
    <CustomerWorldPage
      world={result.world}
      isCanonicalBrand={domain === CANONICAL_TENANT_DOMAIN}
      illustrativeArtCapability={issuePendingRightsCapability(origin.hostname)}
      manifest={manifest}
      tenant={domain}
    />
  );
}
