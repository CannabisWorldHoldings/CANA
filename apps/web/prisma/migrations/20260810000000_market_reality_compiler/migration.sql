CREATE TABLE "MarketSourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "queryParameters" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3),
    "payloadSha256" TEXT NOT NULL,
    "payloadBytes" INTEGER NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "completeness" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketSourceSnapshot_payloadSha256_format" CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketSourceSnapshot_payloadBytes_nonnegative" CHECK ("payloadBytes" >= 0),
    CONSTRAINT "MarketSourceSnapshot_recordCount_nonnegative" CHECK ("recordCount" >= 0),
    CONSTRAINT "MarketSourceSnapshot_completeness_vocab" CHECK ("completeness" IN ('COMPLETE', 'PARTIAL', 'UNKNOWN'))
);

CREATE TABLE "MarketObservation" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceRecordSha256" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "uncertainty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketObservation_sourceRecordSha256_format" CHECK ("sourceRecordSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketObservation_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE TABLE "MarketCompilation" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketCompilation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketEntityResolution" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "compilationId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceRecordSha256" TEXT NOT NULL,
    "normalizedLicense" TEXT,
    "normalizedName" TEXT,
    "normalizedAddress" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateIds" TEXT NOT NULL,
    "normalizationVersion" TEXT NOT NULL,
    "retailerId" TEXT,
    "geoEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketEntityResolution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketEntityResolution_sourceRecordSha256_format" CHECK ("sourceRecordSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketEntityResolution_status_vocab" CHECK ("status" IN ('MATCH', 'REVIEW_REQUIRED', 'UNMATCHED', 'MALFORMED')),
    CONSTRAINT "MarketEntityResolution_match_has_subject" CHECK ("status" <> 'MATCH' OR ("retailerId" IS NOT NULL AND "geoEntityId" IS NOT NULL))
);

CREATE TABLE "MarketClaimContradiction" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "earlierClaimId" TEXT NOT NULL,
    "laterClaimId" TEXT NOT NULL,
    "earlierObservationIds" TEXT NOT NULL,
    "laterObservationIds" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketClaimContradiction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketClaimContradiction_state_vocab" CHECK ("state" IN ('ACTIVE', 'RESOLVED'))
);

CREATE TABLE "MarketClaim" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimValue" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "compilationId" TEXT NOT NULL,
    "supersedesClaimId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "freshnessExpiresAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "uncertainty" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "decisionEligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketClaim_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketClaim_version_positive" CHECK ("version" > 0),
    CONSTRAINT "MarketClaim_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
    CONSTRAINT "MarketClaim_verification_vocab" CHECK ("verification" IN ('UNKNOWN', 'SUPPORTED', 'VERIFIED', 'CONTRADICTED', 'REFUTED', 'STALE')),
    CONSTRAINT "MarketClaim_eligibility_requires_support" CHECK (NOT "decisionEligible" OR "verification" IN ('SUPPORTED', 'VERIFIED'))
);

CREATE TABLE "MarketClaimEvidence" (
    "claimId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketClaimEvidence_pkey" PRIMARY KEY ("claimId", "observationId"),
    CONSTRAINT "MarketClaimEvidence_role_vocab" CHECK ("role" IN ('SUPPORTS', 'CONTRADICTS'))
);

CREATE TABLE "MarketVerificationEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketVerificationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketVerificationEvent_evidenceDigest_format" CHECK ("evidenceDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "MarketVerificationEvent_decision_vocab" CHECK ("decision" IN ('ALLOW', 'DENY', 'PRESERVE_CONFLICT', 'MARK_STALE'))
);

ALTER TABLE "GeoClaim" ADD COLUMN "marketClaimId" TEXT;
ALTER TABLE "GeoClaim" ADD COLUMN "projectionTenant" TEXT;

