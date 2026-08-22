import { prisma } from '@/lib/prisma';
import { resolveCustomerMerchant, resolveCustomerWorld } from '@/lib/customer-world.mjs';
import { recordAskWork } from '@/lib/ask/ask-work.mjs';

type CustomerAskDimension<T> =
  | { status: 'KNOWN'; value: T; matched_token: string }
  | { status: 'UNKNOWN'; value: null; matched_token: null };

type CustomerAskFrontier = {
  schema_version: 'cana-answerability-frontier/v1';
  tenant: string;
  frontier_key: `sha256:${string}`;
  evidence_digest: `sha256:${string}`;
  intent_scope: Partial<{
    location: string;
    category: string;
    price_max_usd: number;
    fulfillment: string;
    open_now: boolean;
  }>;
  required_predicates: readonly string[];
  blocking_predicates: readonly string[];
  stale_predicates: readonly string[];
  contradicted_predicates: readonly string[];
};

export type CustomerAskObservation = {
  answer: {
    market_id: 'US-DC' | 'US-MD' | 'US-VA';
    verified_candidate_count: number;
    zero_verified_result: boolean;
    zero_result_reason:
      | 'REQUIRED_INTENT_DIMENSION_UNKNOWN'
      | 'UNSUPPORTED_VERIFIED_DIMENSION'
      | 'NO_VERIFIED_CURRENT_MATCH'
      | null;
    unsupported_known_dimensions: readonly string[];
    answerability_frontier: CustomerAskFrontier;
    opportunitySpec: {
      kind: 'MARKET_GAP' | 'CAPABILITY_GAP';
      retailerId: null;
      hypothesizedValue: null;
      confidence: null;
      recommendedAction: string;
      requiredAuthority: 'PROPOSE_ONLY';
      risk: string;
      rollback: string;
      measurementPlan: string;
    } | null;
  };
  intent: {
    ir_version: 1;
    compiler: 'deterministic-lexicon-v1';
    dimensions: {
      location: CustomerAskDimension<string>;
      category: CustomerAskDimension<string>;
      price_max_usd: CustomerAskDimension<number>;
      fulfillment: CustomerAskDimension<string>;
      open_now: CustomerAskDimension<boolean>;
    };
    unknown_dimensions: readonly ('location' | 'category' | 'price_max_usd' | 'fulfillment' | 'open_now')[];
  };
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
