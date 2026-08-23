import { prisma } from '@/lib/prisma';
import { resolveCustomerMerchant, resolveCustomerWorld } from '@/lib/customer-world.mjs';
import { recordAskWork } from '@/lib/ask/ask-work.mjs';
import { realityProjectionTenantForRouteDomain } from '@/lib/tenant-host.mjs';

export async function loadCustomerWorld(options: {
  journey: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES';
  market?: string | string[];
  query?: string | string[];
  view?: string | string[];
  tenantDomain: string;
  now?: Date;
}) {
  const realityTenant = realityProjectionTenantForRouteDomain(options.tenantDomain);
  const brand = await prisma.brand.findUnique({
    where: { domain: options.tenantDomain },
    select: { name: true },
  });
  if (!brand) return null;
  const world = await resolveCustomerWorld(prisma, {
    ...options,
    tenantDomain: realityTenant,
    recordAsk: ({ answer, intent }) => recordAskWork(prisma, {
      answer,
      domain: realityTenant,
      intent,
      now: options.now,
    }),
  });
  return { brand, world };
}

export async function loadCustomerMerchantProfile(options: {
  merchantId: string;
  market?: string | string[];
  query?: string | string[];
  tenantDomain: string;
  now?: Date;
}) {
  const realityTenant = realityProjectionTenantForRouteDomain(options.tenantDomain);
  const brand = await prisma.brand.findUnique({
    where: { domain: options.tenantDomain },
    select: { name: true },
  });
  if (!brand) return null;
  const profile = await resolveCustomerMerchant(prisma, {
    ...options,
    tenantDomain: realityTenant,
  });
  return profile ? { brand, profile } : null;
}
