import { prisma } from '@/lib/prisma';
import { resolveCustomerMerchant, resolveCustomerWorld } from '@/lib/customer-world.mjs';
import { recordAskWork } from '@/lib/ask/ask-work.mjs';

type CustomerAskObservation = {
  answer: Record<string, unknown>;
  intent: Record<string, unknown>;
};

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
  const world = await resolveCustomerWorld(prisma, {
    ...options,
    recordAsk: ({ answer, intent }: CustomerAskObservation) => recordAskWork(prisma, {
      answer,
      domain: options.tenantDomain,
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
  const brand = await prisma.brand.findUnique({
    where: { domain: options.tenantDomain },
    select: { name: true },
  });
  if (!brand) return null;
  const profile = await resolveCustomerMerchant(prisma, options);
  return profile ? { brand, profile } : null;
}
