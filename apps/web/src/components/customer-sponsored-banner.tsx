'use client';

import { useEffect } from 'react';
import Link from 'next/link';

type BannerCampaign = {
  id: string;
  sponsor: string;
  disclosure: string;
  headline: string;
  supportingText: string;
  cta: string;
  destination: string;
  desktopMedia: string;
  mobileMedia: string;
  altText: string;
  fundingKind: 'HOUSE' | 'PAID';
  approvalStatus?: 'APPROVED' | 'OWNER_REVIEW_PENDING';
  designToken?: 'campaign-local-orientation' | 'campaign-bounded-choice' | 'campaign-trust-before-handoff';
  impressionEvent: string;
  clickEvent: string;
};

const BANNER_EVENT_NAME = 'orderweeddc:banner-event';

function emitBannerEvent(campaign: BannerCampaign, eventName: string) {
  window.dispatchEvent(new CustomEvent(BANNER_EVENT_NAME, {
    detail: {
      campaignId: campaign.id,
      eventName,
      fundingKind: campaign.fundingKind,
    },
  }));
}

export default function CustomerSponsoredBanner({
  campaign,
}: {
  campaign: BannerCampaign | null;
}) {
  useEffect(() => {
    if (campaign) emitBannerEvent(campaign, campaign.impressionEvent);
  }, [campaign]);

  if (!campaign) return null;

  const ownerReviewPending = campaign.approvalStatus === 'OWNER_REVIEW_PENDING';
  return (
    <aside
      aria-label={`${campaign.disclosure} from ${campaign.sponsor}`}
      className="sovereign-banner mx-auto w-full max-w-screen-2xl px-4 pt-5 sm:px-6 lg:px-10 lg:pt-7"
      data-banner-campaign={campaign.id}
      data-banner-funding={campaign.fundingKind}
      data-banner-impression-event={campaign.impressionEvent}
      data-owner-review-campaign={ownerReviewPending ? 'true' : undefined}
      data-owner-review-status={ownerReviewPending ? 'PENDING' : undefined}
      data-campaign-system={campaign.designToken}
    >
      <div className="overflow-hidden rounded-2xl bg-[var(--campaign-surface)] lg:grid lg:grid-cols-[0.9fr_1.1fr]">
        <div className="order-2 flex flex-col justify-center px-5 py-6 sm:px-8 lg:order-1 lg:px-12 lg:py-9">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#3f4c44]">
            {campaign.disclosure} · {campaign.sponsor}
          </p>
          <h2 className="mt-3 max-w-xl font-display text-2xl font-semibold leading-tight tracking-[-0.035em] text-[var(--campaign-ink)] sm:text-3xl">
            {campaign.headline}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#58625c]">
            {campaign.supportingText}
          </p>
          {campaign.fundingKind === 'HOUSE' && !ownerReviewPending && (
            <p className="mt-2 text-xs text-[#626a65]">No paid campaign is live in this review build.</p>
          )}
          <Link
            href={campaign.destination}
            data-banner-click-event={campaign.clickEvent}
            onClick={() => emitBannerEvent(campaign, campaign.clickEvent)}
            className="mt-5 inline-flex min-h-11 w-fit items-center rounded-lg bg-[var(--campaign-accent)] px-5 py-3 text-sm font-bold text-white hover:brightness-90"
          >
            {campaign.cta}
          </Link>
        </div>

        <picture className="order-1 block lg:order-2">
          <source media="(max-width: 639px)" srcSet={campaign.mobileMedia} />
          <img
            src={campaign.desktopMedia}
            alt={campaign.altText}
            width={1680}
            height={720}
            fetchPriority="high"
            className="aspect-[16/7] h-full w-full object-cover lg:aspect-auto lg:min-h-[330px]"
          />
        </picture>
      </div>
    </aside>
  );
}
