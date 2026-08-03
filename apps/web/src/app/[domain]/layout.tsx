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
  PUBLIC_SUPPORT_EMAIL,
} from '@/lib/product-brand';
import {
  jsonLdScriptProps,
  organizationJsonLd,
  webSiteJsonLd,
} from '@/lib/structured-data.mjs';
import CartDrawer from '@/components/cart-drawer';
import AgeGate from '@/components/age-gate';
import MobileNav from '@/components/mobile-nav';
import BrandWordmark from '@/components/brand-wordmark';
import { Leaf, MapPin, Search } from 'lucide-react';

const NAV_LINKS = [
  { href: '/dispensaries', label: 'Dispensaries' },
  { href: '/delivery', label: 'Delivery' },
  { href: '/products', label: 'Products' },
  { href: '/deals', label: 'Deals' },
  { href: '/neighborhoods', label: 'Neighborhoods' },
  { href: '/education', label: 'Learn' },
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
  const canonicalBusiness = await canonicalPlatformUrl('/business/login');
  const brand = await prisma.brand.findUnique({
    where: { domain },
  });
  const isCanonicalBrand = domain === CANONICAL_TENANT_DOMAIN;
  const displayName = isCanonicalBrand
    ? PUBLIC_PRODUCT_NAME
    : brand?.name || PUBLIC_PRODUCT_NAME;

  const theme = buildTenantTheme(brand);
  const themeStyle = {
    '--brand-primary': isCanonicalBrand
      ? 'var(--canonical-primary)'
      : theme.primary,
    '--brand-secondary': isCanonicalBrand
      ? 'var(--canonical-secondary)'
      : theme.secondary,
    '--brand-background': isCanonicalBrand
      ? 'var(--canonical-background)'
      : theme.background,
    '--brand-surface': isCanonicalBrand
      ? 'var(--canonical-surface)'
      : theme.surface,
    '--brand-raised': isCanonicalBrand
      ? 'var(--canonical-raised)'
      : PLATFORM_TONES.raised,
    '--brand-border': isCanonicalBrand
      ? 'var(--canonical-border)'
      : PLATFORM_TONES.border,
    '--brand-muted': isCanonicalBrand
      ? 'var(--canonical-muted)'
      : PLATFORM_TONES.muted,
    '--brand-gold': isCanonicalBrand
      ? 'var(--canonical-gold)'
      : PLATFORM_TONES.gold,
    '--brand-text': isCanonicalBrand ? 'var(--canonical-text)' : theme.text,
  } as CSSProperties;

  const siteOrigin = origin.origin;

  return (
    <div
      className={`tenant-shell flex min-h-screen flex-col ${
        isCanonicalBrand ? 'canonical-tenant-shell' : ''
      }`}
      style={themeStyle}
    >
      {isCanonicalBrand && (
        <>
          <script {...jsonLdScriptProps(organizationJsonLd({ origin: siteOrigin }))} />
          <script {...jsonLdScriptProps(webSiteJsonLd({ origin: siteOrigin }))} />
        </>
      )}

      <AgeGate
        displayName={displayName}
        isCanonicalBrand={isCanonicalBrand}
      />

      {/* Brand Header Nav */}
      <header className="sticky top-0 z-50 bg-white">
        <div className="relative mx-auto flex h-20 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <Link
            href="/"
            aria-label={`${displayName} home`}
            className="flex shrink-0 items-center gap-2.5 text-xl font-bold tracking-[-0.04em] text-brand-text font-display"
          >
            {isCanonicalBrand ? (
              <>
                <BrandWordmark className="w-40 sm:w-52" priority />
                <span className="sr-only">{displayName}</span>
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary/15 text-brand-primary-text ring-1 ring-brand-primary/30">
                  <Leaf size={16} strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span>{displayName}</span>
              </>
            )}
          </Link>

          {isCanonicalBrand && (
            <span className="hidden shrink-0 items-center gap-2 px-2 py-2 text-xs font-semibold text-brand-text xl:inline-flex">
              <MapPin
                size={14}
                className="text-brand-primary-text"
                aria-hidden="true"
              />
              Washington, D.C.
            </span>
          )}

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-0.5 text-sm font-medium lg:flex"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-brand-muted transition-colors hover:text-[#0b5b35]"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/#search"
              aria-label="Search the marketplace"
              title="Search"
              className="hidden h-10 w-10 items-center justify-center rounded-lg text-brand-muted transition-colors hover:text-[#0b5b35] md:inline-flex"
            >
              <Search size={18} aria-hidden="true" />
            </Link>
            <Link
              href="/customer/login"
              className="hidden min-h-11 items-center rounded-lg bg-[#11643d] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#0c4f30] sm:inline-flex"
            >
              Customer Sign In
            </Link>
            <Link
              href="/business/claim"
              className="hidden min-h-11 items-center px-2 py-2.5 text-xs font-semibold text-[#5d6860] hover:text-[#0b5b35] xl:inline-flex"
            >
              For Businesses
            </Link>
            <MobileNav
              links={[
                ...NAV_LINKS,
                { href: '/search', label: 'Search' },
                { href: '/customer/login', label: 'Customer Sign In' },
                { href: '/business/claim', label: 'For Businesses' },
                { href: canonicalBusiness, label: 'Business Sign In' },
              ]}
            />
          </div>
        </div>
      </header>

      {/* Dynamic Route Viewport */}
      <main className="flex flex-grow flex-col bg-white text-brand-text">
        {children}
      </main>

      {/* Network Ownership Disclosure Footer */}
      <footer className="mt-auto bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-2">
              <div className="flex items-center gap-2 font-display text-lg font-bold text-brand-text">
                {isCanonicalBrand ? (
                  <>
                    <BrandWordmark className="w-44" />
                    <span className="sr-only">{displayName}</span>
                  </>
                ) : (
                  <>
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-primary/15 text-brand-primary-text">
                      <Leaf size={14} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    {displayName}
                  </>
                )}
              </div>
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
                <li><Link href="/dispensaries" className="transition-colors hover:text-brand-primary-text">Dispensaries</Link></li>
                <li><Link href="/delivery" className="transition-colors hover:text-brand-primary-text">Delivery</Link></li>
                <li><Link href="/products" className="transition-colors hover:text-brand-primary-text">Products</Link></li>
                <li><Link href="/deals" className="transition-colors hover:text-brand-primary-text">Current deals</Link></li>
                <li><Link href="/neighborhoods" className="transition-colors hover:text-brand-primary-text">Neighborhoods</Link></li>
                <li><Link href="/education" className="transition-colors hover:text-brand-primary-text">Learn</Link></li>
              </ul>
            </nav>
            <nav aria-label="For business">
              <p className="kicker mb-3">For business</p>
              <ul className="space-y-2 text-sm text-brand-muted">
                <li><Link href="/pricing" className="transition-colors hover:text-brand-primary-text">Published pricing</Link></li>
                <li><Link href="/business/claim" className="transition-colors hover:text-brand-primary-text">Claim your listing</Link></li>
                <li><Link href={canonicalBusiness} className="transition-colors hover:text-brand-primary-text">Business Sign In</Link></li>
              </ul>
            </nav>
            <nav aria-label="Trust and legal">
              <p className="kicker mb-3">Support &amp; trust</p>
              <ul className="space-y-2 text-sm text-brand-muted">
                <li>
                  <a
                    href={`mailto:${PUBLIC_SUPPORT_EMAIL}?subject=ORDERWEEDDC%20support`}
                    className="transition-colors hover:text-brand-primary-text"
                  >
                    Email support
                  </a>
                </li>
                <li><Link href="/help" className="transition-colors hover:text-brand-primary-text">Help center &amp; FAQ</Link></li>
                <li><Link href="/legal" className="transition-colors hover:text-brand-primary-text">Legal &amp; compliance</Link></li>
                <li><Link href="/education" className="transition-colors hover:text-brand-primary-text">D.C. cannabis rules</Link></li>
              </ul>
            </nav>
          </div>
          <div className="mt-12 pt-6 text-center">
            <p className="text-xs text-brand-muted">
              © {new Date().getFullYear()} {displayName}. All rights reserved.
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-brand-muted">
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
