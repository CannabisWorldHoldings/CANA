import { notFound } from 'next/navigation';
import CustomerSponsoredBanner from '@/components/customer-sponsored-banner';
import CustomerHomeHero from '@/components/customer-home-hero';
import CustomerHomeMarket from '@/components/customer-home-market';
import CustomerHomeDiscovery from '@/components/customer-home-discovery';
import CustomerHomeTrust from '@/components/customer-home-trust';
import CustomerReviewMarketplacePreview from '@/components/customer-review-marketplace-preview';
import { loadCustomerHome } from '@/lib/customer-marketplace-data';
import {
  HOUSE_BANNER_CAMPAIGN,
  selectOwnerReviewBanner,
  selectPrimaryBannerForServer,
} from '@/lib/customer-banner.mjs';
import { prisma } from '@/lib/prisma';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import { buildPublicMetadata } from '@/lib/seo-meta.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import { jsonLdScriptProps, retailerItemListJsonLd } from '@/lib/structured-data.mjs';

type Props = {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ ownerReviewCampaign?: string | string[] }>;
};

export const metadata = {
  ...buildPublicMetadata({
    title: 'Washington, D.C. Cannabis Marketplace — Dispensaries, Delivery & Deals',
    description: 'Find D.C. dispensaries, delivery participants, products, current offers and neighborhood guides with explicit source and data-state labels.',
    canonicalPath: '/',
  }),
  alternates: { canonical: '/' },
};

export default async function TenantHomePage({ params, searchParams }: Props) {
  const { domain } = await params;
  const query = await searchParams;
  const home = await loadCustomerHome(domain);
  if (!home) return notFound();

  const isCanonical = domain === CANONICAL_TENANT_DOMAIN;
  const asOf = new Date();
  const origin = await requestOrigin();
  const requestedCampaign = Array.isArray(query.ownerReviewCampaign)
    ? null
    : query.ownerReviewCampaign;
  const reviewBanner = isCanonical
    ? selectOwnerReviewBanner({
        campaignId: requestedCampaign,
        hostname: origin.hostname,
        reviewMode: process.env.CANA_OWNER_REVIEW_MODE,
      })
    : null;
  const banner = reviewBanner ?? (isCanonical
    ? await selectPrimaryBannerForServer({
        prisma,
        campaigns: [],
        houseCampaign: HOUSE_BANNER_CAMPAIGN,
        asOf,
      })
    : null);
  const renderedHome = reviewBanner
    ? {
        ...home,
        deals: home.deals.filter((deal) => !deal.isDemonstration && !deal.retailer.isDemonstration),
        delivery: home.delivery.filter((record) => !record.isDemonstration),
        dispensaries: home.dispensaries.filter((record) => !record.isDemonstration),
        articles: home.articles.filter((article) => !article.isDemonstration),
      }
    : home;
  const demonstration = [...renderedHome.delivery, ...renderedHome.dispensaries].some(
    (record) => record.isDemonstration,
  );
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
      {reviewBanner && <CustomerReviewMarketplacePreview activeDestination={reviewBanner.destination} />}
      <CustomerHomeHero demonstration={demonstration} />
      <CustomerHomeMarket
        deals={renderedHome.deals}
        delivery={renderedHome.delivery}
        dispensaries={renderedHome.dispensaries}
      />
      <CustomerHomeDiscovery />
      <CustomerHomeTrust articles={renderedHome.articles} />
    </div>
  );
}
