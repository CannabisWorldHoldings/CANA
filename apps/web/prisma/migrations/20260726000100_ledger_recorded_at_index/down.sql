-- DOWN migration (PostgreSQL): inverse of migration.sql. Applied manually
-- during a rollback (never by `migrate deploy`):
--   psql "$DIRECT_URL" -f down.sql
--   npx prisma migrate resolve --rolled-back 20260726000100_ledger_recorded_at_index
DROP INDEX IF EXISTS "DemandCreditEntry_merchantId_recordedAt_idx";
