# CANA Geo Kernel — Evidence Ledger

Slice 1a + 1b: PostgreSQL + PostGIS canonical datastore migration and
foundation proof. Date: 2026-08-08. Base commit: `487ece6`.

States: **VERIFIED** (observed directly) · **PARTIAL** · **INFERRED** ·
**PLANNED** (designed, not implemented) · **BLOCKED** (needs human action) ·
**UNKNOWN**.

No claim below is marked VERIFIED unless it was executed and its output
observed in this session.

---

## Current state assessment (before any change)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1 | `orderweeddc` is the CANA monorepo; npm workspaces `apps/web` + 3 packages | VERIFIED | Cloned repo, read root `package.json` | — |
| 2 | Database was SQLite | VERIFIED | `schema.prisma` `provider = "sqlite"` | — |
| 3 | Map was Leaflet 1.9 + react-leaflet 5 + CARTO raster tiles | VERIFIED | `src/components/retailer-map.tsx`, `package.json` | Unchanged by this slice |
| 4 | Geography was two bare `Float` columns; no geometry/cells/service areas | VERIFIED | `Retailer` model, grep across `src` | — |
| 5 | No PostGIS, H3, routing, geocoding, or provider abstraction existed | VERIFIED | grep across `apps/web/src`, `packages` | — |
| 6 | 22 Prisma models; 37 `node:test` suites; real gate culture exists | VERIFIED | schema enumeration, `apps/web/tests` listing | — |
| 7 | Deploy target is Namecheap cPanel shared hosting | VERIFIED | `NAMECHEAP_CPANEL_DEPLOYMENT.md`, Prisma `binaryTargets` | — |
| 8 | Only 2 raw SQL call sites exist, both SQLite-specific, both in scripts | VERIFIED | grep for `$queryRaw`/`$executeRaw` | — |
| 9 | 17 `contains` filters existed with zero `mode: 'insensitive'` | VERIFIED | grep across `src`, `scripts` | Silent-breakage risk on PostgreSQL |

## PostGIS capability

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 10 | PostgreSQL 17.8 provisioned and running | VERIFIED | `SELECT version()` | **Sandbox instance, not production** |
| 11 | PostGIS 3.5.6 enabled (GEOS 3.14.1, PROJ 9.8.1) | VERIFIED | `PostGIS_Full_Version()` | Same |
| 12 | `ST_Contains` polygon containment is correct | VERIFIED | DC quadrilateral test excluded Silver Spring, MD | — |
| 13 | `ST_Distance` geography is geodesically correct | VERIFIED | Dupont Circle → White House = 1460 m | Matches real-world ~1.4–1.5 km |
| 14 | `ST_DWithin` radius filtering is correct | VERIFIED | 3 km returned exactly Dupont + Georgetown | — |
| 15 | GiST spatial index is genuinely used, not bypassed | VERIFIED | `EXPLAIN` shows `Index Scan using geo_smoke_geom_gist` | Forced via `enable_seqscan=off` (4-row table) |
| 16 | `geo_kernel_postgis.sql` applies cleanly and is idempotent | VERIFIED | Applied twice, second run clean | — |
| 17 | Geo smoke test passes 14/14 assertions | VERIFIED | `geo_smoke_test.sql` output | — |
| 18 | The smoke test is not vacuous — it fails when PostGIS is absent | VERIFIED | Negative control on a clean DB: exit 3, `GEO SMOKE FAIL` | Strongest single piece of evidence here |
| 19 | lat/lng → geom trigger prevents silent divergence | VERIFIED | Assertions 4–5 of the smoke test | — |
| 20 | Coordinate constraints reject lat 91 and Null Island (0,0) | VERIFIED | Assertion 8 | — |
| 21 | Duplicate provider alias is rejected (entity resolution intact) | VERIFIED | Assertion 10 | — |
| 22 | New claims default to UNKNOWN and not decision-eligible | VERIFIED | Assertion 9 | Enforces "no fabricated certainty" at storage layer |

