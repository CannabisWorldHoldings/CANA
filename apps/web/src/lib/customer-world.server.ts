import { prisma } from '@/lib/prisma';
import { resolveCustomerMerchant, resolveCustomerWorld } from '@/lib/customer-world.mjs';

export async function loadCustomerWorld(options: {
  journey: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES';
  market?: string | string[];
  query?: string | string[];
  view?: string | string[];
  tenantDomain: string;
  now?: Date;
}) {
  const brand = await prisma.brand.findUnique({
    where: { domain: options.tenantDomain },
    select: { name: true },
  });
  if (!brand) return null;
  const world = await resolveCustomerWorld(prisma, options);
  return { brand, world };
}

export async function loadCustomerMerchantProfile(options: {
  merchantId: string;
  market?: string | string[];
  query?: string | string[];
  tenantDomain: string;
  now?: Date;
}) {
  const brand = await prisma.brand.findUnique({
    where: { domain: options.tenantDomain },
    select: { name: true },
  });
  if (!brand) return null;
  const profile = await resolveCustomerMerchant(prisma, options);
  return profile ? { brand, profile } : null;
}
