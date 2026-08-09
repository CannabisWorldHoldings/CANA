# Database portability — proving CANA is not structurally trapped

Rule: **PostgreSQL/PostGIS/H3 semantics ≠ Neon-specific application semantics.**

## Vendor-specific surface inventory

Everything Neon-specific in this architecture is confined to configuration.
Application code contains zero Neon references.

| Surface | Where it lives | Vendor-specific? | Isolation |
|---|---|---|---|
| Pooled URL (`-pooler` hostname) | `DATABASE_URL` env var | Naming convention only — still standard `postgresql://` | Config only; any PgBouncer-style pooler slots in |
| Direct URL | `DIRECT_URL` env var | No | Config only |
| SQL in Prisma migrations | `prisma/migrations/` | No — standard PostgreSQL | — |
| Geo kernel SQL | `prisma/sql/geo_kernel_postgis.sql` | No — standard PostGIS + h3-pg | Passes on vanilla self-hosted PG 17.8 (executed) |
| Geo smoke test | `prisma/sql/geo_smoke_test.sql` | No | Same — this file IS the portability test |
| Raw spatial SQL | `src/lib/geo/geo-repository.mjs` only | No | The single module allowed raw spatial SQL |
| Neon branching / API / console | Nothing in-repo | Yes (if adopted later) | MUST stay in CI/tooling, never in app code |
| Driver | `@prisma/client` (pg wire protocol) | No — deliberately NOT `@prisma/adapter-neon` | Keep it that way |

## Migration path to Crunchy Bridge or self-managed PostgreSQL

1. Provision target with PostGIS + h3 extensions.
2. `psql "$TARGET" -f prisma/sql/geo_smoke_test.sql` — **before** trusting it.
   (Will fail until step 4 creates tables; run again after.)
3. `pg_dump --format=custom "$DIRECT_URL" | pg_restore --dbname="$TARGET"` into target (or logical replication for
   minimal downtime — available on Neon all plans).
4. `prisma migrate deploy` + `geo_kernel_postgis.sql` + `postgres_semantics_guards.sql`
   against target if starting from schema instead of dump.
5. Re-run the full acceptance gate (runbook §5) against the target.
6. Swap `DATABASE_URL`/`DIRECT_URL`. No code change.

Known host-capability requirement: the target must offer the `h3`/`h3_postgis`
extensions (Neon: yes, verified in docs; Crunchy Bridge: full extension suite
including pgRouting; self-managed: install h3-pg as done in this repo's local
verification). A target without both extensions is rejected. H3 derivation
remains database-owned; an application-side fallback would create a second
geographic truth path and is not a portability mechanism.

## Standing rule for future work

Any PR that introduces a Neon-only SQL function, a Neon API call in
application code, or the Neon serverless driver must also update this file
with the isolation mechanism — or be rejected.
