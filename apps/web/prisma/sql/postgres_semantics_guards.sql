-- ============================================================================
-- CANA — PostgreSQL semantics guards
--
-- SQLite's unique constraints were case-insensitive for ASCII; PostgreSQL's
-- are case-sensitive. Application code normalizes case on the way in (login,
-- claim approval, ETL), but storage-level guards make the invariant durable
-- against future code that forgets.
--
-- Apply AFTER data migration and AFTER verifying no existing rows violate
-- the guards (this file checks and aborts with a row list if any do).
--
-- Idempotent.
-- ============================================================================

\set ON_ERROR_STOP on

-- Pre-flight: refuse to install guards over data that violates them.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "User" WHERE "email" <> lower("email");
  IF bad > 0 THEN
    RAISE EXCEPTION 'Cannot install guards: % User row(s) have non-lowercase email. Normalize first: UPDATE "User" SET "email" = lower("email");', bad;
  END IF;

  SELECT count(*) INTO bad FROM "Brand" WHERE "domain" <> lower("domain");
  IF bad > 0 THEN
    RAISE EXCEPTION 'Cannot install guards: % Brand row(s) have non-lowercase domain. Normalize first: UPDATE "Brand" SET "domain" = lower("domain");', bad;
  END IF;
END
$$;

-- Emails are stored lowercase. Login lowercases before lookup; a mixed-case
-- stored email would be an unreachable account on PostgreSQL.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_lowercase";
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase"
  CHECK ("email" = lower("email"));

-- Brand domains are matched against lowercased request hostnames
-- (src/lib/host-policy.mjs). A mixed-case stored domain would never match
-- any request on PostgreSQL.
ALTER TABLE "Brand" DROP CONSTRAINT IF EXISTS "Brand_domain_lowercase";
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_domain_lowercase"
  CHECK ("domain" = lower("domain"));

SELECT 'POSTGRES SEMANTICS GUARDS INSTALLED' AS result;
