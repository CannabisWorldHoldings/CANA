# CANA Geo Kernel — Evidence Ledger

Slice 1a + 1b: PostgreSQL + PostGIS canonical datastore migration and
foundation proof. Date: 2026-08-08. Base commit: `487ece6`.

Capability states use the repository-wide vocabulary:
**VERIFIED_IMPLEMENTED** · **PARTIALLY_IMPLEMENTED** · **PLANNED** ·
**RESEARCH_ONLY** · **BLOCKED** · **FALSIFIED**. Unknown evidence remains
**UNKNOWN** and unverified evidence remains **UNVERIFIED**.

No capability below is marked VERIFIED_IMPLEMENTED unless its implementation
was executed and its output observed. Static inspection alone is
PARTIALLY_IMPLEMENTED; third-party documentation is RESEARCH_ONLY.

---

## Current state assessment (before any change)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1 | `orderweeddc` is the CANA monorepo; npm workspaces `apps/web` + 3 packages | VERIFIED_IMPLEMENTED | Cloned repo, read root `package.json` | Historical baseline |
| 2 | Database was SQLite | VERIFIED_IMPLEMENTED | `schema.prisma` `provider = "sqlite"` | Historical baseline; no longer canonical |
| 3 | Map was Leaflet 1.9 + react-leaflet 5 + CARTO raster tiles | VERIFIED_IMPLEMENTED | `src/components/retailer-map.tsx`, `package.json` | Historical baseline |
| 4 | Geography was two bare `Float` columns; no geometry/cells/service areas | VERIFIED_IMPLEMENTED | `Retailer` model, grep across `src` | Historical baseline |
| 5 | No PostGIS, H3, routing, geocoding, or provider abstraction existed | VERIFIED_IMPLEMENTED | grep across `apps/web/src`, `packages` | Historical baseline |
| 6 | 22 Prisma models; 37 `node:test` suites; real gate culture exists | VERIFIED_IMPLEMENTED | schema enumeration, `apps/web/tests` listing | Historical baseline |
| 7 | Deploy target is Namecheap cPanel shared hosting | VERIFIED_IMPLEMENTED | `NAMECHEAP_CPANEL_DEPLOYMENT.md`, Prisma `binaryTargets` | Application host only; database is separate |
| 8 | Only 2 raw SQL call sites existed, both SQLite-specific, both in scripts | VERIFIED_IMPLEMENTED | grep for `$queryRaw`/`$executeRaw` | Historical baseline |
| 9 | 17 `contains` filters existed with zero `mode: 'insensitive'` | VERIFIED_IMPLEMENTED | grep across `src`, `scripts` | Historical defect, repaired below |

## PostGIS capability

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 10 | PostgreSQL 17.8 provisioned and running | VERIFIED_IMPLEMENTED | `SELECT version()` | **Disposable sandbox, not production** |
| 11 | PostGIS 3.5.6 enabled (GEOS 3.14.1, PROJ 9.8.1) | VERIFIED_IMPLEMENTED | `PostGIS_Full_Version()` | Disposable sandbox |
| 12 | `ST_Contains` polygon containment is correct | VERIFIED_IMPLEMENTED | DC quadrilateral test excluded Silver Spring, MD | Disposable sandbox |
| 13 | `ST_Distance` geography is geodesically correct | VERIFIED_IMPLEMENTED | Dupont Circle → White House = 1460 m | Matches real-world ~1.4–1.5 km |
| 14 | `ST_DWithin` radius filtering is correct | VERIFIED_IMPLEMENTED | 3 km returned exactly Dupont + Georgetown | Disposable sandbox |
| 15 | GiST spatial index is genuinely used, not bypassed | VERIFIED_IMPLEMENTED | `EXPLAIN` shows `Index Scan using geo_smoke_geom_gist` | Forced via `enable_seqscan=off` (4-row table) |
| 16 | `geo_kernel_postgis.sql` applies cleanly and is idempotent | VERIFIED_IMPLEMENTED | Applied twice, second run clean | Disposable sandbox |
| 17 | Geo smoke test passes 26/26 assertions | VERIFIED_IMPLEMENTED | `geo_smoke_test.sql` output; PATH A | Disposable sandbox |
| 18 | The smoke test is not vacuous — it fails when PostGIS is absent | VERIFIED_IMPLEMENTED | Negative control on a clean DB: exit 3, `GEO SMOKE FAIL` | Falsification control |
| 19 | lat/lng → geom trigger prevents silent divergence | VERIFIED_IMPLEMENTED | Assertions 4–5 of the smoke test | Disposable sandbox |
| 20 | Coordinate constraints reject lat 91 and Null Island (0,0) | VERIFIED_IMPLEMENTED | Assertion 8 | Disposable sandbox |
| 21 | Duplicate provider alias is rejected (entity resolution intact) | VERIFIED_IMPLEMENTED | Assertion 10 | Disposable sandbox |
| 22 | New claims default to UNKNOWN and not decision-eligible | VERIFIED_IMPLEMENTED | Assertion 9 | Enforces "no fabricated certainty" at storage layer |

