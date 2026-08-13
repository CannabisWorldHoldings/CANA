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
import { Leaf, LifeBuoy, MapPin, ShieldCheck } from 'lucide-react';

const NAV_LINKS = [
  { href: '/dispensaries', label: 'Dispensaries' },
  { href: '/delivery', label: 'Delivery' },
  { href: '/search', label: 'Search' },
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

      {isCanonicalBrand && (
        <aside className="operator-strip border-b border-brand-border px-4 py-2 text-center text-[11px] font-semibold">
          D.C. operators: publish evidence, claim your listing, and reach
          ready-to-shop visitors.
          <Link
            href="/pricing"
            className="ml-2 font-bold text-brand-primary-text hover:underline"
          >
            See published pricing →
          </Link>
        </aside>
      )}

      {/* Brand Header Nav */}
      <header className="sticky top-0 z-50 border-b border-brand-border bg-brand-background/90 backdrop-blur-xl">
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
            <span className="hidden shrink-0 items-center gap-2 rounded-full border border-brand-border bg-brand-surface px-3 py-2 text-xs font-semibold text-brand-text xl:inline-flex">
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
                className="rounded-lg px-3 py-2 text-brand-muted transition-colors hover:bg-brand-raised hover:text-brand-text"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-[11px] font-semibold text-brand-muted 2xl:inline-flex">
              <ShieldCheck size={13} className="text-brand-primary-text" aria-hidden="true" />
              Evidence labeled
            </span>
            <Link
              href="/help"
              aria-label="Open help center"
              title="Help center"
              className="hidden h-10 w-10 items-center justify-center rounded-lg border border-brand-border bg-brand-surface text-brand-muted transition-colors hover:border-brand-primary/40 hover:text-brand-text md:inline-flex"
            >
              <LifeBuoy size={16} aria-hidden="true" />
            </Link>
            {isCanonicalBrand && <DaypartThemeControl />}
            <Link
              href="/customer/login"
              className="hidden rounded-lg border border-brand-border bg-brand-surface px-4 py-2.5 text-xs font-bold text-brand-text transition-colors hover:border-brand-primary/40 sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              href="/business/claim"
              className="hidden rounded-lg bg-brand-primary-fill-strong px-4 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5 xl:inline-flex"
            >
              List your business
            </Link>
            <MobileNav
              links={[
                ...NAV_LINKS,
                { href: '/customer/login', label: 'Customer login' },
                { href: '/business/claim', label: 'List your business' },
                { href: canonicalBusiness, label: 'Business portal' },
              ]}
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
                <li><Link href="/legal" className="transition-colors hover:text-brand-primary-text">Legal &amp; compliance</Link></li>
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