## Code changes

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 23 | Prisma datasource switched to `postgresql` with `directUrl` + postgis extension | VERIFIED | `schema.prisma` diff | Not yet run through `prisma validate` (npm blocked) |
| 24 | Three geo models added (GeoEntity, GeoEntityAlias, GeoClaim) | VERIFIED | `schema.prisma` diff | Table DDL hand-verified; **`prisma migrate` not yet run** |
| 25 | Equivalent DDL creates successfully on real PostGIS | VERIFIED | Tables created and exercised in `cana_dev` | Hand-written mirror of expected Prisma output, not Prisma-generated |
| 26 | 12 user-facing `contains` filters given `mode: 'insensitive'` | VERIFIED | Diffs in 5 files | **Behaviour not yet test-executed** (npm blocked) |
| 27 | ID-matching `contains` deliberately left case-sensitive | VERIFIED | Reviewed each of the 5 remaining sites | Intentional |
| 28 | `db-inspect.mjs` and `test-public-submission.mjs` made engine-portable | VERIFIED | Diffs; `pg_tables` / `pg_indexes` branches | **Not yet executed** |
| 29 | Migration script refuses non-empty destination, verifies counts + invariants | PARTIAL | Code written and reviewed | **Never executed** — requires npm + a source .db |
| 30 | Geo backfill preserves provenance and marks legacy coords UNKNOWN | PARTIAL | Code written and reviewed | **Never executed** |

## Slice 1b — H3 as a real invariant

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.1 | h3 4.2.3 + h3_postgis extensions installed and enabled locally | VERIFIED | `h3_get_extension_version()` = 4.2.3 | Sandbox instance |
| 1b.2 | Known-vector conversion correct | VERIFIED | Dupont Circle (38.9097, −77.0434) res 9 → `892aa84edabffff` | — |
| 1b.3 | Round-trip sanity: cell centroid within one res-9 cell of input | VERIFIED | offset = 177.6 m (res-9 edge ≈ 174 m) | — |
| 1b.4 | Parent derivation works (res 9 → res 7) | VERIFIED | `872aa84edffffff`, resolution introspects as 7 | — |
| 1b.5 | h3R9 is DERIVED by trigger from lat/lng — not independently writable | VERIFIED | Smoke assertion: hand-written wrong h3R9 overwritten | Single-truth chain: lat/lng → geom → h3R9 |
| 1b.6 | Drift audit function reports divergence | VERIFIED | Forced drift (trigger disabled) detected — count = 1 | Falsification test, not happy-path |
| 1b.7 | Kernel refuses to provision without h3 (fail-closed) | VERIFIED | Negative control: exit 3 with explicit remediation message | — |
| 1b.8 | Extended smoke test passes | VERIFIED | 26/26 assertions incl. 2 falsification tests | — |
| 1b.9 | Neon supports h3 + h3_postgis on PG17 (4.1.3) | VERIFIED (docs) | neon.com/docs/extensions/pg-extensions, live-crawled 2026-08-08 | Documentation evidence, not yet executed on Neon |
| 1b.10 | `h3_lat_lng_to_cell` is valid on both 4.1.3 (Neon) and 4.2.3 (local) | VERIFIED | Current name on 4.1.3; deprecation warning only on 4.2.3 | Rename to `h3_latlng_to_cell` on next h3-pg major |

