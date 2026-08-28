export type RealityEvidenceRealm = 'VERIFIED_REAL' | 'SIMULATED' | 'FIXTURE';
export type ExperimentArm = 'CONTROL' | 'TREATMENT';
export type CausalClassification =
  | 'CAUSAL_SUPPORTED'
  | 'ASSOCIATIONAL_ONLY'
  | 'NULL'
  | 'INCONCLUSIVE'
  | 'HARM'
  | 'INVALID_EXPERIMENT';

export interface RealityMetric {
  readonly id: string;
  readonly type: 'BINARY' | 'NUMERIC';
  readonly description?: string;
}

export interface RealityExperienceDefinition {
  readonly candidateDigest: string;
  readonly experienceVersion: string;
  readonly description: string;
}

export interface GoodhartFailureMode {
  readonly description: string;
  readonly guardrailIds: readonly string[];
}

export interface RealityCellPreregistration {
  readonly contractVersion: 'cana.reality-cell-preregistration/1.0.0';
  readonly experimentId: string;
  readonly merchantId: string;
  readonly tenantId: string;
  readonly hypothesis: string;
  readonly experimentalUnit: string;
  readonly eligibilityCriteria: Readonly<Record<string, unknown>>;
  readonly assignmentMethod: 'RANDOMIZED' | 'QUASI_EXPERIMENTAL' | 'OBSERVATIONAL';
  readonly allocation: Readonly<{ control: number; treatment: number }>;
  readonly assignmentSaltCommitment: string;
  readonly controlDefinition: Readonly<RealityExperienceDefinition>;
  readonly treatmentDefinition: Readonly<RealityExperienceDefinition>;
  readonly baseline: Readonly<Record<string, unknown>>;
  readonly exposureDefinition: Readonly<Record<string, unknown>>;
  readonly primaryMetric: Readonly<RealityMetric>;
  readonly secondaryMetrics: readonly Readonly<RealityMetric>[];
  readonly guardrails: readonly Readonly<Record<string, unknown>>[];
  readonly minimumSample: Readonly<{ perArm: number }>;
  readonly analysisMethod: 'TWO_PROPORTION_Z';
  readonly confidencePolicy: Readonly<{ alpha: number; confidence: number }>;
  readonly interferenceAssumptions: Readonly<Record<string, unknown>>;
  readonly stopConditions: readonly Readonly<Record<string, unknown>>[];
  readonly harmConditions: readonly Readonly<Record<string, unknown>>[];
  readonly maximumClaimCeiling: 'ACTIVITY' | 'ASSOCIATION' | 'CAUSAL_EFFECT' | 'ECONOMIC_EFFECT';
  readonly rollbackContract: Readonly<{ digest: string; [key: string]: unknown }>;
  readonly ownerAuthorityRequirement: Readonly<Record<string, unknown>>;
  readonly merchantAuthorityRequirement: Readonly<Record<string, unknown>>;
  readonly observationWindow: Readonly<{ startsAt: string; endsAt: string }>;
  readonly goodhartAnalysis: Readonly<{
    question: string;
    failureModes: readonly Readonly<GoodhartFailureMode>[];
  }>;
  readonly evidenceRealm: RealityEvidenceRealm;
  readonly preregisteredAt: string;
  readonly preregistrationDigest: string;
}

export interface AssignmentReceiptPayload {
  readonly experimentId: string;
  readonly preregistrationDigest: string;
  readonly unitHash: string;
  readonly arm: ExperimentArm;
  readonly assignmentMethod: string;
  readonly assignmentToken: string;
  readonly assignmentDigest: string;
  readonly assignedAt: string;
}

export interface ExposureReceiptPayload {
  readonly assignmentReceiptDigest: string;
  readonly experimentId: string;
  readonly unitHash: string;
  readonly assignedArm: ExperimentArm;
  readonly actualExperienceVersion: string;
  readonly candidateDigest: string;
  readonly routeSurface: string;
  readonly observedAt: string;
  readonly independentObserverSource: string;
  readonly evidenceRealm: RealityEvidenceRealm;
}

export interface OutcomeReceiptPayload {
  readonly experimentId: string;
  readonly assignmentReceiptDigest: string;
  readonly exposureReceiptDigest: string;
  readonly unitHash: string;
  readonly metric: string;
  readonly observedValue: number | boolean;
  readonly observedAt: string;
  readonly source: string;
  readonly evidenceRealm: RealityEvidenceRealm;
}
