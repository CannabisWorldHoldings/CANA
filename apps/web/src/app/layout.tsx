import './globals.css';
import {
  PUBLIC_PRODUCT_DESCRIPTION,
  PUBLIC_PRODUCT_NAME,
} from '@/lib/product-brand';
import { resolveReleaseIdentity } from './api/release/release-identity.mjs';

/**
 * TREATMENT IDENTITY ON THE RENDERED SURFACE (provenance court, Track B).
 * The deployed SHA — resolved from the same build-time artifact as
 * /api/release, never from git or env — is stamped into every rendered page
 * so an EXTERNAL observer can verify that the surface it received was
 * rendered by the release it was told about. Absence is a state: when the
 * identity is missing/invalid the meta tag is omitted entirely, and the
 * provenance court reads that omission as RED. Never fabricated.
 */
function releaseShaMeta() {
  const identity = resolveReleaseIdentity({});
  if (identity.state !== 'RELEASE_SHA_PRESENT' || !identity.gitSha) return null;
  return <meta name="cana-release-sha" content={identity.gitSha} />;
}

export const metadata = {
  title: PUBLIC_PRODUCT_NAME,
  description: PUBLIC_PRODUCT_DESCRIPTION,
  icons: {
    icon: [
      { url: '/favicon-glossy-ow-13fd3ae2e4ca.ico', type: 'image/x-icon' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon-glossy-ow-13fd3ae2e4ca.ico',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-brand-background text-brand-text min-h-screen flex flex-col font-sans antialiased">
        {/* React 19 hoists these into <head>. Fonts are self-hosted latin
            subsets so the strict CSP holds and builds stay deterministic. */}
        {releaseShaMeta()}
        <link
          rel="preload"
          href="/fonts/geist-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/geist-mono-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {children}
      </body>
    </html>
  );
}
