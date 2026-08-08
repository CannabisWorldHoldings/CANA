import Link from 'next/link';

const paths = [
  { index: '01', label: 'Dispensaries', detail: 'Source-labeled D.C. records', href: '/dispensaries' },
  { index: '02', label: 'Delivery records', detail: 'Coverage stated by each source', href: '/delivery' },
  { index: '03', label: 'Current deals', detail: 'Validity state kept visible', href: '/deals' },
] as const;

export default function CustomerReviewMarketplacePreview({ activeDestination }: { activeDestination: string }) {
  return (
    <section
      aria-label="Marketplace paths continued from the owner-review campaign"
      className="owner-review-marketplace-paths mx-auto w-full max-w-screen-2xl px-4 pb-2 pt-4 sm:px-6 lg:px-10"
      data-owner-review-marketplace="true"
    >
      <div className="owner-review-marketplace-paths__rail px-5 py-5 text-white sm:px-7 lg:flex lg:items-center lg:gap-8">
        <div className="shrink-0 lg:w-52">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Continue into the marketplace</p>
          <p className="mt-1 text-sm font-semibold">Three real paths. Source state stays visible.</p>
        </div>
        <div className="mt-4 grid flex-1 gap-3 sm:grid-cols-3 lg:mt-0">
          {paths.map((item) => {
            const active = item.href === activeDestination;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="group flex min-h-20 items-center gap-3 border-l border-white/30 pl-4 hover:border-white"
              >
                <span className="owner-review-marketplace-paths__index text-xl font-black">{item.index}</span>
                <span>
                  <span className="block text-sm font-bold">{item.label}{active ? ' · campaign path' : ''}</span>
                  <span className="mt-1 block text-xs text-white/70 group-hover:text-white">{item.detail}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
