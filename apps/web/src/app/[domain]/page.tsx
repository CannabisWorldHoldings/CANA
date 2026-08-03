import { notFound } from 'next/navigation';
import CustomerSponsoredBanner from '@/components/customer-sponsored-banner';
import CustomerHomeHero from '@/components/customer-home-hero';
import CustomerHomeMarket from '@/components/customer-home-market';
import CustomerHomeDiscovery from '@/components/customer-home-discovery';
import CustomerHomeTrust from '@/components/customer-home-trust';
import { loadCustomerHome } from '@/lib/customer-marketplace-data';
import { HOUSE_BANNER_CAMPAIGN, selectPrimaryBanner } from '@/lib/customer-banner.mjs';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import { jsonLdScriptProps, retailerItemListJsonLd } from '@/lib/structured-data.mjs';

type Props = { params: Promise<{ domain: string }> };

export const metadata = {
  ...buildPublicMetadata({
    title: 'Washington, D.C. Cannabis Marketplace — Dispensaries, Delivery & Deals',
    description: 'Find D.C. dispensaries, delivery participants, products, current offers and neighborhood guides with explicit source and data-state labels.',
    canonicalPath: '/',
  }),
  alternates: { canonical: '/' },
};

export default async function TenantHomePage({ params }: Props) {
  const { domain } = await params;
  const home = await loadCustomerHome(domain);
  if (!home) return notFound();

  const isCanonical = domain === CANONICAL_TENANT_DOMAIN;
  const asOf = new Date();
  const banner = isCanonical
    ? selectPrimaryBanner({ campaigns: [], houseCampaign: HOUSE_BANNER_CAMPAIGN, asOf })
    : null;
  const demonstration = [...home.delivery, ...home.dispensaries].some(
    (record) => record.isDemonstration,
  );
  const origin = await requestOrigin();
  const itemListJsonLd = isCanonical
    ? retailerItemListJsonLd({
        retailers: [...home.delivery, ...home.dispensaries],
        origin: origin.origin,
      })
    : null;

  return (
    <div className="customer-marketplace flex-grow bg-white text-[#111612]">
      {itemListJsonLd && <script {...jsonLdScriptProps(itemListJsonLd)} />}
      <CustomerSponsoredBanner campaign={banner} />
      <CustomerHomeHero demonstration={demonstration} />
      <CustomerHomeMarket
        deals={home.deals}
        delivery={home.delivery}
        dispensaries={home.dispensaries}
      />
      <CustomerHomeDiscovery />
      <CustomerHomeTrust articles={home.articles} />
    </div>
  );
}
