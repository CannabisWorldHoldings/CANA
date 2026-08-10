-- Phase B Slice 2: live reality acquisition provenance.
--
-- MarketSourceSnapshot remains the one immutable storage location for exact
-- response bytes. MarketSourceContentArtifact identifies those bytes, while
-- MarketSourceAcquisitionEvent records each distinct attempt that observed
-- them. A repeated observation therefore appends an event without duplicating
-- or mutating the payload.

CREATE TABLE "MarketSourceContentArtifact" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "requestContractDigest" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "payloadBytes" INTEGER NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceContentArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketSourceContentArtifact_contentSha256_format" CHECK ("contentSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceContentArtifact_requestContractDigest_format" CHECK ("requestContractDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceContentArtifact_payloadBytes_nonnegative" CHECK ("payloadBytes" >= 0),
    CONSTRAINT "MarketSourceContentArtifact_recordCount_nonnegative" CHECK ("recordCount" >= 0)
);

CREATE TABLE "MarketSourceAcquisitionEvent" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "outcome" TEXT,
    "predicateScope" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceRevision" TEXT NOT NULL,
    "preSourceRevision" TEXT,
    "postSourceRevision" TEXT,
    "revisionState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "etag" TEXT,
    "lastModified" TEXT,
    "httpStatus" INTEGER,
    "responseContentType" TEXT,
    "requestDigest" TEXT NOT NULL,
    "completeness" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "observedRecordCount" INTEGER,
    "preObservedRecordCount" INTEGER,
    "postObservedRecordCount" INTEGER,
    "observedPayloadBytes" INTEGER,
    "adapterVersion" TEXT NOT NULL,
    "adapterContractDigest" TEXT,
    "parserVersion" TEXT NOT NULL,
    "compilerVersion" TEXT,
    "entityResolverVersion" TEXT,
    "authorityPolicyVersion" TEXT,
    "freshnessPolicyVersion" TEXT,
    "verificationCourtVersion" TEXT,
    "repositoryCommitSha" TEXT NOT NULL,
    "repositoryTreeSha" TEXT,
    "triggerKind" TEXT,
    "tenant" TEXT,
    "contentArtifactId" TEXT,
    "snapshotId" TEXT,
    "priorEventHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceAcquisitionEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketSourceAcquisitionEvent_sequence_positive" CHECK ("sequence" > 0),
    CONSTRAINT "MarketSourceAcquisitionEvent_state_vocab" CHECK ("state" IN ('REQUESTED', 'PREFLIGHT_VALIDATED', 'FETCHING', 'CAPTURED', 'POSTFLIGHT_VALIDATED', 'CHANGED', 'PERSISTED', 'UNCHANGED', 'REVALIDATION_PENDING', 'COMPLETED', 'FAILED', 'IMPORTED_FIXTURE')),
    CONSTRAINT "MarketSourceAcquisitionEvent_outcome_vocab" CHECK ("outcome" IS NULL OR "outcome" IN ('SOURCE_CHANGED', 'SOURCE_UNCHANGED', 'SOURCE_PARTIAL', 'SOURCE_FAILED', 'SOURCE_SCHEMA_CHANGED', 'SOURCE_UNKNOWN')),
    CONSTRAINT "MarketSourceAcquisitionEvent_revision_state_vocab" CHECK ("revisionState" IN ('OBSERVED', 'UNKNOWN')),
    CONSTRAINT "MarketSourceAcquisitionEvent_completeness_vocab" CHECK ("completeness" IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')),
    CONSTRAINT "MarketSourceAcquisitionEvent_requestDigest_format" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceAcquisitionEvent_priorEventHash_format" CHECK ("priorEventHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceAcquisitionEvent_eventHash_format" CHECK ("eventHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceAcquisitionEvent_recordCount_nonnegative" CHECK ("observedRecordCount" IS NULL OR "observedRecordCount" >= 0),
    CONSTRAINT "MarketSourceAcquisitionEvent_preRecordCount_nonnegative" CHECK ("preObservedRecordCount" IS NULL OR "preObservedRecordCount" >= 0),
    CONSTRAINT "MarketSourceAcquisitionEvent_postRecordCount_nonnegative" CHECK ("postObservedRecordCount" IS NULL OR "postObservedRecordCount" >= 0),
    CONSTRAINT "MarketSourceAcquisitionEvent_payloadBytes_nonnegative" CHECK ("observedPayloadBytes" IS NULL OR "observedPayloadBytes" >= 0),
    CONSTRAINT "MarketSourceAcquisitionEvent_httpStatus_range" CHECK ("httpStatus" IS NULL OR ("httpStatus" >= 100 AND "httpStatus" <= 599)),
    CONSTRAINT "MarketSourceAcquisitionEvent_time_order" CHECK ("eventAt" >= "requestedAt" AND ("fetchedAt" IS NULL OR "fetchedAt" >= "requestedAt") AND ("completedAt" IS NULL OR "completedAt" >= "requestedAt")),
    CONSTRAINT "MarketSourceAcquisitionEvent_success_has_content" CHECK ("outcome" NOT IN ('SOURCE_CHANGED', 'SOURCE_UNCHANGED') OR ("contentArtifactId" IS NOT NULL AND "snapshotId" IS NOT NULL AND "fetchedAt" IS NOT NULL AND "completeness" = 'COMPLETE')),
    CONSTRAINT "MarketSourceAcquisitionEvent_terminal_has_outcome" CHECK ("state" <> 'COMPLETED' OR "outcome" IS NOT NULL),
    CONSTRAINT "MarketSourceAcquisitionEvent_failure_has_error" CHECK ("state" <> 'FAILED' OR "errorCode" IS NOT NULL)
);