## Code changes

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 23 | Prisma datasource switched to `postgresql` with `directUrl` + postgis extension | VERIFIED_IMPLEMENTED | `prisma validate`, generation, full verifier | Disposable and CI evidence; production unproven |
| 24 | Three geo models added (GeoEntity, GeoEntityAlias, GeoClaim) | VERIFIED_IMPLEMENTED | Fresh migration proof and full verifier | Production unproven |
| 25 | Canonical migration DDL creates successfully on real PostGIS | VERIFIED_IMPLEMENTED | PATH A fresh-database proof | Disposable sandbox |
| 26 | 12 user-facing `contains` filters given `mode: 'insensitive'` | VERIFIED_IMPLEMENTED | PostgreSQL regression suite; PATH A | Disposable sandbox |
| 27 | ID-matching `contains` deliberately left case-sensitive | VERIFIED_IMPLEMENTED | Reviewed sites and regression suite | Intentional |
| 28 | `db-inspect.mjs` and `test-public-submission.mjs` made engine-portable | VERIFIED_IMPLEMENTED | Full verifier and PATH A | SQLite is inspection-only |
| 29 | Migration script refuses non-empty destination, copies atomically, verifies counts + invariants | VERIFIED_IMPLEMENTED | PATH A migration rehearsal | Production data not migrated |
| 30 | Geo backfill preserves provenance and marks legacy coords UNKNOWN | VERIFIED_IMPLEMENTED | PATH A backfill, 5/5 with drift 0 | Disposable sandbox |

## Slice 1b — H3 as a real invariant

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.1 | h3 4.2.3 + h3_postgis extensions installed and enabled locally | VERIFIED_IMPLEMENTED | `h3_get_extension_version()` = 4.2.3 | Disposable sandbox |
| 1b.2 | Known-vector conversion correct | VERIFIED_IMPLEMENTED | Dupont Circle (38.9097, −77.0434) res 9 → `892aa84edabffff` | Disposable sandbox |
| 1b.3 | Round-trip sanity: cell centroid within one res-9 cell of input | VERIFIED_IMPLEMENTED | offset = 177.6 m (res-9 edge ≈ 174 m) | Disposable sandbox |
| 1b.4 | Parent derivation works (res 9 → res 7) | VERIFIED_IMPLEMENTED | `872aa84edffffff`, resolution introspects as 7 | Disposable sandbox |
| 1b.5 | h3R9 is DERIVED by trigger from lat/lng — not independently writable | VERIFIED_IMPLEMENTED | Smoke assertion: hand-written wrong h3R9 overwritten | Single-truth chain: lat/lng → geom → h3R9 |
| 1b.6 | Drift audit function reports divergence | VERIFIED_IMPLEMENTED | Forced drift (trigger disabled) detected — count = 1 | Falsification test |
| 1b.7 | Kernel refuses to provision without h3 (fail-closed) | VERIFIED_IMPLEMENTED | Negative control: exit 3 with explicit remediation message | Disposable sandbox |
| 1b.8 | Extended smoke test passes | VERIFIED_IMPLEMENTED | 26/26 assertions incl. 2 falsification tests | Disposable sandbox |
| 1b.9 | Neon supports h3 + h3_postgis on PG17 (4.1.3) | RESEARCH_ONLY | neon.com/docs/extensions/pg-extensions, live-crawled 2026-08-08 | Not executed on Neon |
| 1b.10 | `h3_lat_lng_to_cell` is valid on local h3 4.2.3 | VERIFIED_IMPLEMENTED | Local disposable execution | Neon 4.1.3 support remains RESEARCH_ONLY |

