-- SOVEREIGN CONTINUATION KERNEL (Slice 1) — owner mandate 2026-08-09.
-- Standalone on bare PostgreSQL by design: no PostGIS, no h3, no FK into
-- other domains (string refs only, DemandCreditEntry precedent). CANA owns
-- this state; external runtimes only wake it.

-- CreateTable
CREATE TABLE "ContinuationMission" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdFrom" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "authorityCeiling" TEXT NOT NULL,
    "budgetCentsMax" INTEGER NOT NULL,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "stopCondition" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "stateRef" TEXT,
    "executionGenomeRef" TEXT,
    "evidenceRequirements" TEXT,
    "latestReceiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuationMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuationTrigger" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdFrom" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ARMED',
    "nextEligibleAt" TIMESTAMP(3),
    "eventKey" TEXT,
    "conditionRef" TEXT,
    "dependsOnTriggerId" TEXT,
    "authorityCeiling" TEXT NOT NULL,
    "budgetCentsMax" INTEGER NOT NULL,
    "stopCondition" TEXT NOT NULL,
    "evidenceRequirements" TEXT,
    "continuationPolicy" TEXT,
    "retryPolicy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firedAt" TIMESTAMP(3),
    "latestReceiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuationTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuationReceipt" (
    "seq" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "triggerId" TEXT,
    "tickId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "evidence" TEXT,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContinuationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "retailerId" TEXT,
    "evidence" TEXT NOT NULL,
    "observedState" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "hypothesizedValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "recommendedAction" TEXT NOT NULL,
    "requiredAuthority" TEXT NOT NULL,
    "estimatedCostCents" INTEGER,
    "risk" TEXT,
    "rollback" TEXT,
    "measurementPlan" TEXT NOT NULL,
    "verification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "followUpTriggerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskIntentSignal" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "rawQuery" TEXT NOT NULL,
    "intentIr" TEXT NOT NULL,
    "answerSummary" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskIntentSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContinuationMission_tenant_status_idx" ON "ContinuationMission"("tenant", "status");
CREATE INDEX "ContinuationMission_status_expiresAt_idx" ON "ContinuationMission"("status", "expiresAt");
CREATE INDEX "ContinuationTrigger_status_nextEligibleAt_idx" ON "ContinuationTrigger"("status", "nextEligibleAt");
CREATE INDEX "ContinuationTrigger_status_eventKey_idx" ON "ContinuationTrigger"("status", "eventKey");
CREATE INDEX "ContinuationTrigger_missionId_idx" ON "ContinuationTrigger"("missionId");
CREATE INDEX "ContinuationTrigger_tenant_status_idx" ON "ContinuationTrigger"("tenant", "status");
CREATE UNIQUE INDEX "ContinuationReceipt_entryHash_key" ON "ContinuationReceipt"("entryHash");
CREATE UNIQUE INDEX "ContinuationReceipt_triggerId_tickId_action_key" ON "ContinuationReceipt"("triggerId", "tickId", "action");
CREATE UNIQUE INDEX "ContinuationReceipt_missionId_seq_key" ON "ContinuationReceipt"("missionId", "seq");
CREATE INDEX "ContinuationReceipt_missionId_recordedAt_idx" ON "ContinuationReceipt"("missionId", "recordedAt");
CREATE INDEX "Opportunity_tenant_status_idx" ON "Opportunity"("tenant", "status");
CREATE INDEX "Opportunity_kind_verification_idx" ON "Opportunity"("kind", "verification");
CREATE UNIQUE INDEX "Opportunity_tenant_dedupeKey_key" ON "Opportunity"("tenant", "dedupeKey");
CREATE INDEX "AskIntentSignal_tenant_createdAt_idx" ON "AskIntentSignal"("tenant", "createdAt");
