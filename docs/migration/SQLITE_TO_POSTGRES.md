# SQLite → PostgreSQL + PostGIS migration runbook

Companion to ADR-0001 (why) and ADR-0002 (which provider). This document is
the *how*, including the rollback path and the exact human unblock step.

---

## 1. Compatibility analysis (completed)

The repository was inspected before any change was made. SQLite coupling turned
out to be small, which is why this migration is low-risk.

| Area | Finding | Risk | Action taken |
|---|---|---|---|
| Native type annotations | Schema uses **zero** `@db.*` annotations; no `Decimal`, no `Bytes` | None | None needed |
| Raw SQL | Only **2** call sites in the entire repo, both in scripts, neither in app runtime | Medium | Both rewritten engine-portable |
| `sqlite_master` query | `scripts/db-inspect.mjs` | Medium | Now detects engine, uses `pg_tables` on PostgreSQL |
| `PRAGMA index_list` | `scripts/test-public-submission.mjs` | Medium | Now uses `pg_indexes` on PostgreSQL |
| **Case-sensitive search** | **17 `contains` filters, none with `mode: 'insensitive'`** | **HIGH** | 12 user-facing filters fixed; see below |
| **NULLS ordering** | Admin stale queue `lastLicenseCheck: 'asc'` — SQLite puts NULLs first, PostgreSQL puts them LAST, silently burying never-checked retailers | **HIGH** | `{ sort: 'asc', nulls: 'first' }` in `admin/page.tsx`; regression test added |
| **Case-sensitive uniques (email)** | Claim approval used `claim.email` un-normalized in `findUnique`+`create`; PostgreSQL would miss `owner@…` when claim says `Owner@…` and create a duplicate account | **HIGH** | Lowercased at approval site in `admin-mutations.mjs`; storage guard added |
| **Case-sensitive uniques (license)** | ABCA ETL staged raw CSV case; a feed flipping case between runs would create duplicate staging rows and a `P2002` on promotion | MEDIUM | `.trim().toUpperCase()` in both ETL scripts |
| **Collation ordering (`name: 'asc'`)** | SQLite sorts BINARY (case-sensitive); PostgreSQL sorts per locale. Mixed-case names may order differently in "Name A-Z" | LOW (ACCEPTED) | Documented accepted risk: production names are consistently cased; revisit if ETL introduces mixed-case names |
| **`Brand.domain` unique case** | Mixed-case stored domain would never match lowercased request hostnames | LOW | `CHECK (domain = lower(domain))` storage guard |
| ID generation | `@default(uuid())` — engine-independent | None | None needed |
| Timestamps | `DateTime` with `@default(now())` / `@updatedAt` | Low | Coerced during data migration |
| Booleans | SQLite stores 0/1; PostgreSQL is a real boolean | Low | Coerced during data migration |
| Autoincrement | Not used (all IDs are UUID strings) | None | None needed |
| Deployment | cPanel read a local DB file | Medium | Now an outbound TLS connection; see §6 |

### The case-sensitivity hazard (most important finding)

SQLite's `contains` is case-insensitive for ASCII by default. PostgreSQL's is
**case-sensitive**. Migrating without addressing this would have silently
broken customer-facing search — a user searching `dupont` would no longer match
`Dupont Circle` — with **no error and no failing test**. This is precisely the
class of silent regression that makes naive database migrations dangerous.

Fixed with `mode: 'insensitive'` in:

- `src/lib/directory-search.mjs` — name, zip, address, city, product name, neighbourhood keywords
- `src/lib/product-discovery.mjs` — product name, product description, retailer name
- `src/lib/merchant-dashboard.mjs` — name, category, description
- `src/app/[domain]/education/page.tsx` — strain name
- `scripts/etl-abca-retailers.mjs` — trade-name entity resolution

**Deliberately left case-sensitive:** `details: { contains: <id> }` in
`test-dispute-flow.mjs`, `test-claim-lifecycle.mjs`, `test-site-intelligence.mjs`,
`http-public-write-check.mjs`. These match exact UUIDs inside audit strings,
where case-sensitivity is correct and desirable.

### Column-width review (PostgreSQL)

This section is the recorded finding that `tests/column-width-cutover-court.test.mjs`
("THE GATE") cites when it clears the `postgresql` provider. That court exists for a
MySQL/MariaDB hazard: on the MySQL family, Prisma maps an unannotated `String` to
**VARCHAR(191)**, which would silently truncate long-form columns — most dangerously
`DemandCreditEntry.evidenceChain`, whose JSON is hashed into the append-only ledger, so
truncation makes every attributed action fail its own evidence check and a merchant's
proven value silently drop to zero.

