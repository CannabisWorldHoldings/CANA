ALTER TABLE "MarketSourceContentArtifact"
  ADD COLUMN "sourceResponseSha256" TEXT;

DROP TRIGGER "MarketSourceContentArtifact_append_only"
  ON "MarketSourceContentArtifact";

UPDATE "MarketSourceContentArtifact" AS artifact
SET "sourceResponseSha256" = encode(
  sha256(decode(snapshot."payloadJson"::jsonb #>> '{pages,0,response_base64}', 'base64')),
  'hex'
)
FROM "MarketSourceSnapshot" AS snapshot
WHERE artifact."snapshotId" = snapshot."id"
  AND snapshot."payloadJson"::jsonb #>> '{pages,0,response_base64}'
    ~ '^[A-Za-z0-9+/]*={0,2}$';

CREATE TRIGGER "MarketSourceContentArtifact_append_only"
  BEFORE UPDATE OR DELETE ON "MarketSourceContentArtifact"
  FOR EACH ROW EXECUTE FUNCTION cana_reality_append_only();

ALTER TABLE "MarketSourceContentArtifact"
  ADD CONSTRAINT "MarketSourceContentArtifact_sourceResponseSha256_format"
    CHECK (
      "sourceResponseSha256" IS NULL
      OR "sourceResponseSha256" ~ '^[a-f0-9]{64}$'
    );

ALTER TABLE "MarketSourceAcquisitionEvent"
  ADD COLUMN "preContentSha256" TEXT,
  ADD COLUMN "postContentSha256" TEXT;

ALTER TABLE "MarketSourceAcquisitionEvent"
  DROP CONSTRAINT "MarketSourceAcquisitionEvent_revision_state_vocab",
  ADD CONSTRAINT "MarketSourceAcquisitionEvent_revision_state_vocab"
    CHECK ("revisionState" IN ('OBSERVED', 'CONTENT_STABLE', 'UNKNOWN')),
  ADD CONSTRAINT "MarketSourceAcquisitionEvent_preContentSha256_format"
    CHECK ("preContentSha256" IS NULL OR "preContentSha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "MarketSourceAcquisitionEvent_postContentSha256_format"
    CHECK ("postContentSha256" IS NULL OR "postContentSha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "MarketSourceAcquisitionEvent_content_stability_bound"
    CHECK (
      "revisionState" <> 'CONTENT_STABLE'
      OR (
        "sourceRevision" = 'UNKNOWN'
        AND "preSourceRevision" IS NULL
        AND "postSourceRevision" IS NULL
        AND "preContentSha256" IS NOT NULL
        AND "postContentSha256" = "preContentSha256"
      )
    );