CREATE UNIQUE INDEX "MarketSourceSnapshot_sourceKey_payloadSha256_key" ON "MarketSourceSnapshot"("sourceKey", "payloadSha256");
CREATE INDEX "MarketSourceSnapshot_sourceKey_fetchedAt_idx" ON "MarketSourceSnapshot"("sourceKey", "fetchedAt");
CREATE INDEX "MarketSourceSnapshot_sourceModifiedAt_idx" ON "MarketSourceSnapshot"("sourceModifiedAt");
CREATE UNIQUE INDEX "MarketCompilation_tenant_snapshotId_key" ON "MarketCompilation"("tenant", "snapshotId");
CREATE INDEX "MarketCompilation_snapshotId_idx" ON "MarketCompilation"("snapshotId");
CREATE UNIQUE INDEX "MarketObservation_snapshotId_sourceRecordId_fieldName_key" ON "MarketObservation"("snapshotId", "sourceRecordId", "fieldName");
CREATE INDEX "MarketObservation_sourceRecordId_fieldName_idx" ON "MarketObservation"("sourceRecordId", "fieldName");
CREATE INDEX "MarketObservation_freshnessExpiresAt_idx" ON "MarketObservation"("freshnessExpiresAt");
CREATE UNIQUE INDEX "MarketEntityResolution_compilationId_sourceRecordId_key" ON "MarketEntityResolution"("compilationId", "sourceRecordId");
CREATE INDEX "MarketEntityResolution_snapshotId_sourceRecordId_idx" ON "MarketEntityResolution"("snapshotId", "sourceRecordId");
CREATE INDEX "MarketEntityResolution_normalizedLicense_idx" ON "MarketEntityResolution"("normalizedLicense");
CREATE INDEX "MarketEntityResolution_status_idx" ON "MarketEntityResolution"("status");
CREATE INDEX "MarketEntityResolution_retailerId_idx" ON "MarketEntityResolution"("retailerId");
CREATE INDEX "MarketEntityResolution_geoEntityId_idx" ON "MarketEntityResolution"("geoEntityId");
CREATE UNIQUE INDEX "MarketClaim_tenant_claimKey_version_key" ON "MarketClaim"("tenant", "claimKey", "version");
CREATE INDEX "MarketClaim_tenant_claimType_decisionEligible_idx" ON "MarketClaim"("tenant", "claimType", "decisionEligible");
CREATE INDEX "MarketClaim_resolutionId_claimType_idx" ON "MarketClaim"("resolutionId", "claimType");
CREATE INDEX "MarketClaim_freshnessExpiresAt_idx" ON "MarketClaim"("freshnessExpiresAt");
CREATE UNIQUE INDEX "MarketClaimContradiction_earlierClaimId_laterClaimId_key" ON "MarketClaimContradiction"("earlierClaimId", "laterClaimId");
CREATE INDEX "MarketClaimContradiction_tenant_claimKey_state_idx" ON "MarketClaimContradiction"("tenant", "claimKey", "state");
CREATE INDEX "MarketClaimEvidence_observationId_idx" ON "MarketClaimEvidence"("observationId");
CREATE INDEX "MarketVerificationEvent_claimId_createdAt_idx" ON "MarketVerificationEvent"("claimId", "createdAt");
CREATE INDEX "MarketVerificationEvent_decision_createdAt_idx" ON "MarketVerificationEvent"("decision", "createdAt");
CREATE UNIQUE INDEX "MarketVerificationEvent_claimId_evidenceDigest_key" ON "MarketVerificationEvent"("claimId", "evidenceDigest");
CREATE UNIQUE INDEX "GeoClaim_marketClaimId_key" ON "GeoClaim"("marketClaimId");
CREATE INDEX "GeoClaim_projectionTenant_eligibility_idx" ON "GeoClaim"("projectionTenant", "decisionEligible", "freshnessExpiresAt");

ALTER TABLE "MarketObservation" ADD CONSTRAINT "MarketObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketCompilation" ADD CONSTRAINT "MarketCompilation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEntityResolution" ADD CONSTRAINT "MarketEntityResolution_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEntityResolution" ADD CONSTRAINT "MarketEntityResolution_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "MarketCompilation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEntityResolution" ADD CONSTRAINT "MarketEntityResolution_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketEntityResolution" ADD CONSTRAINT "MarketEntityResolution_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "GeoEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaim" ADD CONSTRAINT "MarketClaim_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "MarketEntityResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaim" ADD CONSTRAINT "MarketClaim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaim" ADD CONSTRAINT "MarketClaim_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "MarketCompilation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaim" ADD CONSTRAINT "MarketClaim_supersedesClaimId_fkey" FOREIGN KEY ("supersedesClaimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaimEvidence" ADD CONSTRAINT "MarketClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaimEvidence" ADD CONSTRAINT "MarketClaimEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MarketObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaimContradiction" ADD CONSTRAINT "MarketClaimContradiction_earlierClaimId_fkey" FOREIGN KEY ("earlierClaimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketClaimContradiction" ADD CONSTRAINT "MarketClaimContradiction_laterClaimId_fkey" FOREIGN KEY ("laterClaimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketVerificationEvent" ADD CONSTRAINT "MarketVerificationEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeoClaim" ADD CONSTRAINT "GeoClaim_marketClaimId_fkey" FOREIGN KEY ("marketClaimId") REFERENCES "MarketClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cana_reality_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CANA_REALITY_APPEND_ONLY: % is immutable', TG_TABLE_NAME;
END $$;

CREATE TRIGGER "MarketSourceSnapshot_append_only" BEFORE UPDATE OR DELETE ON "MarketSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketObservation_append_only" BEFORE UPDATE OR DELETE ON "MarketObservation" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketCompilation_append_only" BEFORE UPDATE OR DELETE ON "MarketCompilation" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketEntityResolution_append_only" BEFORE UPDATE OR DELETE ON "MarketEntityResolution" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketClaim_append_only" BEFORE UPDATE OR DELETE ON "MarketClaim" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketClaimEvidence_append_only" BEFORE UPDATE OR DELETE ON "MarketClaimEvidence" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketClaimContradiction_append_only" BEFORE UPDATE OR DELETE ON "MarketClaimContradiction" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
CREATE TRIGGER "MarketVerificationEvent_append_only" BEFORE UPDATE OR DELETE ON "MarketVerificationEvent" FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();
