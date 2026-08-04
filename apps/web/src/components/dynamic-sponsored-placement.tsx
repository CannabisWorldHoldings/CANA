type ReviewCampaign = {
  id: string;
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  desktopAsset: string;
  mobileAsset: string;
  alt: string;
  strategy: string;
  decision: string;
};

export default function DynamicSponsoredPlacement({ campaign }: { campaign: ReviewCampaign }) {
  const isFallback = campaign.id === 'source-before-hype';
  return (
    <section
      aria-labelledby={`dynamic-creative-${campaign.id}`}
      className="bg-brand-background px-4 py-8 text-brand-text sm:px-6 lg:px-10 lg:py-10"
      data-campaign-id={campaign.id}
      data-dynamic-creative-placement="owner-review"
      data-provider-network="0"
      data-review-state={isFallback ? campaign.decision : 'OWNER_REVIEW_REQUIRED'}
      data-strategy={campaign.strategy}
    >
      <div className="mx-auto max-w-screen-2xl overflow-hidden bg-brand-surface">
        <div className="grid lg:grid-cols-2">
          <picture className="relative block aspect-[4/5] overflow-hidden sm:aspect-[16/9] lg:aspect-auto lg:min-h-96">
            <source media="(max-width: 639px)" srcSet={campaign.mobileAsset} />
            <img
              src={campaign.desktopAsset}
              alt={campaign.alt}
              width={1600}
              height={900}
              className="absolute inset-0 h-full w-full object-cover"
              data-creative-asset
            />
          </picture>

          <div className="flex flex-col justify-between bg-brand-surface p-6 sm:p-9 lg:p-12">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-text px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-brand-background">
                  {isFallback ? 'ORDERWEEDDC house campaign' : 'Sponsored'}
                </span>
                <span className="rounded-full bg-brand-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-primary-text">
                  Local owner-review fixture
                </span>
              </div>
              <p className="mt-7 text-xs font-black uppercase tracking-[0.2em] text-brand-primary-text">
                {campaign.eyebrow}
              </p>
              <h2
                id={`dynamic-creative-${campaign.id}`}
                className="mt-3 max-w-xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.045em] text-brand-text sm:text-5xl"
              >
                {campaign.headline}
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-6 text-brand-muted sm:text-base sm:leading-7">
                {campaign.body}
              </p>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <span className="inline-flex min-h-12 items-center rounded-xl bg-brand-primary-fill-strong px-5 py-3 text-sm font-bold text-white">
                {campaign.cta}
              </span>
              <span className="text-xs font-semibold leading-5 text-brand-muted">
                Synthetic advertiser · no live action · no pay-to-rank
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
