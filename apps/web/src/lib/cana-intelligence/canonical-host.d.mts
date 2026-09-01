import type { PrismaClient } from '@prisma/client';

export type CanonicalWeldPrincipal = Readonly<{
  verified: true;
  subject: string;
  allowedActions: readonly string[];
  verifiedBy: 'canonical-assertAdmin';
}>;

export type CanonicalWeldHost = Readonly<{
  loadObservations: () => Promise<readonly unknown[]>;
  appendObservation: (observation: unknown) => Promise<unknown>;
  loadIntentEvents: () => Promise<readonly unknown[]>;
  loadVerifiedSupply: () => Promise<readonly unknown[]>;
  resolveVerifiedPrincipal: () => Promise<CanonicalWeldPrincipal>;
  persistReceipt: (receipt: unknown) => Promise<string>;
  admitEconomicObservation: (observation: unknown) => Promise<string>;
  settleLegacyValueReceipt: (settlement: unknown, economics?: unknown) => Promise<unknown>;
  settleRealityCellValueReceipt: (settlement: unknown, intervention: unknown, economicObservationReceiptDigests?: readonly string[]) => Promise<unknown>;
  persistLesson: (lesson: unknown) => Promise<string>;
  persistPrediction: (prediction: unknown) => Promise<string>;
  persistExperiment: (experiment: unknown) => Promise<string>;
  loadReceipt: (receiptDigest: string) => Promise<unknown>;
  loadLesson: (lessonId: string) => Promise<unknown>;
  loadExperimentLedger: (experimentId: string) => Promise<unknown>;
  loadExperiment: (experimentId: string) => Promise<unknown>;
  settleLegacyExperiment: (experimentId: string, principalReceiptDigest: string) => Promise<unknown>;
  resolveVerifiedPrincipalReceipt: () => Promise<string>;
  persistPromotionReceipt: (payload: unknown) => Promise<unknown>;
  executeWithPromotionClaim: (payload: unknown) => Promise<unknown>;
  enumerateExperienceSurfaces: () => Promise<readonly unknown[]>;
  loadExperienceManifest: (...args: unknown[]) => Promise<unknown>;
  persistExperienceCandidate: (...args: unknown[]) => Promise<unknown>;
  renderPrivatePreview: (...args: unknown[]) => unknown;
  captureRenderedEvidenceReceipt: (...args: unknown[]) => unknown;
  generateMediaCandidate: (...args: unknown[]) => unknown;
  rollbackExperienceVersion: (...args: unknown[]) => unknown;
}>;

export declare function createCanonicalWeldHost(options: {
  prisma: PrismaClient;
  assertAdmin: () => Promise<{ userId: string; role: string }>;
  tenant: string;
  appendCanonicalObservation?: ((observation: unknown) => Promise<unknown>) | null;
  admitCanonicalEconomicObservation?: ((input: unknown) => Promise<unknown>) | null;
  experience?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
}): CanonicalWeldHost;
