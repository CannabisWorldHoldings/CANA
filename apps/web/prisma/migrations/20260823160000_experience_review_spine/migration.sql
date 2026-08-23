CREATE TABLE "ExperienceReviewCandidate" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "siteId" TEXT,
    "merchantId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceArtifact" TEXT NOT NULL,
    "sourceArtifactSha256" TEXT NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "sourceTreeSha" TEXT NOT NULL,
    "repositoryCommitSha" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    "rightsState" TEXT NOT NULL,
    "accessibilityState" TEXT NOT NULL,
    "policyState" TEXT NOT NULL,
    "uncertaintyState" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lifecycle" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperienceReviewCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExperienceReviewCandidate_sourceKind_vocab" CHECK ("sourceKind" IN ('SITEMIND', 'MERCHANT_MEDIA', 'EXPERIENCE_FABRIC')),
    CONSTRAINT "ExperienceReviewCandidate_sourceArtifactSha256_format" CHECK ("sourceArtifactSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ExperienceReviewCandidate_sourceTreeSha_format" CHECK ("sourceTreeSha" ~ '^[a-f0-9]{40}$'),
    CONSTRAINT "ExperienceReviewCandidate_repositoryCommitSha_format" CHECK ("repositoryCommitSha" ~ '^[a-f0-9]{40}$'),
    CONSTRAINT "ExperienceReviewCandidate_payloadSha256_format" CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ExperienceReviewCandidate_version_positive" CHECK ("version" > 0),
    CONSTRAINT "ExperienceReviewCandidate_lifecycle_vocab" CHECK ("lifecycle" IN ('PENDING_REVIEW', 'APPROVED_FOR_DRAFT_ONLY', 'REJECTED', 'RETURNED_FOR_EVIDENCE'))
);