CREATE TABLE "MarketSourceCapabilityReceipt" (
    "id" TEXT NOT NULL,
    "acquisitionEventId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "capabilitiesJson" TEXT NOT NULL,
    "limitsJson" TEXT NOT NULL,
    "schemaDigest" TEXT NOT NULL,
    "receiptDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceCapabilityReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketSourceCapabilityReceipt_schemaDigest_format" CHECK ("schemaDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceCapabilityReceipt_receiptDigest_format" CHECK ("receiptDigest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "MarketSourceCircuitEvent" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "workClass" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "cooldownUntil" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "priorEventHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceCircuitEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketSourceCircuitEvent_sequence_positive" CHECK ("sequence" > 0),
    CONSTRAINT "MarketSourceCircuitEvent_failureCount_nonnegative" CHECK ("failureCount" >= 0),
    CONSTRAINT "MarketSourceCircuitEvent_state_vocab" CHECK ("state" IN ('HEALTHY', 'DEGRADED', 'OPEN_CIRCUIT', 'PROBE_ALLOWED')),
    CONSTRAINT "MarketSourceCircuitEvent_priorEventHash_format" CHECK ("priorEventHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceCircuitEvent_eventHash_format" CHECK ("eventHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceCircuitEvent_open_has_cooldown" CHECK ("state" <> 'OPEN_CIRCUIT' OR "cooldownUntil" IS NOT NULL)
);

CREATE TABLE "MarketEvidenceRevocationEvent" (
    "id" TEXT NOT NULL,
    "tenant" TEXT,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "contentArtifactId" TEXT,
    "acquisitionEventId" TEXT,
    "snapshotId" TEXT,
    "observationId" TEXT,
    "parserVersion" TEXT,
    "policyVersion" TEXT,
    "priorEventHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketEvidenceRevocationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketEvidenceRevocationEvent_decision_vocab" CHECK ("decision" IN ('EVIDENCE_QUARANTINED', 'EVIDENCE_REVOKED', 'EVIDENCE_RESTORED')),
    CONSTRAINT "MarketEvidenceRevocationEvent_priorEventHash_format" CHECK ("priorEventHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketEvidenceRevocationEvent_eventHash_format" CHECK ("eventHash" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "MarketCompilation" ADD COLUMN "contentArtifactId" TEXT;
ALTER TABLE "MarketCompilation" ADD COLUMN "acquisitionEventId" TEXT;
ALTER TABLE "MarketVerificationEvent" ADD COLUMN "acquisitionEventId" TEXT;
ALTER TABLE "MarketVerificationEvent" ADD COLUMN "evidenceRevocationId" TEXT;
ALTER TABLE "MarketVerificationEvent" ADD COLUMN "freshnessExpiresAt" TIMESTAMP(3);
DROP INDEX "MarketVerificationEvent_claimId_evidenceDigest_key";

CREATE UNIQUE INDEX "MarketSourceContentArtifact_snapshotId_key" ON "MarketSourceContentArtifact"("snapshotId");
CREATE UNIQUE INDEX "MarketSourceContentArtifact_sourceKey_contentSha256_key" ON "MarketSourceContentArtifact"("sourceKey", "contentSha256");
CREATE INDEX "MarketSourceContentArtifact_sourceKey_createdAt_idx" ON "MarketSourceContentArtifact"("sourceKey", "createdAt");

CREATE UNIQUE INDEX "MarketSourceAcquisitionEvent_attemptId_sequence_key" ON "MarketSourceAcquisitionEvent"("attemptId", "sequence");
CREATE UNIQUE INDEX "MarketSourceAcquisitionEvent_eventHash_key" ON "MarketSourceAcquisitionEvent"("eventHash");
CREATE INDEX "MarketSourceAcquisitionEvent_sourceKey_createdAt_idx" ON "MarketSourceAcquisitionEvent"("sourceKey", "createdAt");
CREATE INDEX "MarketSourceAcquisitionEvent_contentArtifactId_idx" ON "MarketSourceAcquisitionEvent"("contentArtifactId");
CREATE INDEX "MarketSourceAcquisitionEvent_snapshotId_idx" ON "MarketSourceAcquisitionEvent"("snapshotId");
CREATE INDEX "MarketSourceAcquisitionEvent_state_createdAt_idx" ON "MarketSourceAcquisitionEvent"("state", "createdAt");
CREATE INDEX "MarketSourceAcquisitionEvent_tenant_createdAt_idx" ON "MarketSourceAcquisitionEvent"("tenant", "createdAt");

CREATE UNIQUE INDEX "MarketSourceCapabilityReceipt_acquisitionEventId_key" ON "MarketSourceCapabilityReceipt"("acquisitionEventId");
CREATE UNIQUE INDEX "MarketSourceCapabilityReceipt_receiptDigest_key" ON "MarketSourceCapabilityReceipt"("receiptDigest");
CREATE INDEX "MarketSourceCapabilityReceipt_sourceKey_observedAt_idx" ON "MarketSourceCapabilityReceipt"("sourceKey", "observedAt");

CREATE UNIQUE INDEX "MarketSourceCircuitEvent_sourceKey_workClass_tenant_sequence_key" ON "MarketSourceCircuitEvent"("sourceKey", "workClass", "tenant", "sequence");
CREATE UNIQUE INDEX "MarketSourceCircuitEvent_eventHash_key" ON "MarketSourceCircuitEvent"("eventHash");
CREATE INDEX "MarketSourceCircuitEvent_sourceKey_workClass_tenant_createdAt_idx" ON "MarketSourceCircuitEvent"("sourceKey", "workClass", "tenant", "createdAt");
CREATE INDEX "MarketSourceCircuitEvent_state_cooldownUntil_idx" ON "MarketSourceCircuitEvent"("state", "cooldownUntil");

CREATE UNIQUE INDEX "MarketEvidenceRevocationEvent_eventHash_key" ON "MarketEvidenceRevocationEvent"("eventHash");
CREATE UNIQUE INDEX "MarketEvidenceRevocationEvent_targetKind_targetId_eventHash_key" ON "MarketEvidenceRevocationEvent"("targetKind", "targetId", "eventHash");
CREATE INDEX "MarketEvidenceRevocationEvent_tenant_targetKind_targetId_effectiveAt_idx" ON "MarketEvidenceRevocationEvent"("tenant", "targetKind", "targetId", "effectiveAt");
CREATE INDEX "MarketEvidenceRevocationEvent_contentArtifactId_idx" ON "MarketEvidenceRevocationEvent"("contentArtifactId");
CREATE INDEX "MarketEvidenceRevocationEvent_acquisitionEventId_idx" ON "MarketEvidenceRevocationEvent"("acquisitionEventId");
CREATE INDEX "MarketEvidenceRevocationEvent_snapshotId_idx" ON "MarketEvidenceRevocationEvent"("snapshotId");
CREATE INDEX "MarketEvidenceRevocationEvent_observationId_idx" ON "MarketEvidenceRevocationEvent"("observationId");
CREATE INDEX "MarketEvidenceRevocationEvent_parserVersion_idx" ON "MarketEvidenceRevocationEvent"("parserVersion");

CREATE INDEX "MarketCompilation_acquisitionEventId_idx" ON "MarketCompilation"("acquisitionEventId");
CREATE INDEX "MarketCompilation_contentArtifactId_idx" ON "MarketCompilation"("contentArtifactId");
CREATE INDEX "MarketVerificationEvent_acquisitionEventId_idx" ON "MarketVerificationEvent"("acquisitionEventId");
CREATE INDEX "MarketVerificationEvent_evidenceRevocationId_idx" ON "MarketVerificationEvent"("evidenceRevocationId");
CREATE UNIQUE INDEX "MarketVerificationEvent_claimId_evidenceDigest_acquisitionEventId_key" ON "MarketVerificationEvent"("claimId", "evidenceDigest", "acquisitionEventId");

ALTER TABLE "MarketSourceContentArtifact" ADD CONSTRAINT "MarketSourceContentArtifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketSourceAcquisitionEvent" ADD CONSTRAINT "MarketSourceAcquisitionEvent_contentArtifactId_fkey" FOREIGN KEY ("contentArtifactId") REFERENCES "MarketSourceContentArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketSourceAcquisitionEvent" ADD CONSTRAINT "MarketSourceAcquisitionEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketSourceCapabilityReceipt" ADD CONSTRAINT "MarketSourceCapabilityReceipt_acquisitionEventId_fkey" FOREIGN KEY ("acquisitionEventId") REFERENCES "MarketSourceAcquisitionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEvidenceRevocationEvent" ADD CONSTRAINT "MarketEvidenceRevocationEvent_contentArtifactId_fkey" FOREIGN KEY ("contentArtifactId") REFERENCES "MarketSourceContentArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEvidenceRevocationEvent" ADD CONSTRAINT "MarketEvidenceRevocationEvent_acquisitionEventId_fkey" FOREIGN KEY ("acquisitionEventId") REFERENCES "MarketSourceAcquisitionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEvidenceRevocationEvent" ADD CONSTRAINT "MarketEvidenceRevocationEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketCompilation" ADD CONSTRAINT "MarketCompilation_contentArtifactId_fkey" FOREIGN KEY ("contentArtifactId") REFERENCES "MarketSourceContentArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketCompilation" ADD CONSTRAINT "MarketCompilation_acquisitionEventId_fkey" FOREIGN KEY ("acquisitionEventId") REFERENCES "MarketSourceAcquisitionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketVerificationEvent" ADD CONSTRAINT "MarketVerificationEvent_acquisitionEventId_fkey" FOREIGN KEY ("acquisitionEventId") REFERENCES "MarketSourceAcquisitionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketVerificationEvent" ADD CONSTRAINT "MarketVerificationEvent_evidenceRevocationId_fkey" FOREIGN KEY ("evidenceRevocationId") REFERENCES "MarketEvidenceRevocationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing immutable snapshots are content artifacts, and their historical
-- fetchedAt is one legacy observation. This backfill never mutates a snapshot.
INSERT INTO "MarketSourceContentArtifact" (
    "id", "snapshotId", "sourceKey", "sourceUrl", "requestContractDigest", "contentSha256",
    "payloadBytes", "recordCount", "schemaVersion", "createdAt"
)
SELECT
    'content:legacy:' || "id",
    "id",
    "sourceKey",
    "sourceUrl",
    "payloadSha256",
    "payloadSha256",
    "payloadBytes",
    "recordCount",
    "schemaVersion",
    "createdAt"
FROM "MarketSourceSnapshot";

WITH ordered AS (
    SELECT
        snapshot."id",
        snapshot."sourceKey",
        snapshot."sourceUrl",
        snapshot."queryParameters",
        snapshot."fetchedAt",
        snapshot."payloadSha256",
        snapshot."payloadBytes",
        snapshot."recordCount",
        snapshot."schemaVersion",
        snapshot."completeness",
        ROW_NUMBER() OVER (PARTITION BY snapshot."sourceKey" ORDER BY snapshot."fetchedAt", snapshot."id") AS sequence
    FROM "MarketSourceSnapshot" snapshot
)
INSERT INTO "MarketSourceAcquisitionEvent" (
    "id", "sourceKey", "attemptId", "sequence", "state", "outcome", "predicateScope",
    "requestedAt", "eventAt", "fetchedAt", "completedAt", "sourceRevision", "revisionState",
    "requestDigest", "completeness", "observedRecordCount", "observedPayloadBytes",
    "adapterVersion", "parserVersion", "repositoryCommitSha", "contentArtifactId",
    "snapshotId", "priorEventHash", "eventHash", "createdAt"
)
SELECT
    'acquisition:legacy:' || ordered."id",
    ordered."sourceKey",
    'legacy:' || ordered."id",
    1,
    'IMPORTED_FIXTURE',
    'SOURCE_UNKNOWN',
    'legacy_snapshot',
    ordered."fetchedAt",
    ordered."fetchedAt",
    ordered."fetchedAt",
    ordered."fetchedAt",
    'UNKNOWN',
    'UNKNOWN',
    ordered."payloadSha256",
    ordered."completeness",
    ordered."recordCount",
    ordered."payloadBytes",
    'legacy-snapshot-import-v1',
    ordered."schemaVersion",
    'VERSION_PROVENANCE_UNKNOWN',
    'content:legacy:' || ordered."id",
    ordered."id",
    repeat('0', 64),
    md5(ordered."sourceKey" || ':' || ordered."id") || md5('legacy:' || ordered."sourceKey" || ':' || ordered."id"),
    ordered."fetchedAt"
FROM ordered;

UPDATE "MarketCompilation"
SET
    "contentArtifactId" = 'content:legacy:' || "snapshotId",
    "acquisitionEventId" = 'acquisition:legacy:' || "snapshotId";

UPDATE "MarketVerificationEvent" event
SET
    "acquisitionEventId" = 'acquisition:legacy:' || claim."snapshotId",
    "freshnessExpiresAt" = claim."freshnessExpiresAt"
FROM "MarketClaim" claim
WHERE event."claimId" = claim."id";

CREATE TRIGGER "MarketSourceContentArtifact_append_only" BEFORE UPDATE OR DELETE ON "MarketSourceContentArtifact" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketSourceAcquisitionEvent_append_only" BEFORE UPDATE OR DELETE ON "MarketSourceAcquisitionEvent" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketSourceCapabilityReceipt_append_only" BEFORE UPDATE OR DELETE ON "MarketSourceCapabilityReceipt" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketSourceCircuitEvent_append_only" BEFORE UPDATE OR DELETE ON "MarketSourceCircuitEvent" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketEvidenceRevocationEvent_append_only" BEFORE UPDATE OR DELETE ON "MarketEvidenceRevocationEvent" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
