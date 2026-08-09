-- MANUAL SCHEMA REVERSAL (PostgreSQL): inverse of migration.sql. This is not
-- the code-only application rollback in deploy/namecheap/rollback.sh. It may be
-- applied only during an owner-authorized maintenance window, after the
-- managed-provider backup gate, and never by `migrate deploy`:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f down.sql
-- Removing only this applied migration's bookkeeping row lets the next
-- `prisma migrate deploy` reapply the index. `migrate resolve --rolled-back`
-- is reserved for failed migrations and is not correct for this applied one.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Prisma Migrate uses this PostgreSQL advisory-lock key for deploy/resolve.
-- Taking the transaction-scoped form serializes this manual reversal with
-- those commands and releases the lock on COMMIT or any failure.
SELECT pg_advisory_xact_lock(72707369);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_prisma_migrations"
    WHERE migration_name > '20260726000100_ledger_recorded_at_index'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'refusing reversal: a later successful migration is applied';
  END IF;
END
$$;
DROP INDEX IF EXISTS "DemandCreditEntry_merchantId_recordedAt_idx";
DO $$
DECLARE
  deleted_rows integer;
BEGIN
  DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260726000100_ledger_recorded_at_index'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  IF deleted_rows <> 1 THEN
    RAISE EXCEPTION 'refusing reversal: expected exactly one successful migration row, deleted %', deleted_rows;
  END IF;
END
$$;
COMMIT;
