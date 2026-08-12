import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  isStaticAssetPath,
  parseAllowedRequestHost,
} from '@/lib/host-policy.mjs';
import { isCanonicalPlatformHostname } from '@/lib/tenant-host.mjs';
import {
  isExplicitRequestHost,
  tenantRedirectPath,
} from '@/lib/tenant-rewrite.mjs';

const NON_INDEXABLE_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function closedHostResponse(title: string, message: string) {
  return new NextResponse(
    `<!doctype html>
     <html lang="en">
       <head>
         <meta charset="utf-8">
         <meta name="robots" content="noindex, nofollow, noarchive">
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <title>${title}</title>
       </head>
       <body style="font-family:sans-serif;background:#0B0F12;color:#E2E8F0;text-align:center;padding:10%">
         <main><h1>${title}</h1><p>${message}</p></main>
       </body>
     </html>`,
    {
      status: 403,
      headers: {
        ...NON_INDEXABLE_RESPONSE_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  );
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostnameHeader = request.headers.get('host');

  const requestHost = parseAllowedRequestHost(hostnameHeader);
  if (!requestHost) {
    return new NextResponse('The requested host is not configured.', {
      status: 421,
      headers: {
        ...NON_INDEXABLE_RESPONSE_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
  const { hostname: host, port } = requestHost;

  // Canonical-host consolidation: www permanently redirects to the apex,
  // preserving path and query, so exactly one public origin exists.
  if (host === 'www.orderweeddc.com') {
    const canonicalUrl = new URL(url.pathname + url.search, 'https://orderweeddc.com');
    return NextResponse.redirect(canonicalUrl, 308);
  }

  // Exclude internal Next.js files and public assets from tenant routing.
  if (
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/assets') ||
    url.pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 1. Gated & Parked domains handling
  if (host === 'districtweed.com' || host === 'districtweed.localhost') {
    return closedHostResponse(
      'Access Gated',
      'districtweed.com is parked pending brand clearance.',
    );
  }

  if (host === 'weeddmv.com' || host === 'weeddmv.localhost') {
    return closedHostResponse(
      'Access Isolated',
      'weeddmv.com is isolated pending infrastructure and reputation clearance.',
    );
  }

  // Passthrough API routes and genuine static assets only. A path is a
  // static asset only when its final segment ends in a known file
  // extension — NOT merely because it contains a dot. This prevents a
  // hostname-shaped path (e.g. "/wellness.localhost") from bypassing
  // tenant routing and addressing the [domain] route directly.
  if (url.pathname.startsWith('/api') || isStaticAssetPath(url.pathname)) {
    return NextResponse.next();
  }

  if (
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/business')
  ) {
    if (!isCanonicalPlatformHostname(host)) {
      return new NextResponse(
        'The requested administrative surface is not configured for this host.',
        {
          status: 421,
          headers: {
            ...NON_INDEXABLE_RESPONSE_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        },
      );
    }
    return NextResponse.next();
  }

  const redirectPath = tenantRedirectPath(host);
  if (redirectPath) {
    const targetBase = host.endsWith('.localhost')
      ? `http://orderweeddc.localhost${port ? `:${port}` : ''}`
      : 'https://orderweeddc.com';
    return NextResponse.redirect(new URL(`${targetBase}${redirectPath}`));
  }

  if (!isExplicitRequestHost(host)) {
    url.pathname = `/orderweeddc.localhost${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

// Config to limit where the middleware runs
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|assets|favicon.ico).*)',
  ],
};