## Slice 1b — semantic audit and fixes

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.11 | Full-repo SQLite→PG semantic audit executed across 14 categories | VERIFIED | Audit report; 12 categories CLEAN, 5 findings | Static analysis + code reading; behavior not yet test-executed (npm blocked) |
| 1b.12 | HIGH: admin stale queue NULLS ordering flip | VERIFIED+FIXED | `admin/page.tsx` — `nulls: 'first'` added | Regression test written, not yet run |
| 1b.13 | HIGH: claim-approval email un-normalized → duplicate accounts possible | VERIFIED+FIXED | `admin-mutations.mjs` — lowercased at approval site | Same |
| 1b.14 | MEDIUM: ABCA ETL license-number case instability | VERIFIED+FIXED | Both ETL scripts uppercase before upsert/lookup | Same |
| 1b.15 | LOW: storage guards for lowercase email/domain | VERIFIED | Guards install + reject mixed-case insert + pre-flight refuses dirty data (all executed live) | Apply after data migration per runbook §4f |
| 1b.16 | Collation ordering (`name: 'asc'`) difference | VERIFIED, ACCEPTED RISK | Audit finding 2 | Production names consistently cased; revisit if ETL imports mixed case |
| 1b.17 | PostgreSQL regression test suite written (5 tests incl. 2 negative controls) | PARTIAL | `tests/postgres-semantics.test.mjs` | **Not executed** — npm blocked |

## Slice 1b — geo repository boundary

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.18 | Typed geo repository isolates all raw spatial SQL | VERIFIED (SQL), PARTIAL (JS) | All 4 SQL statements executed against live PostGIS with correct results (near-point ordering 1460 m/2737 m, viewport excludes Baltimore, res-7 aggregation, drift=0) | JS wrapper not executed (needs @prisma/client) |
| 1b.19 | Evidence-gated claim accessor is the only public-map read path | PLANNED (enforcement) | `findEligibleClaims` written; UNKNOWN-by-default | Enforcement lands with Slice 2 UI |

## Slice 1b — Neon policy verification

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.20 | Governing terms = Neon Product Specific Schedule (2026-08-05) + Databricks MCSA + Databricks AUP (2026-03-20) | VERIFIED (docs) | neon.com/platform-terms; databricks.com/legal/mcsa; databricks.com/legal/acceptable-use-policy — all read in full | — |
| 1b.21 | No cannabis/marijuana/controlled-substance/high-risk language in any governing document | VERIFIED (docs) | Full-text search of all three documents | Absence of prohibition ≠ permission |
| 1b.22 | Cannabis-business classification | **REQUIRES_CLARIFICATION** | Databricks AUP item 6 ("data…in violation of any law") is ambiguous vs federal Schedule I | Written confirmation needed before production launch |
| 1b.23 | Neon: pooler=PgBouncer transaction-mode; migrations need direct endpoint; pg_dump + logical replication available; us-east-1 confirmed; free tier 0.5 GB / 6 h PITR | VERIFIED (docs) | neon.com docs, live-crawled 2026-08-08 | — |

