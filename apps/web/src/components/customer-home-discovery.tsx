import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

const PRODUCTS = [
  { slug: 'flower', label: 'Flower', image: '/marketplace/product-0.webp' },
  { slug: 'edibles', label: 'Edibles', image: '/marketplace/product-1.webp' },
  { slug: 'vapes', label: 'Vapes', image: '/marketplace/product-2.webp' },
  { slug: 'concentrates', label: 'Concentrates', image: '/marketplace/product-3.webp' },
  { slug: 'pre-rolls', label: 'Pre-rolls', image: '/art/cat-pre-rolls.jpg' },
  { slug: 'topicals', label: 'Topicals', image: '/art/cat-topicals.jpg' },
];

const NEIGHBORHOODS = [
  ['georgetown', 'Georgetown', 'Historic streets and west-side access context.'],
  ['dupont-circle', 'Dupont Circle', 'Central connections and nearby candidate records.'],
  ['u-street-shaw', 'U Street & Shaw', 'A local guide to two connected neighborhoods.'],
  ['capitol-hill', 'Capitol Hill', 'East-of-downtown discovery and access notes.'],
  ['navy-yard-wharf', 'Navy Yard & Wharf', 'Waterfront-area candidates and delivery context.'],
];

export default function CustomerHomeDiscovery() {
  return (
    <>
      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Product discovery</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#111612] sm:text-4xl">Browse the format before the menu.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#606a63]">Categories are discovery paths. Availability and price belong only to a labeled menu record.</p>
          </div>
          <Link href="/products" className="inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35]">All product records<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-6">
          {PRODUCTS.map((product) => (
            <Link key={product.slug} href={`/products?category=${product.slug}`} className="group block">
              <Image src={product.image} alt="" width={900} height={900} unoptimized sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 16vw" className="aspect-square w-full rounded-xl object-cover" />
              <span className="mt-3 flex items-center justify-between gap-2 font-display text-lg font-semibold text-[#182019]">
                {product.label}<ArrowRight size={14} className="text-[#0b5b35]" aria-hidden="true" />
              </span>
              <span className="mt-1 block text-xs text-[#68716b]">Illustrative category artwork</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-screen-2xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b5b35]">Neighborhood discovery</p>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-[-0.045em] text-[#111612]">D.C. is more useful than a single “near me” list.</h2>
            <p className="mt-4 text-sm leading-relaxed text-[#606a63]">Neighborhood pages use fixed candidate windows and local context. They do not prove that a delivery service covers an address.</p>
            <Link href="/neighborhoods" className="mt-5 inline-flex min-h-11 items-center gap-2 py-2 text-sm font-bold text-[#0b5b35]">Explore all neighborhoods<ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          <ol className="space-y-7">
            {NEIGHBORHOODS.map(([slug, label, detail], index) => (
              <li key={slug}>
                <Link href={`/neighborhoods/${slug}`} className="group grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 py-2">
                  <span className="font-evidence text-xs text-[#68716b]">0{index + 1}</span>
                  <span>
                    <span className="block font-display text-2xl font-semibold tracking-[-0.03em] text-[#151b16] group-hover:text-[#0b5b35]">{label}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-[#667069]">{detail}</span>
                  </span>
                  <ArrowRight size={16} className="mt-1 text-[#0b5b35]" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
