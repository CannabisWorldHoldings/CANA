/**
 * SiteMind Creative Learning Bridge - Core Type Definitions
 * CANA / SiteMind / Hermes / ORDERWEEDDC Governed Learning System
 */

export type RightsState =
  | 'ORDERWEEDDC_OWNED'
  | 'CANA_OWNED'
  | 'OWNER_AUTHORIZED'
  | 'MERCHANT_AUTHORIZED'
  | 'LICENSED'
  | 'PUBLIC_DOMAIN'
  | 'PERMISSIONED_SYNTHETIC'
  | 'REFERENCE_ONLY'
  | 'ANALYSIS_ONLY'
  | 'UNKNOWN_RIGHTS'
  | 'PROHIBITED';

export const TRAINABLE_CORPUS_WHITELIST = Object.freeze(new Set<RightsState>([
  'ORDERWEEDDC_OWNED',
  'CANA_OWNED',
  'OWNER_AUTHORIZED',
  'MERCHANT_AUTHORIZED',
  'LICENSED',
  'PUBLIC_DOMAIN',
  'PERMISSIONED_SYNTHETIC',
]));

export type OwnerDecision =
  | 'APPROVE'
  | 'REJECT'
  | 'APPROVE_WITH_CHANGES'
  | 'PREFER_A_OVER_B'
  | 'PREFER_B_OVER_A'
  | 'SAVE_AS_REFERENCE'
  | 'PROMOTE_TO_BRAND_STANDARD'
  | 'RETIRE'
  | 'SUPERSEDE'
  | 'REQUEST_STRUCTURAL_MUTATION'
  | 'REQUEST_COSMETIC_MUTATION'
  | 'OWNER_APPROVAL_PENDING'
  | 'UNREVIEWED';

export type DecisionAuthority =
  | 'OWNER_EXPLICIT'
  | 'MERCHANT_EXPLICIT'
  | 'SYSTEM_TEST_ONLY'
  | 'AUTOMATED_PRESELECTION';

export type RenderState =
  | 'REAL_PROVIDER_GENERATED_IMAGE'
  | 'LOCALLY_RENDERED_REAL_IMAGE'
  | 'STATIC_REAL_SOURCE_IMAGE'
  | 'PLACEHOLDER_FILE'
  | 'MOCK_PATH_ONLY'
  | 'MISSING';

export type RejectionReason =
  | 'wrong brand'
  | 'weak wordmark'
  | 'poor composition'
  | 'generic'
  | 'too green'
  | 'too dark'
  | 'too sterile'
  | 'cluttered'
  | 'weak hierarchy'
  | 'weak mobile crop'
  | 'poor typography'
  | 'poor product focus'
  | 'low trust'
  | 'low originality'
  | 'competitor similarity'
  | 'unsupported claim'
  | 'wrong audience'
  | 'wrong offer'
  | 'wrong placement'
  | 'rights concern'
  | 'other';

export type PromotionStage =
  | 'RAW_OBSERVATION'
  | 'CANDIDATE_LEARNING'
  | 'OWNER_SUPPORTED'
  | 'REPEATED_OWNER_PATTERN'
  | 'EXPERIMENT_SUPPORTED'
  | 'CROSS_CAMPAIGN_SUPPORTED'
  | 'GLOBAL_RULE'
  | 'MERCHANT_SPECIFIC_RULE'
  | 'CHANNEL_SPECIFIC_RULE'
  | 'TEMPORARY_SEASONAL_RULE'
  | 'REJECTED'
  | 'SUPERSEDE';

export interface SourceAssetInput {
  assetId: string;
  sourceId: string;
  sourceType: 'CHATGPT_EXPORT' | 'IMAGE_FILE' | 'PROMPT_EXPORT' | 'SCREENSHOT' | 'BRAND_ASSET' | 'COMPETITOR_REF' | 'EXPERIMENT_OUTCOME';
  sourceLocator: string;
  conversationId?: string;
  originalFilename?: string;
  originalPrompt?: string;
  negativePrompt?: string;
  model?: string;
  modelVersion?: string;
  provider?: string;
  seed?: number;
  generationSettings?: Record<string, unknown>;
  generationDate?: Date;
  ownerResponse?: string;
  approvalState?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNREVIEWED';
  rejectionState?: string;
  rejectionReason?: RejectionReason;
  campaign?: string;
  merchant?: string;
  audience?: string;
  objective?: string;
  placement?: string;
  dimensions?: string;
  contentSha256: string;
  perceptualHash?: string;
  duplicateCluster?: string;
  rightsState: RightsState;
  evidenceConfidence?: number;
  isTestFixture?: boolean;
  eligibleForRealMemory?: boolean;
}