## Slice 1b — semantic audit and fixes

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.11 | Full-repo SQLite→PG semantic audit executed across 14 categories | PARTIALLY_IMPLEMENTED | Audit report; 12 categories CLEAN, 5 findings | Static analysis plus later regression coverage |
| 1b.12 | HIGH: admin stale queue NULLS ordering flip | VERIFIED_IMPLEMENTED | `nulls: 'first'`; PostgreSQL regression suite | Disposable sandbox |
| 1b.13 | HIGH: claim-approval email normalization | VERIFIED_IMPLEMENTED | lowercased at approval site; regression suite | Disposable sandbox |
| 1b.14 | MEDIUM: ABCA ETL license-number normalization | VERIFIED_IMPLEMENTED | ETL scripts and full verifier | No production import executed |
| 1b.15 | LOW: storage guards for lowercase email/domain | VERIFIED_IMPLEMENTED | Live disposable rejection and pre-flight | Apply after data migration per runbook §4f |
| 1b.16 | Collation ordering (`name: 'asc'`) difference | PARTIALLY_IMPLEMENTED | Audit finding 2 | Accepted risk; revisit if ETL imports mixed case |
| 1b.17 | PostgreSQL regression suite | VERIFIED_IMPLEMENTED | PATH A and full verifier | Disposable attested PostgreSQL only |

## Slice 1b — geo repository boundary

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.18 | Typed geo repository isolates all raw spatial SQL | VERIFIED_IMPLEMENTED | SQL statements plus JS wrapper executed by full verifier | Disposable sandbox |
| 1b.19 | Evidence-gated claim accessor is the only public-map read path | VERIFIED_IMPLEMENTED | projection tests and live viewport route | Production behavior unproven |

## Slice 1b — Neon policy verification

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 1b.20 | Governing terms research | RESEARCH_ONLY | third-party legal documents read 2026-08-08 | Not provider authorization |
| 1b.21 | No explicit cannabis term found in reviewed documents | RESEARCH_ONLY | Full-text search of three documents | Absence of prohibition is not permission |
| 1b.22 | Cannabis-business classification | BLOCKED | Legal ambiguity recorded | Written confirmation required before production |
| 1b.23 | Neon operational characteristics | RESEARCH_ONLY | Third-party docs, live-crawled 2026-08-08 | Not executed against Neon |

## Slice 2 foundation (map surface behind feature flag)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 2.1 | Leaflet parity inventory produced from code inspection (P1–P10) | PARTIALLY_IMPLEMENTED | `docs/geo/SLICE2_MAP_PARITY.md` | Browser parity acceptance remains pending |
| 2.2 | PublicMapProjection evidence gate implemented and executed | VERIFIED_IMPLEMENTED | full verifier projection tests and falsification cases | Production behavior unproven |
| 2.3 | Missing claims render as absent keys, never fabricated defaults | VERIFIED_IMPLEMENTED | projection tests | Component consumption remains part of release review |
| 2.4 | MapLibre surface implemented and compiled | PARTIALLY_IMPLEMENTED | production build and source | Browser parity acceptance remains pending |
| 2.5 | Engine switch defaults to Leaflet and is reversible | VERIFIED_IMPLEMENTED | build and loader tests | MapLibre promotion remains owner-gated |
| 2.6 | Provider-neutral basemap factory | PARTIALLY_IMPLEMENTED | factory tests/build | maptiler/pmtiles unexercised |
| 2.7 | Bounded no-store viewport API | VERIFIED_IMPLEMENTED | live PATH A route and release court | Production behavior unproven |

## Slice 3 foundation (routing contract)

| # | Claim | Status | Evidence | Limitations |
|---|---|---|---|---|
| 3.1 | Provider-neutral routing contract with registry + config selection | VERIFIED_IMPLEMENTED | routing tests | No real network adapter by design |
| 3.2 | Adapters return UNKNOWN rather than fabricated travel times | VERIFIED_IMPLEMENTED | routing tests | Valhalla/OSRM adapters remain PLANNED |
| 3.3 | Haversine lower bound agrees with disposable PostGIS within 1% | VERIFIED_IMPLEMENTED | executed cross-check | Disposable sandbox |

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
| 32 | Existing test suites pass on PostgreSQL | VERIFIED_IMPLEMENTED | PATH A and full verifier | Disposable sandbox |
| 33 | tsc/lint/build pass | VERIFIED_IMPLEMENTED | PATH A and full verifier | Exact candidate only |
| 34 | Prisma migration baseline | VERIFIED_IMPLEMENTED | fresh-database proof | Production migration not executed |
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

- The application and tests have run against disposable PostgreSQL only; no
  production deployment or production database access is claimed.
- No production data has been migrated.
- H3 is verified in disposable environments; managed-provider execution is
  still unverified.
- Leaflet remains the default map engine. MapLibre has compiled but has not
  passed the owner browser-parity promotion gate.
- Provider claims in ADR-0002 are third-party documentation research, not
  independently reproduced benchmarks. No benchmark numbers were invented.
