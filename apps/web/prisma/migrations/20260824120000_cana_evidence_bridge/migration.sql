-- WELD v3 canonical evidence bridge. Additive, append-only, and provider-neutral.
CREATE TABLE "CanaEvidenceReceipt" (
    "tenant" TEXT NOT NULL,
    "receiptDigest" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectDigest" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "parentDigestsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanaEvidenceReceipt_pkey" PRIMARY KEY ("tenant", "receiptDigest")
);

CREATE TABLE "CanaIntelligenceRecord" (
    "sequence" BIGSERIAL NOT NULL,
    "tenant" TEXT NOT NULL,
    "recordDigest" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanaIntelligenceRecord_pkey" PRIMARY KEY ("sequence")
);

CREATE INDEX "CanaEvidenceReceipt_tenant_kind_subjectDigest_issuedAt_idx"
ON "CanaEvidenceReceipt"("tenant", "kind", "subjectDigest", "issuedAt");

CREATE INDEX "CanaEvidenceReceipt_tenant_subjectDigest_issuedAt_idx"
ON "CanaEvidenceReceipt"("tenant", "subjectDigest", "issuedAt");

CREATE INDEX "CanaEvidenceReceipt_tenant_expiresAt_idx"
ON "CanaEvidenceReceipt"("tenant", "expiresAt");

CREATE UNIQUE INDEX "CanaIntelligenceRecord_recordDigest_key"
ON "CanaIntelligenceRecord"("recordDigest");

CREATE INDEX "CanaIntelligenceRecord_tenant_recordType_recordId_sequence_idx"
ON "CanaIntelligenceRecord"("tenant", "recordType", "recordId", "sequence");

CREATE INDEX "CanaIntelligenceRecord_tenant_status_createdAt_idx"
ON "CanaIntelligenceRecord"("tenant", "status", "createdAt");

CREATE OR REPLACE FUNCTION "cana_refuse_evidence_rewrite"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CANA_EVIDENCE_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CanaEvidenceReceipt_append_only"
BEFORE UPDATE OR DELETE ON "CanaEvidenceReceipt"
FOR EACH ROW EXECUTE FUNCTION "cana_refuse_evidence_rewrite"();

CREATE TRIGGER "CanaIntelligenceRecord_append_only"
BEFORE UPDATE OR DELETE ON "CanaIntelligenceRecord"
FOR EACH ROW EXECUTE FUNCTION "cana_refuse_evidence_rewrite"();
