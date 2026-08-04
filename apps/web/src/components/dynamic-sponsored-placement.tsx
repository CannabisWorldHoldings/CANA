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
      className="bg-white px-4 py-6 text-slate-950 sm:px-6 lg:px-10 lg:py-8"
      data-campaign-id={campaign.id}
      data-dynamic-creative-placement="owner-review"
      data-provider-network="0"
      data-review-state={isFallback ? campaign.decision : 'OWNER_REVIEW_REQUIRED'}
      data-strategy={campaign.strategy}
    >
      <div className="mx-auto max-w-screen-2xl overflow-hidden rounded-3xl bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.16)]">
        <div className="grid min-h-[420px] lg:grid-cols-[1.08fr_0.92fr]">
          <picture className="relative block min-h-[300px] overflow-hidden lg:min-h-[420px]">
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

          <div className="flex flex-col justify-between bg-white p-6 sm:p-9 lg:p-12">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                  {isFallback ? 'ORDERWEEDDC house campaign' : 'Sponsored'}
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-900">
                  Local owner-review fixture
                </span>
              </div>
              <p className="mt-7 text-xs font-black uppercase tracking-[0.2em] text-emerald-800">
                {campaign.eyebrow}
              </p>
              <h2
                id={`dynamic-creative-${campaign.id}`}
                className="mt-3 max-w-xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-5xl"
              >
                {campaign.headline}
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                {campaign.body}
              </p>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <span className="inline-flex min-h-12 items-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white">
                {campaign.cta}
              </span>
              <span className="text-xs font-semibold leading-5 text-slate-500">
                Synthetic advertiser · no live action · no pay-to-rank
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