export interface CreativeGenomeInput {
  assetCategory: string;
  composition: string;
  focalPoint: string;
  subject: string;
  background: string;
  lighting: string;
  palette: string;
  materialTreatment: string;
  typography: string;
  textDensity: string;
  hierarchy: string;
  logoTreatment: string;
  offerTreatment: string;
  ctaTreatment: string;
  productProminence: string;
  peoplePresence: string;
  emotionalTone: string;
  trustCues: string;
  localDcCues: string;
  marketplaceCues: string;
  premiumCues: string;
  mobileReadability: string;
  accessibility: string;
  originalityRisk: string;
  competitorSimilarity: string;
  likelyPlacement: string;
  likelyAudience: string;
  qualityWeaknesses: string[];
  reusableMechanisms: string[];
}

export interface CreativeRecordInput {
  creativeId: string;
  sourceAssetIds: string[];
  campaignId?: string;
  businessId?: string;
  audience?: string;
  customerProblem?: string;
  customerDesire?: string;
  objective?: string;
  channel?: string;
  placement?: string;
  dimensions?: string;
  concept: string;
  hook: string;
  offer: string;
  copy: string;
  cta: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  provider: string;
  generationParameters?: Record<string, unknown>;
  referenceAssets?: string[];
  rightsState: RightsState;
  complianceState?: string;
  ownerDecision?: OwnerDecision;
  decisionAuthority?: DecisionAuthority;
  ownerFeedback?: string;
  merchantDecision?: string;
  merchantFeedback?: string;
  experimentState?: string;
  treatmentOrControl?: 'TREATMENT' | 'CONTROL';
  confidence?: number;
  winningMechanisms?: string[];
  rejectedMechanisms?: string[];
  nextMutation?: string;
  isTestFixture?: boolean;
  eligibleForRealMemory?: boolean;
}

export interface SiteMindContextInput {
  property: string;
  route: string;
  component: string;
  campaignId?: string;
  businessId?: string;
  audience?: string;
  objective?: string;
  customerProblem?: string;
  channel?: string;
  placement?: string;
  dimensions?: string;
  geography?: string;
  offer?: string;
  complianceContext?: string;
  rightsContext?: RightsState;
  experimentContext?: string;
  isTestFixture?: boolean;
}

export interface CompiledCreativeContext {
  receiptHash: string;
  property: string;
  route: string;
  component: string;
  campaignId?: string;
  businessId?: string;
  audience?: string;
  verifiedBusinessFacts: string[];
  relevantCustomerEvidence: string[];
  relevantOwnerTasteRules: string[];
  relevantRejectionRules: string[];
  relevantWinningMechanisms: string[];
  relevantFailureMechanisms: string[];
  relevantCompetitorMechanisms: string[];
  brandConstraints: {
    whiteCanvas: boolean;
    nightModeCanvas: boolean;
    cursiveWordmark: boolean;
    extendedLowercaseD: boolean;
    materialColors: string[];
    prohibitedPatterns: string[];
  };
  routeConstraints: string[];
  placementConstraints: string[];
  rightsClearedReferences: string[];
  prohibitedPatterns: string[];
  activeExperimentConstraints?: string;
  recommendedModel: string;
  recommendedPromptStrategy: string;
  minimumEvidenceRequirement: number;
  requiredApprovalGates: string[];
  compiledAt: string;
  isTestFixture?: boolean;
}

export interface CreativeHypothesis {
  hypothesisId: string;
  concept: string;
  hook: string;
  offer: string;
  copy: string;
  cta: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  provider: string;
  placement: string;
  dimensions: string;
  renders: {
    desktopUrl: string;
    mobileUrl: string;
    renderState: RenderState;
  };
  genome: CreativeGenomeInput;
  qualityScores: {
    visualQuality: number;
    brandAdherence: number;
    accessibility: number;
    originality: number;
    truthCompliance: number;
    mobileReadability: number;
    compositeScore: number;
  };
  passedVerification: boolean;
  verificationNotes: string[];
  ownerDecisionState: OwnerDecision;
  decisionAuthority: DecisionAuthority;
  performanceState: 'PERFORMANCE_UNMEASURED';
}

export interface AutomatedPreselectionResult {
  preselectionId: string;
  contextReceiptHash: string;
  candidates: CreativeHypothesis[];
  preselectedWinnerId: string;
  preselectedRunnerUpId: string;
  reasoning: string;
  evaluatedAt: string;
  hasRealViewableImages: boolean;
}

export interface LearningReceipt {
  receiptHash: string;
  attempted: string;
  whyAttempted: string;
  evidenceUsed: string[];
  ownerDecision: OwnerDecision;
  decisionAuthority: DecisionAuthority;
  merchantDecision?: string;
  experimentDesign: {
    hypothesis: string;
    treatment: string;
    control: string;
    metrics: string[];
    runtimeDays: number;
    status: string;
  };
  measuredOutcome: string;
  causalConfidence: number;
  winningMechanism?: string;
  failureMechanism?: string;
  memoryChanges: string[];
  routingChanges: string[];
  nextMutation: string;
  unresolvedQuestions: string[];
  isTestFixture: boolean;
  createdAt: string;
}
