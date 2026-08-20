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
import DaypartThemeControl from '@/components/daypart-theme-control';
import { CircleUserRound, Leaf, MapPin, Search } from 'lucide-react';

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
          'Local cannabis discovery backed by named sources, with unknowns labeled honestly.',
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

      {/* Customer chrome — one quiet 48px row (approved header contract). */}
      <header className="sticky top-0 z-50 border-b border-[color:var(--owd-hairline)] bg-brand-background/80 [backdrop-filter:saturate(180%)_blur(20px)] [-webkit-backdrop-filter:saturate(180%)_blur(20px)]">
        <div className="mx-auto flex h-12 max-w-[1680px] items-center justify-between gap-4 px-5 sm:px-6">
          <Link
            href="/"
            aria-label={`${displayName} home`}
            className="flex h-11 shrink-0 items-center gap-2 text-brand-text"
          >
            {isCanonicalBrand ? (
              <>
                <BrandWordmark className="w-28" priority />
                <span className="sr-only">{displayName}</span>
              </>
            ) : (
              <>
                <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-brand-primary/15 text-brand-primary-text">
                  <Leaf size={14} strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="text-[15px] font-semibold tracking-[-0.02em]">{displayName}</span>
              </>
            )}
          </Link>

          <nav
            aria-label="Primary navigation"
            className="owd-nav hidden items-center gap-6 min-[834px]:flex"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-brand-muted transition-colors hover:text-brand-text"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-0.5">
            <Link
              href="/search"
              aria-label="Search"
              title="Search"
              className="flex h-11 w-11 items-center justify-center rounded-full text-brand-muted transition-colors hover:text-brand-text"
            >
              <Search size={17} aria-hidden="true" />
            </Link>
            {isCanonicalBrand && (
              <span
                className="hidden h-7 shrink-0 items-center gap-1 rounded-full bg-brand-raised px-2.5 text-[12px] font-semibold text-brand-muted sm:inline-flex"
                title="Serving Washington, D.C."
              >
                <MapPin size={12} aria-hidden="true" />
                DC
              </span>
            )}
            <Link
              href="/customer/login"
              aria-label="Account"
              title="Account"
              className="hidden h-11 w-11 items-center justify-center rounded-full text-brand-muted transition-colors hover:text-brand-text min-[834px]:flex"
            >
              <CircleUserRound size={17} aria-hidden="true" />
            </Link>
            <Link
              href="/business/claim"
              className="owd-nav hidden whitespace-nowrap pl-3 text-brand-muted transition-colors hover:text-brand-text xl:inline-flex"
            >
              List your business
            </Link>
            <MobileNav
              links={NAV_LINKS}
              secondaryLinks={[
                { href: '/customer/login', label: 'Log in' },
                { href: '/business/claim', label: 'List your business' },
                { href: canonicalBusiness, label: 'Business portal' },
              ]}
              utility={isCanonicalBrand ? <DaypartThemeControl /> : undefined}
            />
          </div>
        </div>
      </header>

      {demonstrationCount > 0 && (
        <aside className="demonstration-banner border-b px-4 py-2.5 text-center text-xs font-semibold">
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
                    <li><Link href="/search" className="transition-colors hover:text-brand-primary-text">Verified search</Link></li>
                    <li><Link href="/delivery" className="transition-colors hover:text-brand-primary-text">Delivery discovery</Link></li>
                    <li><Link href="/dispensaries" className="transition-colors hover:text-brand-primary-text">Dispensary discovery</Link></li>
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
                <li><Link href="/help" className="transition-colors hover:text-brand-primary-text">How verification works</Link></li>
                <li><Link href="/legal" className="transition-colors hover:text-brand-primary-text">Legal &amp; compliance</Link></li>
                <li><Link href="/education" className="transition-colors hover:text-brand-primary-text">D.C. cannabis rules</Link></li>
              </ul>
            </nav>
          </div>
          <div className="mt-10 flex flex-col items-center gap-4 border-t border-brand-border pt-6 text-center">
            {isCanonicalBrand && <DaypartThemeControl />}
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
      {!isCanonicalBrand && <CartDrawer />}
    </div>
  );
}