CREATE TABLE "ExperienceReviewReceipt" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateVersion" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "priorReceiptHash" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL,
    "executionAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "publishAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "deploymentAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperienceReviewReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExperienceReviewReceipt_candidateVersion_positive" CHECK ("candidateVersion" > 0),
    CONSTRAINT "ExperienceReviewReceipt_sequence_positive" CHECK ("sequence" > 0),
    CONSTRAINT "ExperienceReviewReceipt_decision_vocab" CHECK ("decision" IN ('APPROVED_FOR_DRAFT_ONLY', 'REJECTED', 'RETURNED_FOR_EVIDENCE')),
    CONSTRAINT "ExperienceReviewReceipt_priorReceiptHash_format" CHECK ("priorReceiptHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ExperienceReviewReceipt_receiptHash_format" CHECK ("receiptHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ExperienceReviewReceipt_evidenceSha256_format" CHECK ("evidenceSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ExperienceReviewReceipt_zero_authority" CHECK (NOT "executionAuthorized" AND NOT "publishAuthorized" AND NOT "deploymentAuthorized")
);

CREATE UNIQUE INDEX "ExperienceReviewCandidate_idempotencyKey_key" ON "ExperienceReviewCandidate"("idempotencyKey");
CREATE INDEX "ExperienceReviewCandidate_tenant_lifecycle_createdAt_idx" ON "ExperienceReviewCandidate"("tenant", "lifecycle", "createdAt");
CREATE INDEX "ExperienceReviewCandidate_siteId_lifecycle_idx" ON "ExperienceReviewCandidate"("siteId", "lifecycle");
CREATE INDEX "ExperienceReviewCandidate_merchantId_lifecycle_idx" ON "ExperienceReviewCandidate"("merchantId", "lifecycle");
CREATE UNIQUE INDEX "ExperienceReviewReceipt_receiptHash_key" ON "ExperienceReviewReceipt"("receiptHash");
CREATE UNIQUE INDEX "ExperienceReviewReceipt_candidateId_sequence_key" ON "ExperienceReviewReceipt"("candidateId", "sequence");
CREATE INDEX "ExperienceReviewReceipt_candidateId_createdAt_idx" ON "ExperienceReviewReceipt"("candidateId", "createdAt");
CREATE INDEX "ExperienceReviewReceipt_actorId_createdAt_idx" ON "ExperienceReviewReceipt"("actorId", "createdAt");

ALTER TABLE "ExperienceReviewReceipt"
  ADD CONSTRAINT "ExperienceReviewReceipt_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "ExperienceReviewCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cana_experience_review_candidate_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_CANDIDATE_IMMUTABLE';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tenant" IS DISTINCT FROM OLD."tenant"
    OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
    OR NEW."merchantId" IS DISTINCT FROM OLD."merchantId"
    OR NEW."sourceKind" IS DISTINCT FROM OLD."sourceKind"
    OR NEW."sourceArtifact" IS DISTINCT FROM OLD."sourceArtifact"
    OR NEW."sourceArtifactSha256" IS DISTINCT FROM OLD."sourceArtifactSha256"
    OR NEW."sourceRevision" IS DISTINCT FROM OLD."sourceRevision"
    OR NEW."sourceTreeSha" IS DISTINCT FROM OLD."sourceTreeSha"
    OR NEW."repositoryCommitSha" IS DISTINCT FROM OLD."repositoryCommitSha"
    OR NEW."payloadSha256" IS DISTINCT FROM OLD."payloadSha256"
    OR NEW."evidenceRefs" IS DISTINCT FROM OLD."evidenceRefs"
    OR NEW."rightsState" IS DISTINCT FROM OLD."rightsState"
    OR NEW."accessibilityState" IS DISTINCT FROM OLD."accessibilityState"
    OR NEW."policyState" IS DISTINCT FROM OLD."policyState"
    OR NEW."uncertaintyState" IS DISTINCT FROM OLD."uncertaintyState"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_CANDIDATE_IMMUTABLE';
  END IF;

  IF OLD."lifecycle" <> 'PENDING_REVIEW'
    OR NEW."lifecycle" NOT IN ('APPROVED_FOR_DRAFT_ONLY', 'REJECTED', 'RETURNED_FOR_EVIDENCE') THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ExperienceReviewCandidate_guard"
  BEFORE UPDATE OR DELETE ON "ExperienceReviewCandidate"
  FOR EACH ROW EXECUTE FUNCTION cana_experience_review_candidate_guard();

CREATE OR REPLACE FUNCTION cana_experience_review_receipt_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_version INTEGER;
  current_lifecycle TEXT;
  expected_prior_hash TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_RECEIPT_IMMUTABLE';
  END IF;

  SELECT "version", "lifecycle"
    INTO current_version, current_lifecycle
    FROM "ExperienceReviewCandidate"
    WHERE "id" = NEW."candidateId"
    FOR UPDATE;

  IF current_version IS NULL OR current_version <> NEW."candidateVersion" THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_STALE_VERSION';
  END IF;
  IF current_lifecycle <> NEW."decision" THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_DECISION_MISMATCH';
  END IF;
  IF NEW."executionAuthorized" OR NEW."publishAuthorized" OR NEW."deploymentAuthorized" THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_AUTHORITY_FORBIDDEN';
  END IF;

  IF NEW."sequence" = 1 THEN
    expected_prior_hash := repeat('0', 64);
  ELSE
    SELECT "receiptHash"
      INTO expected_prior_hash
      FROM "ExperienceReviewReceipt"
      WHERE "candidateId" = NEW."candidateId"
        AND "sequence" = NEW."sequence" - 1;
  END IF;

  IF expected_prior_hash IS NULL OR expected_prior_hash <> NEW."priorReceiptHash" THEN
    RAISE EXCEPTION 'CANA_EXPERIENCE_REVIEW_LINEAGE_INVALID';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ExperienceReviewReceipt_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ExperienceReviewReceipt"
  FOR EACH ROW EXECUTE FUNCTION cana_experience_review_receipt_guard();
