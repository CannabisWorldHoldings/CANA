import type { NextConfig } from "next";
import path from "node:path";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { tenantRewriteRules } from "./src/lib/tenant-rewrite.mjs";

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "X-Permitted-Cross-Domain-Policies",
    value: "none",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
];

const privateSurfaceHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive",
  },
];

/**
 * RELEASE IDENTITY, CAPTURED AT BUILD TIME.
 *
 * A deployed artifact has no .git directory, so resolving this at runtime works in
 * development and silently reports nothing in production — the worst combination,
 * because it looks correct everywhere it is tested. It is captured here instead, at
 * the one moment the source and the build are provably the same thing.
 *
 * If no SHA is supplied the value is left ABSENT rather than defaulted. The endpoint
 * that reads it reports UNKNOWN explicitly. A fabricated identity would turn an
 * operator's question into a confident wrong answer, and this project has already
 * been misled twice by builds that were not the code under test.
 */
const releaseSha =
  process.env.CANA_RELEASE_SHA
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.GIT_COMMIT
  ?? process.env.SOURCE_COMMIT;

const nextConfig: NextConfig = {
  env: {
    // Deliberately NOT NEXT_PUBLIC_: the release identity is served by an endpoint,
    // not embedded in every client bundle. Shipping build metadata to browsers is
    // free reconnaissance for no product benefit.
    ...(releaseSha ? { CANA_RELEASE_SHA: releaseSha } : {}),
  },
  poweredByHeader: false,
  // Deployment gate: standalone output is only enabled for artifact builds
  // (Namecheap/cPanel Passenger). Local `next start` and the HTTP test
  // battery keep the default server, so no test behavior changes.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" as const }
    : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "32kb",
    },
  },
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  // Webpack standalone builds (the Namecheap artifact path) need the same
  // monorepo root for file tracing that turbopack.root provides in dev.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  async rewrites() {
    return tenantRewriteRules().map((rewrite) => ({
      ...rewrite,
      has: rewrite.has.map(({ value }) => ({ type: "host" as const, value })),
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...["/admin/:path*", "/business/:path*", "/customer/:path*", "/wallet/:path*"].map(
        (source) => ({
          source,
          headers: privateSurfaceHeaders,
        }),
      ),
    ];
  },
};

async function assertProductionBuildDatabaseReady() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Production build requires an explicit DATABASE_URL");
  }

  const [{ PrismaClient }, databaseConfig] = await Promise.all([
    import("@prisma/client"),
    import("./src/lib/db-config.mjs"),
  ]);
  const provider = databaseConfig.databaseProviderOf(databaseUrl);
  if (provider !== "sqlite") {
    throw new Error(`Production build database provider must match the current sqlite schema; received ${provider}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const initialized = await databaseConfig.initializeDatabaseConfig(prisma);
    if (!initialized.ok) {
      throw new Error(`Production build database initialization failed: ${JSON.stringify(initialized)}`);
    }
    const readiness = await databaseConfig.databaseReadiness(prisma, { provider });
    if (!readiness.ready) {
      throw new Error(`Production build database is not ready: ${JSON.stringify(readiness.checks)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_PRODUCTION_BUILD) {
    await assertProductionBuildDatabaseReady();
  }
  return nextConfig;
}
