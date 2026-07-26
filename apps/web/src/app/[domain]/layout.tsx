import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  canonicalPlatformUrl,
  requestOrigin,
} from '@/lib/server-request-url';
import { buildTenantTheme, PLATFORM_TONES } from '@/lib/tenant-theme.mjs';
import { CANONICAL_TENANT_DOMAIN } from '@/lib/tenant-host.mjs';
import {
  PUBLIC_PRODUCT_DESCRIPTION,
  PUBLIC_PRODUCT_NAME,
} from '@/lib/product-brand';
import {
  jsonLdScriptProps,
  organizationJsonLd,
  webSiteJsonLd,
} from '@/lib/structured-data.mjs';
import CartDrawer from '@/components/cart-drawer';
import AgeGate from '@/components/age-gate';
import MobileNav from '@/components/mobile-nav';
import { Leaf, ShieldCheck } from 'lucide-react';

const NAV_LINKS = [
  { href: '/', label: 'Retailers' },
  { href: '/products', label: 'Products' },
  { href: '/deals', label: 'Deals' },
  { href: '/education', label: 'Learn' },
  { href: '/neighborhoods', label: 'Neighborhoods' },
  { href: '/compare', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
];

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const origin = await requestOrigin();
  const brand = await prisma.brand.findUnique({
    where: { domain },
  });
  const demonstrationCount = brand
    ? await prisma.retailer.count({
        where: {
          isDemonstration: true,
          menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
        },
      })
    : 0;
  const isDemonstrationEnvironment =
    origin.hostname.endsWith('.localhost') || demonstrationCount > 0;
  const displayName =
    domain === CANONICAL_TENANT_DOMAIN
      ? PUBLIC_PRODUCT_NAME
      : brand?.name || PUBLIC_PRODUCT_NAME;

  return {
    title: {
      default: `${displayName} | Washington, D.C.`,
      template: `%s | ${displayName}`,
    },
    description:
      domain === CANONICAL_TENANT_DOMAIN
        ? PUBLIC_PRODUCT_DESCRIPTION
        : brand?.description ||
          'Directory prototype with explicit source and verification states.',
    metadataBase: origin,
    robots: {
      index: !isDemonstrationEnvironment,
      follow: !isDemonstrationEnvironment,
    },
  };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const origin = await requestOrigin();
  const [canonicalAdmin, canonicalBusiness] = await Promise.all([
    canonicalPlatformUrl('/admin'),
    canonicalPlatformUrl('/business/login'),
  ]);
  const brand = await prisma.brand.findUnique({
    where: { domain },
  });
  const isCanonicalBrand = domain === CANONICAL_TENANT_DOMAIN;
  const displayName = isCanonicalBrand
    ? PUBLIC_PRODUCT_NAME
    : brand?.name || PUBLIC_PRODUCT_NAME;
  const demonstrationCount = brand
    ? await prisma.retailer.count({
        where: {
          isDemonstration: true,
          menus: { some: { brandMenus: { some: { brandId: brand.id } } } },
        },
      })
    : 0;

  const theme = buildTenantTheme(brand);
  const themeStyle = {
    '--brand-primary': theme.primary,
    '--brand-secondary': theme.secondary,
    '--brand-background': theme.background,
    '--brand-surface': theme.surface,
    '--brand-raised': PLATFORM_TONES.raised,
    '--brand-border': PLATFORM_TONES.border,
    '--brand-muted': PLATFORM_TONES.muted,
    '--brand-gold': PLATFORM_TONES.gold,
    '--brand-text': theme.text,
  } as CSSProperties;

  const siteOrigin = origin.origin;

  return (
    <div className="flex flex-col min-h-screen" style={themeStyle}>
      {isCanonicalBrand && (
        <>
          <script {...jsonLdScriptProps(organizationJsonLd({ origin: siteOrigin }))} />
          <script {...jsonLdScriptProps(webSiteJsonLd({ origin: siteOrigin }))} />
        </>
      )}

      <AgeGate />

      {/* Brand Header Nav */}
      <header className="border-b border-brand-border bg-brand-background/85 backdrop-blur-xl sticky top-0 z-50">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link
            href="/"
            aria-label={`${displayName} home`}
            className="flex shrink-0 items-center gap-2.5 text-xl font-bold tracking-[-0.04em] text-brand-text font-display"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary/15 text-brand-primary-text ring-1 ring-brand-primary/30">
              <Leaf size={16} strokeWidth={2.5} aria-hidden="true" />
            </span>
            {isCanonicalBrand ? (
              <span>
                orderweed<span className="text-brand-primary-text">dc</span>
              </span>
            ) : (
              <span>{displayName}</span>
            )}
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-1 text-sm font-medium"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-brand-muted transition-colors hover:bg-brand-raised hover:text-brand-text"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-[11px] font-semibold text-brand-muted">
              <ShieldCheck size={13} className="text-brand-primary-text" aria-hidden="true" />
              Evidence-labeled data
            </span>
            <Link
              href={canonicalBusiness}
              className="hidden sm:inline-flex rounded-lg bg-brand-primary-fill-strong px-4 py-2 text-xs font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Business Portal
            </Link>
            <MobileNav
              links={[
                ...NAV_LINKS,
                { href: canonicalBusiness, label: 'Business Portal' },
              ]}
            />
          </div>
        </div>
      </header>

      {demonstrationCount > 0 && (
        <aside className="border-b border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-center text-xs font-semibold text-violet-800">
          Demonstration environment: visible businesses, coordinates, license fields, menus, prices, deals, articles, and rewards are synthetic unless a record explicitly says otherwise.
        </aside>
      )}

      {/* Dynamic Route Viewport */}
      <main className="flex-grow flex flex-col bg-brand-background text-brand-text">
        {children}
      </main>

      {/* Network Ownership Disclosure Footer */}
      <footer className="border-t border-brand-border bg-brand-surface mt-auto">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <p className="flex items-center gap-2 font-display text-lg font-bold text-brand-text">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-primary/15 text-brand-primary-text">
                  <Leaf size={14} strokeWidth={2.5} aria-hidden="true" />
                </span>
                {isCanonicalBrand ? (
                  <span>
                    orderweed<span className="text-brand-primary-text">dc</span>
                  </span>
                ) : (
                  displayName
                )}
              </p>
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-brand-muted">
                {PUBLIC_PRODUCT_DESCRIPTION} Every public record carries an
                explicit source, verification state, and freshness window.
              </p>
              <p className="mt-4 inline-flex items-center rounded-full border border-orange-500/35 bg-orange-500/10 px-3 py-1 text-[11px] font-bold text-orange-800">
                21+ Only
              </p>
            </div>
            <nav aria-label="Explore">
              <p className="kicker mb-3">Explore</p>
              <ul className="space-y-2 text-sm text-brand-muted">
                <li><Link href="/" className="transition-colors hover:text-brand-primary-text">Retailer directory</Link></li>
                <li><Link href="/products" className="transition-colors hover:text-brand-primary-text">Products</Link></li>
                <li><Link href="/deals" className="transition-colors hover:text-brand-primary-text">Verified deals</Link></li>
                <li><Link href="/neighborhoods" className="transition-colors hover:text-brand-primary-text">Neighborhoods</Link></li>
                <li><Link href="/education" className="transition-colors hover:text-brand-primary-text">Education hub</Link></li>
                <li><Link href="/compare" className="transition-colors hover:text-brand-primary-text">Compare records</Link></li>
              </ul>
            </nav>
            <nav aria-label="For business">
              <p className="kicker mb-3">For business</p>
              <ul className="space-y-2 text-sm text-brand-muted">
                <li><Link href="/pricing" className="transition-colors hover:text-brand-primary-text">Published pricing</Link></li>
                <li><Link href="/business/claim" className="transition-colors hover:text-brand-primary-text">Claim your listing</Link></li>
                <li><Link href={canonicalBusiness} className="transition-colors hover:text-brand-primary-text">Business portal</Link></li>
                <li><Link href={canonicalAdmin} className="transition-colors hover:text-brand-primary-text">Admin portal</Link></li>
              </ul>
            </nav>
            <nav aria-label="Trust and legal">
              <p className="kicker mb-3">Trust &amp; legal</p>
              <ul className="space-y-2 text-sm text-brand-muted">
                <li><Link href="/legal" className="transition-colors hover:text-brand-primary-text">Legal &amp; compliance</Link></li>
                <li><Link href="/help" className="transition-colors hover:text-brand-primary-text">Help &amp; data policy</Link></li>
                <li><Link href="/education" className="transition-colors hover:text-brand-primary-text">D.C. cannabis rules</Link></li>
              </ul>
            </nav>
          </div>
          <div className="mt-10 border-t border-brand-border pt-6 text-center">
            <p className="text-xs text-brand-muted">
              © {new Date().getFullYear()} {displayName}. All rights reserved.
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-relaxed text-brand-muted/80">
              Disclosure: {displayName} is an evidence-aware directory.
              Check each record&apos;s data-status label and primary source before
              relying on it. This platform does not fulfill, deliver, or sell
              controlled substances directly. Cannabis is for adults 21+ (or
              registered patients). Consume responsibly and never drive
              impaired.
            </p>
          </div>
        </div>
      </footer>
      <CartDrawer />
    </div>
  );
}
