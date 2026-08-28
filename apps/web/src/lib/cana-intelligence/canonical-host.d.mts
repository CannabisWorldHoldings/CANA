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
  persistLesson: (lesson: unknown) => Promise<string>;
  persistPrediction: (prediction: unknown) => Promise<string>;
  persistExperiment: (experiment: unknown) => Promise<string>;
  loadReceipt: (receiptDigest: string) => Promise<unknown>;
  loadLesson: (lessonId: string) => Promise<unknown>;
  loadExperimentLedger: (experimentId: string) => Promise<unknown>;
  loadExperiment: (experimentId: string) => Promise<unknown>;
  resolveVerifiedPrincipalReceipt: () => Promise<string>;
  persistPromotionReceipt: (payload: unknown) => Promise<unknown>;
  claimPromotionExecution: (payload: unknown) => Promise<boolean>;
  enumerateExperienceSurfaces: (...args: unknown[]) => unknown;
  loadExperienceManifest: (...args: unknown[]) => unknown;
  persistExperienceCandidate: (...args: unknown[]) => unknown;
  renderPrivatePreview: (...args: unknown[]) => unknown;
  captureRenderedEvidenceReceipt: (...args: unknown[]) => unknown;
  generateMediaCandidate: (...args: unknown[]) => unknown;
  executeAuthorizedExperienceCandidate: (...args: unknown[]) => unknown;
  rollbackExperienceVersion: (...args: unknown[]) => unknown;
}>;

export declare function createCanonicalWeldHost(options: {
  prisma: PrismaClient;
  assertAdmin: () => Promise<{ userId: string; role: string }>;
  tenant: string;
  appendCanonicalObservation?: ((observation: unknown) => Promise<unknown>) | null;
  experience?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
}): CanonicalWeldHost;