**Finding — the hazard does NOT exist on PostgreSQL.** Prisma maps an unannotated
`String` to **`text`** on PostgreSQL, which is unbounded. No `@db.Text` annotation is
needed (and, being a MySQL-family native type, `@db.Text` would in any case be wrong to
carry here). The court is therefore satisfied for `postgresql` by *absence of a bound*,
not by presence of a widening annotation, and it now proscribes anyone adding an explicit
`@db.VarChar(n)`/`@db.Char(n)` to these columns — that, and only that, would reintroduce
truncation under PostgreSQL.

**Verified 2026-08-09 against the live `cana_app` database** (`information_schema.columns`):
every column in the court's `LONG_FORM_COLUMNS` list is `data_type = text`,
`character_maximum_length = NULL` (i.e. unbounded). Columns cleared, by name:

| Table.Column | PostgreSQL type | max length |
|---|---|---|
| `DemandCreditEntry.evidenceChain` (ledger-hashed) | `text` | unbounded |
| `Article.content` | `text` | unbounded |
| `AuditLog.details` | `text` | unbounded |
| `SiteObservation.summary` / `.evidence` / `.uncertainty` / `.preparedAction` | `text` | unbounded |
| `Dispute.oldValue` / `.newValue` | `text` | unbounded |
| `LicenseEvidence.notes` | `text` | unbounded |
| `Brand.description` / `Product.description` / `Deal.description` | `text` | unbounded |
| `StagingABCARetailer.rawJson` / `LoyaltyTransaction.description` | `text` | unbounded (where the model is present) |

Re-run the evidence query any time with:

```bash
psql "$DATABASE_URL" -c "SELECT table_name, column_name, data_type, character_maximum_length
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN
   ('evidenceChain','content','details','rawJson','summary','evidence','uncertainty',
    'preparedAction','oldValue','newValue','notes','description');"
```

The tripwire stays armed for any FUTURE provider flip: a provider not in the court's
reviewed set (`sqlite`, `postgresql`, `mysql`, `mariadb`) fails with
"unexpected provider … — review column widths before proceeding", which is exactly how
this migration re-armed the court from `sqlite` to `postgresql`.

---

## 2. Pre-migration: preserve a verifiable snapshot

**Never begin without a restorable snapshot.** The SQLite file is the rollback
position.

```bash
# On the production host, with the app stopped:
SRC=/home/<cpanel-user>/orderweeddc-data/prod.db
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cp "$SRC" "/home/<cpanel-user>/backups/prod-${STAMP}.db"
sha256sum "/home/<cpanel-user>/backups/prod-${STAMP}.db" \
  | tee "/home/<cpanel-user>/backups/prod-${STAMP}.db.sha256"

# Record the pre-migration truth for later comparison:
DATABASE_URL="file:${SRC}" node apps/web/scripts/db-inspect.mjs \
  > "/home/<cpanel-user>/backups/pre-migration-receipt-${STAMP}.json"
```

Keep the snapshot and its checksum until PostgreSQL has been healthy in
production for an agreed burn-in period. **Do not delete it on migration day.**

---

## 3. Provision PostgreSQL + PostGIS

See ADR-0002 for provider selection and the cannabis-AUP constraint
(**Railway and Supabase are disqualified on policy grounds**).

```bash
# Verify the extension really exists before trusting the host:
psql "$DIRECT_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql "$DIRECT_URL" -c "SELECT PostGIS_Full_Version();"
```

---

## 4. Migrate schema, then data

```bash
cd apps/web

# 4a. Schema. DIRECT_URL (unpooled) is required for migrations.
npx prisma migrate deploy

# 4b. Geo kernel: PostGIS extension, GiST index, coordinate constraints,
#     and the lat/lng -> geom sync trigger. Idempotent.
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/sql/geo_kernel_postgis.sql

# 4c. Prove the geo layer actually works on THIS host. 14 assertions,
#     rolls itself back, exits non-zero on any failure.
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/sql/geo_smoke_test.sql

# 4d. Data. Dry run first — it reports counts without writing.
SQLITE_PATH=/path/to/prod.db node scripts/migrate-sqlite-to-postgres.mjs --dry-run
SQLITE_PATH=/path/to/prod.db node scripts/migrate-sqlite-to-postgres.mjs

# 4e. Derive canonical geo entities from retailer coordinates.
node scripts/backfill-geo-entities.mjs --dry-run
node scripts/backfill-geo-entities.mjs

# 4f. Install PostgreSQL semantics guards (lowercase email/domain CHECKs).
#     Pre-flight aborts with a fix-it command if existing rows violate them.
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/sql/postgres_semantics_guards.sql
```

