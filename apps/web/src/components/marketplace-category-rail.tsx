import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  BookOpenCheck,
  Candy,
  Flower2,
  Pipette,
  Store,
  Truck,
  Wind,
} from 'lucide-react';

const QUICK_PATHS = [
  {
    href: '/deals',
    label: 'Deals',
    detail: 'Current offers',
    icon: BadgePercent,
  },
  {
    href: '/?type=storefront',
    label: 'Dispensaries',
    detail: 'Browse storefronts',
    icon: Store,
  },
  {
    href: '/?type=delivery',
    label: 'Delivery',
    detail: 'Explore services',
    icon: Truck,
  },
  {
    href: '/products?category=flower',
    label: 'Flower',
    detail: 'Browse format',
    icon: Flower2,
  },
  {
    href: '/products?category=edibles',
    label: 'Edibles',
    detail: 'Browse format',
    icon: Candy,
  },
  {
    href: '/products?category=concentrates',
    label: 'Concentrates',
    detail: 'Browse format',
    icon: Pipette,
  },
  {
    href: '/products?category=vapes',
    label: 'Vapes',
    detail: 'Browse format',
    icon: Wind,
  },
  {
    href: '/education',
    label: 'Learn',
    detail: 'D.C. guidance',
    icon: BookOpenCheck,
  },
];

const FEATURED_FORMATS = [
  {
    href: '/products?category=flower',
    label: 'Flower',
    detail: 'Compare source-labeled flower records.',
    image: '/marketplace/product-0.webp',
  },
  {
    href: '/products?category=edibles',
    label: 'Edibles',
    detail: 'Browse gummies and edible formats.',
    image: '/marketplace/product-1.webp',
  },
  {
    href: '/products?category=vapes',
    label: 'Vapes',
    detail: 'Explore cartridge and vapor formats.',
    image: '/marketplace/product-2.webp',
  },
  {
    href: '/products?category=concentrates',
    label: 'Concentrates',
    detail: 'Review concentrate records and sources.',
    image: '/marketplace/product-3.webp',
  },
];

export default function MarketplaceCategoryRail() {
  return (
    <section className="px-4 py-10 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-screen-2xl">
        <nav
          aria-label="Marketplace shortcuts"
          className="marketplace-quick-paths grid grid-cols-2 overflow-hidden rounded-2xl border border-brand-border sm:grid-cols-4 xl:grid-cols-8"
        >
          {QUICK_PATHS.map(({ href, label, detail, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex min-w-0 items-center gap-3 border-b border-r border-brand-border px-4 py-4 transition-colors hover:bg-brand-raised xl:border-b-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-brand-text group-hover:text-brand-primary">
                  {label}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-brand-muted">
                  {detail}
                </span>
              </span>
            </Link>
          ))}
        </nav>

        <div className="mt-10 flex items-end justify-between gap-4">
          <div>
            <p className="kicker">Explore the market</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-brand-text">
              Browse by product format
            </h2>
            <p className="mt-2 text-sm text-brand-muted">
              Editorial imagery helps you scan. Product facts still come from
              the labeled record.
            </p>
          </div>
          <Link
            href="/products"
            className="hidden items-center gap-2 text-sm font-bold text-brand-primary sm:inline-flex"
          >
            View all products
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FEATURED_FORMATS.map(({ href, label, detail, image }) => (
            <Link
              key={href}
              href={href}
              className="marketplace-format-card group relative min-h-60 overflow-hidden rounded-2xl border border-brand-border"
            >
              <img
                src={image}
                alt=""
                width={900}
                height={900}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
              <span className="marketplace-format-card__veil absolute inset-0" />
              <span className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                <span className="font-display text-xl font-bold text-white">
                  {label}
                </span>
                <span className="mt-1 block max-w-xs text-xs leading-relaxed text-white/75">
                  {detail}
                </span>
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white">
                  Browse
                  <ArrowRight size={13} aria-hidden="true" />
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
