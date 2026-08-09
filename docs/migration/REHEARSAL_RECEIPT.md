# SQLite → PostgreSQL migration rehearsal — receipt

Executed: 2026-08-09 (UTC). Environment: PostgreSQL 17.8 + PostGIS 3.5.6 +
h3 4.2.3 (local instance standing in for the managed target; every statement
is standard PostgreSQL and re-runnable against the managed host verbatim).

## Method

1. Source built from the **frozen base commit `487ece6`** in a separate git
   worktree: old SQLite schema `prisma db push` + old seed → `/tmp/rehearsal-source.db`.
2. Destination: fresh database `cana_rehearsal` → `prisma migrate deploy`
   (baseline `20260809072622_postgres_baseline_with_geo_kernel`) →
   `geo_kernel_postgis.sql`.
3. `scripts/migrate-sqlite-to-postgres.mjs --dry-run`, then the real run.
4. Post-migration verification chain (below).

## Reconciliation report (machine-readable summary)

```json
{
  "status": "MIGRATED_AND_VERIFIED",
  "tables": 22,
  "rowsMigrated": 252,
  "countMismatches": 0,
  "invariants": {
    "retailers": 5,
    "verifiedRetailers": 0,
    "demoRetailers": 5,
    "brands": 10,
    "retailersAtNullIsland": 0
  },
  "fkIntegrity": {
    "orphanMenuEntries": 0,
    "orphanBrandMenus": 0,
    "orphanLoyaltyAccounts": 0
  },
  "timestampFidelity": "exact epoch-ms equality verified per-row sample",
  "primaryKeyFidelity": "identical UUIDs source->destination",
  "coordinateFidelity": "exact lat/lng equality",
  "geoDerivation": { "backfilledEntities": 5, "skipped": 0, "h3DriftRows": 0 },
  "geoSmokeTest": "26/26 PASSED",
  "semanticsGuards": "INSTALLED",
  "postgresRegressionSuite": "6/6 PASSED against migrated data"
}
```

Full per-table counts are in the migration script's JSON output
(`migrate-sqlite-to-postgres.mjs` prints them on every run).

## Production note

This rehearsal used base-commit seed data (252 rows). Production migration
day repeats the identical procedure against the production `prod.db` snapshot
per the runbook (`SQLITE_TO_POSTGRES.md` §2–§7) — including the checksummed
backup and the rollback path. Do not claim production migration until
production data has actually been migrated.
