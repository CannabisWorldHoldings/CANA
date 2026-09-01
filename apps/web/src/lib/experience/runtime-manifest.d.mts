export type RuntimeExperienceJourney = 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES';

export type RuntimeExperienceManifest = {
  manifestVersion: 1;
  merchant: { identity: { tenant: string }; journey: RuntimeExperienceJourney };
  promotion?: { receiptDigest: string; candidateDigest: string; evidenceRealm: string } | null;
  presentation: {
    journey: RuntimeExperienceJourney;
    copy: {
      eyebrow: string;
      title: string;
      description: string;
      action: string;
      placeholder: string;
    };
    assets: { hero: string; storefront: string; delivery: string; dc: string };
    moduleOrder: string[];
    density: 'comfortable' | 'compact';
  };
  contract: { accessibility: object };
  economics: { state: 'UNKNOWN' };
};

export declare function resolveRuntimeExperienceManifest(options: {
  recordStore: Pick<PrismaClient['canaIntelligenceRecord'], 'findFirst'>;
  receiptStore?: Pick<PrismaClient['canaEvidenceReceipt'], 'findUnique'>;
  tenant: string;
  journey: RuntimeExperienceJourney;
}): Promise<RuntimeExperienceManifest>;
import type { PrismaClient } from '@prisma/client';
