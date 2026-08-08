import DynamicSponsoredPlacement from '@/components/dynamic-sponsored-placement';
import { resolveDynamicCreativeReview } from '@/lib/dynamic-creative-review.mjs';
import { requestOrigin } from '@/lib/server-request-url';
import { notFound } from 'next/navigation';

type Props = {
  searchParams: Promise<{ campaign?: string | string[] }>;
};

export default async function DynamicCreativeReviewLab({ searchParams }: Props) {
  const selected = (await searchParams).campaign;
  const origin = await requestOrigin();
  const campaign = resolveDynamicCreativeReview({
    id: Array.isArray(selected) ? selected[0] : selected,
    hostname: origin.hostname,
    mode: process.env.CANA_DYNAMIC_CREATIVE_REVIEW_MODE,
  });
  if (!campaign) notFound();

  return (
    <main className="min-h-screen bg-slate-100 py-8" data-dynamic-creative-lab>
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-10">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Isolated composition court</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-slate-950">{campaign.eyebrow}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Local-only fixture surface. It has no publishing, charging, spending, rotation, or deployment authority.
        </p>
      </div>
      <DynamicSponsoredPlacement campaign={campaign} />
    </main>
  );
}