Note on H3 extensions: the geo kernel requires `h3` + `h3_postgis`
(`CREATE EXTENSION h3_postgis CASCADE` pulls in `postgis_raster`). Neon ships
h3 4.1.3 on PG17 — verified supported. The kernel uses `h3_lat_lng_to_cell`,
which is the current name on 4.1.3 and still valid (deprecation warning only)
on 4.2.3. If a future host lacks the h3 extension entirely, the kernel
provisioning fails closed with instructions to switch `h3R9` maintenance to an
application-side H3 library — the H3 semantics are portable by design.

The migration script **refuses to run against a non-empty PostgreSQL** unless
`--allow-nonempty` is passed, so it cannot silently double-insert. It verifies
per-table row counts against the source and checks business invariants, failing
hard on any mismatch.

---

## 5. Acceptance gate

Migration is **not** complete until every one of these passes:

```bash
cd apps/web
npm run lint
npx tsc --noEmit
npm run test          # 37 node:test suites
npm run test:db
npm run test:http
npm run build
DATABASE_URL="$DIRECT_URL" node scripts/db-inspect.mjs --assert-core
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/sql/geo_smoke_test.sql
# PostgreSQL-specific semantic regressions (case-insensitivity, NULLS
# ordering, unique case-variants). Requires a seeded PostgreSQL database.
node --test tests/postgres-semantics.test.mjs
```

Compare `db-inspect` output against the pre-migration receipt from §2. Record
counts must match.

---

## 6. Deployment change (cPanel)

The application no longer ships a database file. It connects outbound.

- Set `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled) in the cPanel Node
  application environment. **Never** commit them.
- Confirm the host permits outbound TLS on the provider's port (commonly 5432).
  Some shared hosts restrict outbound ports — verify before cutover.
- `sslmode=require` must be present in both URLs.
- Neither variable may appear in any client bundle. `NEXT_PUBLIC_` prefixed
  variables are exposed to the browser; the database URLs must never use it.

---

## 7. Rollback plan

Rollback is fast because the snapshot is untouched and the code change is
reversible.

**Trigger rollback if:** the acceptance gate fails after cutover, the app
cannot reach the database from the production host, or data integrity checks
disagree with the pre-migration receipt.

```bash
# 1. Stop the application.
# 2. Restore the code to the pre-migration commit (SQLite datasource):
git revert <migration-merge-commit>     # or redeploy the previous artifact

# 3. Restore the database file and verify the checksum matches §2:
cp /home/<cpanel-user>/backups/prod-<STAMP>.db \
   /home/<cpanel-user>/orderweeddc-data/prod.db
sha256sum -c /home/<cpanel-user>/backups/prod-<STAMP>.db.sha256

# 4. Restore DATABASE_URL=file:/home/<cpanel-user>/orderweeddc-data/prod.db
# 5. Restart, then re-run the gate stack.
```

**Data written to PostgreSQL after cutover would be lost on rollback.** Keep
the cutover window short, and prefer a read-only maintenance window during
migration so no writes are stranded.

**Do not delete the SQLite snapshot** until PostgreSQL is proven healthy.

---

## 8. Current status and the exact unblock step

Everything that does not require a live database credential is **done and
verified against a real PostgreSQL 17.8 + PostGIS 3.5.6 instance** provisioned
locally for this work (see the evidence ledger).

**Blocked on exactly one human action:**

> Create a managed PostgreSQL database with PostGIS (Neon recommended — see
> ADR-0002; **do not use Railway or Supabase**, both disqualified on cannabis
> acceptable-use grounds). Then supply two connection strings:
>
> ```
> DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.provider.tech/DBNAME?sslmode=require"
> DIRECT_URL="postgresql://USER:PASSWORD@HOST.REGION.provider.tech/DBNAME?sslmode=require"
> ```
>
> `DATABASE_URL` = pooled endpoint, `DIRECT_URL` = direct/unpooled endpoint.

A second, independent blocker applies to running the test gate in this
environment: the sandbox egress firewall denies `registry.npmjs.org`, so
`npm install` cannot run and the 37 existing suites could not be executed here.
Approving that domain (or running the gate in CI) unblocks it.
