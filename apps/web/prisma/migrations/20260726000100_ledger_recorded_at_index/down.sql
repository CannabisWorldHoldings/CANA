-- DOWN migration (PostgreSQL): inverse of migration.sql. Applied manually
-- during an owner-authorized rollback (never by `migrate deploy`):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f down.sql
-- Removing only this applied migration's bookkeeping row lets the next
-- `prisma migrate deploy` reapply the index. `migrate resolve --rolled-back`
-- is reserved for failed migrations and is not correct for this applied one.
BEGIN;
DROP INDEX IF EXISTS "DemandCreditEntry_merchantId_recordedAt_idx";
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260726000100_ledger_recorded_at_index';
COMMIT;
