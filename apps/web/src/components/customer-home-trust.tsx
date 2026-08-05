import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, BadgeCheck, Clock3, Megaphone } from 'lucide-react';

type ArticlePreview = {
  id: string;
  slug: string;
  title: string;
  content: string;
  image: string | null;
  dataStatus: string;
  dataSource: string;
  isDemonstration: boolean;
};

const TRUST_POINTS = [
  { icon: BadgeCheck, title: 'Status is not popularity.', text: 'Verification labels describe the evidence stored for a record. They do not mean “best” or “most popular.”' },
  { icon: Megaphone, title: 'Paid placement stays disclosed.', text: 'A sponsored campaign is labeled separately and never changes a business record’s verification state.' },
  { icon: Clock3, title: 'Missing details stay missing.', text: 'We do not turn unavailable fees, service areas, prices, hours or arrival times into estimates.' },
];

const FAQ = [
  ['Does ORDERWEEDDC sell or deliver cannabis?', 'No. ORDERWEEDDC is a discovery directory and does not represent itself as the seller, fulfiller or delivery carrier. A business profile may offer an approved handoff to that business.'],
  ['What does “demonstration record” mean?', 'It means the record is synthetic review data. It is not a real business, menu, offer, price, service area or availability claim.'],
  ['Why do delivery results say to confirm the service area?', 'The current data model does not establish address-level eligibility. The business must confirm coverage and any fee, minimum, schedule or arrival estimate.'],
  ['How are current deals selected?', 'The route uses the repository current-deal predicate: the offer must be active and not past its recorded expiry. A demonstration offer remains not redeemable.'],
  ['Can sponsored placement make a listing verified?', 'No. Sponsorship and verification are separate states. Payment does not establish licensure, freshness, availability or rank.'],
];

export default function CustomerHomeTrust({ articles }: { articles: ArticlePreview[] }) {
  return (
    <>
      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Trust and transparency</p>
        <h2 className="mt-3 max-w-4xl font-display text-4xl font-semibold leading-tight tracking-[-0.045em] text-[#111612]">We keep the label close to the fact it qualifies.</h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-12">
          {TRUST_POINTS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="py-2">
              <Icon size={23} className="text-[#0b5b35]" aria-hidden="true" />
              <h3 className="mt-4 font-display text-xl font-semibold tracking-[-0.025em] text-[#151b16]">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#626c65]">{text}</p>
            </article>
          ))}
        </div>
        <Link href="/legal" className="mt-8 inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35]">Read how public claims are handled<ArrowRight size={14} aria-hidden="true" /></Link>
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Learn and local guides</p>
            <h2 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-[-0.04em] text-[#111612]">Useful context before the next click.</h2>
          </div>
          <Link href="/education" className="inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35]">Open the learning hub<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        {articles.length ? (
          <div className="mt-9 grid gap-10 md:grid-cols-3">
            {articles.map((article, index) => {
              const fallback = ['/art/hero-dc.jpg', '/art/cat-flower.jpg', '/art/cat-edibles.jpg'][index % 3];
              const image = article.image?.startsWith('/') ? article.image : fallback;
              return (
                <article key={article.id} className="py-2">
                  <Image src={image} alt="" width={1680} height={1050} unoptimized sizes="(max-width: 767px) 100vw, 33vw" className="aspect-[16/10] w-full rounded-xl object-cover" />
                  <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[#657068]">{article.isDemonstration ? 'Demonstration editorial draft' : article.dataSource}</p>
                  <h3 className="mt-2 font-display text-xl font-semibold leading-snug tracking-[-0.025em] text-[#151b16]">{article.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#68716b]">{article.content}</p>
                  <Link href={`/education/${article.slug}`} className="mt-3 inline-flex min-h-11 items-center py-2 text-sm font-bold text-[#0b5b35]">Read labeled guide</Link>
                </article>
              );
            })}
          </div>
        ) : <p role="status" className="mt-8 py-8 text-sm text-[#68716b]">No reviewed guide records are available in this data state.</p>}
      </section>

      <section className="mx-auto grid w-full max-w-screen-2xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.7fr_1.3fr] lg:px-10 lg:py-20">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Customer questions</p>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.04em] text-[#111612]">Plain answers, without the internal machinery.</h2>
        </div>
        <div className="space-y-5">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="group py-2">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-5 font-display text-lg font-semibold text-[#171d18] marker:hidden">
                {question}<span className="text-2xl font-normal text-[#0b5b35] group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="max-w-3xl pb-2 pr-10 text-sm leading-relaxed text-[#626c65]">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#67716a]">For businesses</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
          <p className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#171d18]">Own a D.C. business record? Submit evidence or request a correction through the separate business path.</p>
          <Link href="/business/claim" className="inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35]">For Businesses<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </section>
    </>
  );
}
