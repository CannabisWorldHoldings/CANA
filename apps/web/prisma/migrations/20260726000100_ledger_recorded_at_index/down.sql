-- DOWN migration for 20260726000100_ledger_recorded_at_index.
-- Generated with: prisma migrate diff --from-schema-datamodel prisma/schema.prisma
--   --to-migrations <baseline-only> --script
-- Apply with: prisma db execute --url "$DATABASE_URL" --file down.sql
-- then (migration was APPLIED — deliberate downgrade):
--   DELETE FROM _prisma_migrations WHERE migration_name = '20260726000100_ledger_recorded_at_index';
-- or (migration is in a FAILED state after an interruption):
--   prisma migrate resolve --rolled-back 20260726000100_ledger_recorded_at_index
-- Exercised by tests/migration-court.test.mjs (rollback + interruption courts).
-- DropIndex
DROP INDEX "DemandCreditEntry_merchantId_recordedAt_idx";