## Slice 2 foundation (map surface behind feature flag)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 2.1 | Leaflet parity inventory produced from code inspection (P1–P10) | VERIFIED | `docs/geo/SLICE2_MAP_PARITY.md`; every row cites the file | Parity gate G1–G10 not yet executable (npm) |
| 2.2 | PublicMapProjection evidence gate implemented and **executed**: 14/14 tests pass with bare node, incl. 5 falsification tests (ineligible/unverified/stale/off-allowlist claims refused; Null Island unmappable) | VERIFIED | `node --test tests/public-map-projection.test.mjs` → pass 14 | Pure-logic layer; DB integration pending npm |
| 2.3 | Missing claims render as ABSENT keys → UI must show explicit unknown; no fabricated "Open now" possible through this layer | VERIFIED | Test: "missing claims render as ABSENT keys" | Enforcement depends on components consuming only the projection |
| 2.4 | MapLibre surface written: markers as focusable buttons, evidence badges, explicit unknown status line, error state (no silent blank map), scroll-hijack off, fit-bounds parity | PARTIAL | `retailer-map-maplibre.tsx` | **Not compiled, not rendered** — maplibre-gl not installable (npm blocked) |
| 2.5 | Engine switch: CANA_MAP_ENGINE env, default leaflet, Leaflet untouched, rollback = unset env | VERIFIED (code) | `retailer-map-loader.tsx`, `tile-sources.mjs`, page wiring | Runtime behavior unverified until build |
| 2.6 | Provider-neutral basemap factory: carto-raster (today's exact tiles, keyless) / maptiler / pmtiles as config | VERIFIED (code) | `tile-sources.mjs` | maptiler/pmtiles paths unexercised |
| 2.7 | Viewport API with bounded results, area ceiling, cache headers, no-SQL-leak error path | PARTIAL | `api/geo/viewport/route.ts`; underlying SQL executed live in 1b.18 | Route handler itself not bootable yet |

## Slice 3 foundation (routing contract)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 3.1 | Provider-neutral routing contract with registry + config selection | VERIFIED | `routing-provider.mjs`; 6/6 tests **executed** | No real network adapter yet — by design |
| 3.2 | Truth law encoded: adapters must return UNKNOWN rather than fake travel times; straight-line allowed only as labeled lower bound | VERIFIED | Tests: null provider returns UNKNOWN, travelTimeSeconds=null | Valhalla/OSRM adapters are Slice 3 execution work |
| 3.3 | Haversine lower bound agrees with PostGIS geography within 1% (1460 m pair) | VERIFIED | Executed test cross-checks ledger claim 13 | — |

## PATH A gate execution (2026-08-09, local PostgreSQL 17.8 + PostGIS 3.5.6 + h3 4.2.3)

Every row below was EXECUTED and its output observed. Nothing is projected.

| # | Gate | Result | Receipt |
|---|---|---|---|
| A.1 | npm install | PASS | 437 packages, 15 s, 0 peer warnings; lockfile delta +223 lines (maplibre-gl tree only) |
| A.2 | prisma validate | PASS | "schema is valid" |
| A.3 | prisma generate | PASS | client v6.19.3 |
| A.4 | Baseline migration generated + applied | PASS | `20260809072622_postgres_baseline_with_geo_kernel` — 26 CREATE TABLE/EXTENSION statements incl. `CREATE EXTENSION postgis` |
| A.5 | Geo kernel + 26-assertion smoke test on app DB | PASS | `GEO SMOKE TEST PASSED` |
| A.6 | Seed against PostgreSQL | PASS | full seed completed |
| A.7 | Semantics guards installed | PASS | `POSTGRES SEMANTICS GUARDS INSTALLED` |
| A.8 | Geo backfill | PASS | 5 created, 0 skipped; geom+h3R9 derived 5/5; drift = 0 |
| A.9 | **All node:test suites** | **PASS 233/233** (after classified fixes below) | `ℹ pass 233, fail 0` |
| A.10 | PostgreSQL regression suite | PASS 6/6 | dupont→Dupont verified live; bare-contains negative control held |
| A.11 | Geo + routing suites | PASS 20/20 | — |
| A.12 | test:db scripts | PASS | 19/19 PASS lines, exit 0 |
| A.13 | typecheck (tsc --noEmit) | PASS | exit 0 (after 3 literal-type fixes, below) |
| A.14 | lint | PASS | 0 errors, 5 pre-existing `<img>` warnings |
| A.15 | production build | PASS | exit 0, all routes compiled |
| A.16 | **application boot against PostgreSQL** | PASS | `/api/health` → `{"status":"HEALTHY","services":{"database":{"status":"UP","brandCount":10,"totalRetailers":5}}}` |
| A.17 | DB-backed routes | PASS | homepage 200, retailer detail 200 |
| A.18 | Geo viewport API live | PASS | 5 canonical entities with h3R9, verification honest UNKNOWN, 30 ms; too-large box → 400; bad params → 400 |
| A.19 | test:http gate | PASS | exit 0, 67 PASS, 0 FAIL |
| A.20 | **Migration rehearsal** (base-commit SQLite → PostgreSQL) | PASS | `MIGRATED_AND_VERIFIED`: 22 tables, 252 rows, 0 mismatches; FK orphans 0/0/0; exact UUID + epoch-ms + coordinate fidelity; see `docs/migration/REHEARSAL_RECEIPT.md` |
| A.21 | Rehearsal DB geo chain | PASS | backfill 5/5, drift 0, smoke 26/26, guards installed, regression suite 6/6 on migrated data |

### Failure classification (initial run: 233 tests, 5 failures → all resolved)

| Failure | Classification | Proof | Resolution |
|---|---|---|---|
| `merchant-dashboard.test.mjs` catalog where-shape | **EXPECTED CHANGE, test updated** | Test asserted the pre-migration SQLite where-shape verbatim; the `mode:'insensitive'` addition is the audited, deliberate fix | Test now encodes the new shape with rationale |
| 4 × `product-benchmark.test.mjs` | **INFRASTRUCTURE (test harness), ported** | Harness provisioned its own `benchmark.sqlite` + `db push` — impossible against a postgresql schema by construction, NOT a code regression | Harness ported to disposable PostgreSQL databases (create/drop per run, FORCE cleanup); sanctioned `CANA_BENCHMARK_DATABASE_URL` pass-through documented; **12/12 scenarios PASS incl. all three controlled-regression falsification runs; safety receipt intact (0 credential-named vars, 0 non-loopback requests, temp DB dropped)** |
| 3 tsc literal-type errors | **EXPECTED (JS/TS boundary)** | `.mjs` literals widen to `string` crossing into typed TSX | JSDoc const casts; tsc exit 0 |
| 1 eslint error (sync setState in effect) | **REGRESSION in new Slice 2 component, fixed** | Introduced by me in `retailer-map-maplibre.tsx` | `queueMicrotask` defer; 0 errors |

## Blocked

| # | Claim | Status | Evidence | Unblock |
|---|---|---|---|---|
| 31 | Managed PostgreSQL provisioned for production | BLOCKED | — | Human: create DB, supply `DATABASE_URL` + `DIRECT_URL` (see runbook §8) |
| 32 | Existing test suites pass on PostgreSQL | ~~BLOCKED~~ **RESOLVED — see PATH A.9** | 233/233 | npm access granted 2026-08-09 |
| 33 | tsc/lint/build pass | ~~BLOCKED~~ **RESOLVED — see PATH A.13–A.15** | exit 0 each | — |
| 34 | prisma migrate baseline | ~~BLOCKED~~ **RESOLVED — see PATH A.4** | `20260809072622_postgres_baseline_with_geo_kernel` | — |
| 35 | Provider cannabis-AUP written confirmation obtained | BLOCKED | ADR-0002 records the policy research | Human/legal action |

## Not built — designed only

| # | Item | Status | Note |
|---|---|---|---|
| 36 | MapLibre replacing Leaflet | PLANNED | Slice 2. Leaflet remains in place and working. |
| 37 | ~~H3 aggregation~~ | ~~PLANNED~~ **SUPERSEDED by 1b.1–1b.8** | h3R9 is now trigger-derived, invariant-audited, and falsification-tested. Cell-STATE aggregation (demand/supply scoring) remains PLANNED for Slice 5. |
| 38 | Routing, isochrones, Valhalla | PLANNED | Slice 3. No interface written yet. |
| 39 | GeoProvider registry/router, benchmark harness, promotion court | PLANNED | Slices 3 and 8. Not started. |
| 40 | GeoCell state, feature store, opportunity engine, simulation | PLANNED | Slices 5–7. Tables deliberately not invented ahead of use. |
| 41 | Living Company Graph geo edges | PLANNED | Slice 4. |

## Explicit non-claims

To keep the ledger honest, the following are **not** claimed:

- The application has **not** been booted against PostgreSQL.
- No existing test has been executed against PostgreSQL.
- No production data has been migrated.
- `h3R9` is a column, not a working H3 implementation.
- The map is still Leaflet; nothing user-facing changed in this slice.
- Provider claims in ADR-0002 are third-party documentation research, not
  independently reproduced benchmarks. No benchmark numbers were invented.
