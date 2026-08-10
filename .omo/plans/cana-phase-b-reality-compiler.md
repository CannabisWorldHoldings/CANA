# CANA Phase B Slice 1 — Reality Compiler and Verification Loop

## TL;DR
> Summary:      Build the smallest offline-first path from the official DC ABCA ArcGIS layer to immutable evidence, exact entity resolution, additive `MarketClaim` records, independent verification, legacy `Retailer`/`GeoClaim` projections, ASK market-gap closure, and read-only Site Intelligence reflection. The implementation remains local and fixture-driven; it does not contact production, publish, spend, call a provider, or promote cognition.
> Deliverables:
> - One additive PostgreSQL migration for immutable source, observation, resolution, claim, evidence-link, and verification-event records beside `GeoClaim`
> - A hash-bound DC ABCA layer-31 snapshot and offline compiler; live capture is an explicit non-CI maintenance command
> - Exact-license sovereign resolution, an independent Verification Court, and a compatibility adapter into `Retailer` plus linked `GeoClaim`
> - Strict public-retailer truth gating, a real `ask_market_gap_recheck` consumer, Site Intelligence reality/reflection observations, and fail-closed retirement of legacy ABCA bypasses
> - Exact no-wildcard ownership, RED→GREEN receipts, migration/durability/full-gate proof, and a hash-indexed evidence packet
> Effort:       XL
> Risk:         High - this crosses canonical schema, immutable evidence, public truth, continuation concurrency, portability, and durability ownership boundaries.

## Scope
### Must have
- Preserve repository identity: branch `feat/reality-verification-engine`, base `74dd042f572f64e1da3709f71e602a9c0cda1917`, base tree `4596741c54beca9d20ae417877854e7cc39e1ff3`, with no work from unrelated PRs.
- Implement mandated Option B: additive market-evidence models beside `GeoClaim`; `GeoClaim` continues to own geographic assertions and receives only traceable compatibility projections.
- Use the official DCGIS ArcGIS layer 31 as the source contract, with explicit fields, deterministic ordering/pagination, raw bytes, request metadata, record count, retrieval time, source-modified time, and SHA-256 bound in an immutable manifest.
- Keep CI fully offline: tests and compilers consume only the committed snapshot; the capture command refuses `CI` and requires explicit network opt-in plus a new empty output directory.
- Store source snapshots, normalized observations, exact resolutions, versioned claims, claim-observation links, and verification events as append-only evidence; corrections create new versions instead of overwriting history.
- Resolve a source row only by exact normalized `ABCA_NUMBER` to `Retailer.licenseNumber` or an exact existing `GeoEntityAlias`; `GLOBALID`/`OBJECTID` remain aliases/source metadata and never sovereign identity.
- Quarantine missing, conflicting, out-of-bounds, or non-finite coordinates. Never substitute default coordinates and never create/link a public entity from name/address similarity.
- Make parser/compiler output non-public and `UNKNOWN`; only the separately invoked Verification Court may append an approval event and make a complete, current claim cohort projection-eligible.
- Project approved official cohorts transactionally into legacy `Retailer` fields and linked `GeoClaim` rows so current consumers remain compatible while provenance points back to the market claim and source snapshot.
- Make every customer-facing retailer discovery path require the same current/non-demo/freshness predicate as SEO and ASK.
- Run `ask_market_gap_recheck` inside the continuation transaction, close the opportunity/mission only when the reconstructed intent returns `verified_candidate_count > 0`, and otherwise preserve the OPEN gap with bounded recurrence.
- Represent `REFLECTION_ONLY` as a validated consumer/observation mode under the existing `OBSERVE_ONLY` authority ceiling, not as a new authority or promotion state.
- Expose reality-compiler and ASK-reflection counts in Site Intelligence without compiling, verifying, publishing, triggering providers, or changing market truth from Site Intelligence.
- Retire/fail-close `etl-abca-retailers.mjs`, `ingest-abca-feed.mjs`, and the old universe seed entrypoint; remove those bypasses from the production artifact.
- Produce the required evidence packet with source manifest, RED/GREEN output, exact changed-file ownership, migration proof, adversarial court proof, full verification, portability, durability, and zero-effect assertions.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No replacement or broadening of `GeoEntity`, `GeoEntityAlias`, or `GeoClaim`; no second canonical geo datastore, fuzzy identity service, or provider ID promoted to CANA identity (`apps/web/prisma/schema.prisma:576-679`).
- No live ArcGIS request in CI, tests, build, seed, migration, page render, ASK, continuation tick, or Site Intelligence collection.
- No parser-created verification event, `VERIFIED_CURRENT` retailer, `decisionEligible=true` claim, or public `GeoClaim`; parser and verifier may not be the same callable path.
- No name `contains`, address similarity, geocoding guess, centroid, `(38.9,-77.0)` fallback, or other invented location.
- No inference that a business absent from layer 31 is unlicensed or that layer 31 covers separately listed internet-only retailers; this slice compiles positive observations present in this one official layer only.
- No automatic merchant/menu creation, sponsorship change, paid/provider call, deployment, cPanel/hosted-database access, publishing, or production mutation (`AGENTS.md:42-68`).
- No winner memory, learning promotion, TruthGraph/cognition promotion, or claim that a closed ASK gap proves demand, revenue, ranking, conversion, or causality.
- No change to global no-edit courts except the user-mandated minimal `apps/web/tests/migration-court.test.mjs` extension for the exact fifth migration universe and append-only proof. Release, column-width, deployment, handoff, demand-credit, and unrelated courts remain untouched.
- No wildcard ownership, directory ownership, neighboring-path authority, verification bypass, or owner-gated action.
- No second Prisma migration, `prisma db push`, reset, destructive migration, or manual change to an already committed migration.
- No deletion of historical CSV bytes in this slice; leaving inert historical fixtures is allowed, but every executable legacy path must refuse.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Node built-in test runner, Prisma 6.19.3, disposable PostgreSQL/PostGIS courts, existing MariaDB/cPanel simulators, and CANA deterministic verifier profiles
- QA policy: every task has agent-executed scenarios
- Evidence: `<attemptDir>/task-<N>-<slug>.<ext>` — under ulw-loop, `<attemptDir>` is the `currentAttemptDir` from `omo ulw-loop status --json` (`.omo/evidence/ulw/<session>/<goalId>/a<attempt>`); outside ulw-loop use `.omo/evidence/`
- RED→GREEN rule: for Tasks 2-9, add/modify the named tests first, run the focused command and capture the expected named failure, then implement and capture the same command passing. A task without both receipts is incomplete.
- Exact runtime rule: the final packet records `process.version`, `process.execPath`, commit, tree, branch, and clean status; the container profiles remain pinned to Node 24.14.1 (`tools/test-runner/runner.mjs:14-24`, `tools/test-runner/container-verify.sh:49-66`).

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (serialized ownership admission; no implementation may precede it):
- Task 1: bind the exact Phase B file set and digests in durability ownership

Wave 2 (after Wave 1; independent foundations):
- Task 2: add the one canonical migration and immutable market-evidence schema
- Task 3: capture and validate the immutable official snapshot offline
- Task 4: implement exact source-record normalization and sovereign entity resolution
- Task 6: converge public retailer visibility on the strict truth predicate

Wave 3 (after relevant Wave 2 foundations):
- Task 5: persist claims, run the independent Verification Court, and project through the compatibility adapter; depends [2, 3, 4, 6]
- Task 8: extend Site Intelligence with schema-backed reality metrics and pure reflection observations; depends [2, 3, 6]

Wave 4 (integration closure):
- Task 7: wire the `REFLECTION_ONLY` ASK market-gap recheck consumer; depends [5, 6]
- Task 9: retire legacy import bypasses and exclude them from the artifact; depends [3, 5]

Wave 5 (after all implementation):
- Task 10: assemble the evidence packet and run every full gate; depends [1, 2, 3, 4, 5, 6, 7, 8, 9]

Critical path: Task 1 -> Task 2/3/4/6 -> Task 5 -> Task 7 -> Task 10

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1 | none | 2, 3, 4, 6 | none |
| 2 | 1 | 5, 8 | 3, 4, 6 |
| 3 | 1 | 5, 8, 9 | 2, 4, 6 |
| 4 | 1 | 5 | 2, 3, 6 |
| 5 | 2, 3, 4, 6 | 7, 9 | 8 |
| 6 | 1 | 5, 7, 8 | 2, 3, 4 |
| 7 | 5, 6 | 10 | 9 |
| 8 | 2, 3, 6 | 10 | 5, 9 |
| 9 | 3, 5 | 10 | 7, 8 |
| 10 | 1-9 | final verification | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Admit the exact no-wildcard Phase B ownership lane

  What to do: Add `PHASE_B_SLICE1_ASSIGNMENT = "phase_b_reality_compiler_slice1_2026_08_09"`, the verified base commit/tree, and one ordered `PHASE_B_SLICE1_AUTHORIZED_PATHS` array to `tools/durability/cli.mjs`. The exact set is: `.github/workflows/cana-verify.yml`; `apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/manifest.json`; `apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/snapshot.json`; `apps/web/prisma/migration-manifest.json`; `apps/web/prisma/migrations/20260810000000_market_reality_compiler/migration.sql`; `apps/web/prisma/schema.prisma`; `apps/web/scripts/capture-dc-abca-snapshot.mjs`; `apps/web/scripts/compile-market-reality.mjs`; `apps/web/scripts/continuation-tick.mjs`; `apps/web/scripts/etl-abca-retailers.mjs`; `apps/web/scripts/ingest-abca-feed.mjs`; `apps/web/scripts/seed-abca-retailers.mjs`; `apps/web/scripts/verify-market-reality.mjs`; `apps/web/src/lib/ask/ask-work.mjs`; `apps/web/src/lib/ask/market-gap-recheck.mjs`; `apps/web/src/lib/continuation/continuation-consumers.mjs`; `apps/web/src/lib/continuation/continuation-repository.mjs`; `apps/web/src/lib/public-retailer.mjs`; `apps/web/src/lib/reality/entity-resolution.mjs`; `apps/web/src/lib/reality/market-claim-adapter.mjs`; `apps/web/src/lib/reality/market-claim-court.mjs`; `apps/web/src/lib/reality/official-source-snapshot.mjs`; `apps/web/src/lib/reality/reality-repository.mjs`; `apps/web/src/lib/site-intelligence.mjs`; `apps/web/src/lib/site-intelligence.server.ts`; `apps/web/tests/ask-market-gap-recheck.test.mjs`; `apps/web/tests/legacy-abca-etl.test.mjs`; `apps/web/tests/market-reality-court.test.mjs`; `apps/web/tests/market-reality.test.mjs`; `apps/web/tests/official-source-snapshot.test.mjs`; `apps/web/tests/public-retailer.test.mjs`; `apps/web/tests/site-intelligence.test.mjs`; `deploy/namecheap/artifact-exclusions.test.mjs`; `deploy/namecheap/build-artifact.mjs`; `docs/RSI_SITE_INTELLIGENCE_LINEAGE.md`; `docs/capabilities/cana.ask-orderweeddc.contract.json`; `docs/capabilities/cana.continuation-kernel.contract.json`; `docs/migration/SQLITE_TO_POSTGRES.md`; `docs/reality/PHASE_B_SLICE1_CONTRACT.md`; `tools/durability/cli.mjs`; `tools/durability/cli.test.mjs`; `tools/mariadb-sim/generate-schema.mjs`; `tools/mariadb-sim/schema.prisma`; `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`. Add the same exact paths once to the appropriate create/modify and planned arrays, with no glob. Add validation for exact keys, exact list/order, unique normalized relative paths, no wildcard/neighbor, `base_commit=74dd042...`, `base_tree=4596741...`, and an authorization effect that explicitly denies network/provider/paid/production/publishing/promotion authority. Generate both approval and changed-file digests with the existing canonical-JSON algorithm, then bind them in the JSON and constants. Add RED-first durability tests for a neighbor, wildcard, missing path, duplicate, digest tamper, base drift, and authority broadening.

  The exact set above must also include `.omo/plans/cana-phase-b-reality-compiler.md`, `tools/reality/verify-evidence-packet.mjs`, and `tools/reality/verify-evidence-packet.test.mjs`; these three paths are part of the same ordered no-wildcard array, create/modify lists, planned list, and digests. Commit the plan in Task 1 so it cannot leave the candidate dirty during clean-tree verification.

  Must NOT do: Do not reuse the broad PR35 list as Phase B authority; do not admit global-no-edit paths or invent a court-blob exception; do not treat ownership as runtime/external authority.

  Parallelization: Can parallel: NO | Wave 1 | Blocks: [2, 3, 4, 6] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `tools/durability/cli.mjs:20-42` - assignment names and bound approval/scope digests
  - Pattern:  `tools/durability/cli.mjs:171-185` - exact M001 no-wildcard authorized-path array
  - Pattern:  `tools/durability/cli.mjs:646-715` - exact-key/path/authority validation
  - Pattern:  `tools/durability/cli.mjs:821-895` - canonical JSON digest recomputation
  - Test:     `tools/durability/cli.test.mjs:654-741` - exact-path, neighbor, wildcard, tamper, duplicate, and removal courts
  - API/Type: `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json:934-963` - immutable global prohibitions and owner-gated effects

  Acceptance criteria (agent-executable only):
  - [ ] `node --test tools/durability/cli.test.mjs` passes after the new tests were first captured RED.
  - [ ] A Node one-liner using the `canonicalJson` algorithm at `tools/durability/cli.mjs:273-282` prints the exact same assignment digest stored in both the manifest and `PHASE_B_SLICE1_ASSIGNMENT_SHA256`, and the exact same root/owned-arrays digest stored in `CHANGED_FILE_OWNERSHIP_SHA256`.
  - [ ] `node --input-type=module -e "import fs from 'node:fs'; const o=JSON.parse(fs.readFileSync('tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json')); const a=o.explicit_user_assignment.phase_b_reality_compiler_slice1_2026_08_09.authorized_paths; if(a.length!==new Set(a).size||a.some(p=>p.includes('*')||p.startsWith('/')||p.includes('..'))) process.exit(1); console.log(a.length)"` exits 0.
  - [ ] `git diff --name-only 74dd042f572f64e1da3709f71e602a9c0cda1917...HEAD` contains no unowned path when evaluated by `unownedPaths`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: exact Phase B assignment validates
    Tool:     bash
    Steps:    Run `node --test tools/durability/cli.test.mjs 2>&1 | tee <attemptDir>/task-1-ownership.txt`.
    Expected: Exit 0; the Phase B exact-path test passes and reports no wildcard or neighbor admission.
    Evidence: <attemptDir>/task-1-ownership.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: scope broadening fails closed
    Tool:     bash
    Steps:    Run the named Phase B tamper test with `node --test --test-name-pattern='Phase B.*(wildcard|authority|tamper)' tools/durability/cli.test.mjs 2>&1 | tee <attemptDir>/task-1-ownership-error.txt`.
    Expected: Exit 0 because each injected wildcard, neighboring path, changed base, and broadened authority is rejected by the validator.
    Evidence: <attemptDir>/task-1-ownership-error.txt
  ```

  Commit: YES | Message: `chore(ownership): admit exact phase b reality compiler paths` | Files: [`.omo/plans/cana-phase-b-reality-compiler.md`, `tools/durability/cli.mjs`, `tools/durability/cli.test.mjs`, `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`]

- [ ] 2. Add the single immutable market-evidence migration

  What to do: Write `apps/web/tests/market-reality-court.test.mjs` schema/migration assertions first. Its `before` hook must call `startDisposablePostgres({ label: 'marketreality', publishLoopback: true })`, export the returned `databaseUrl` to both `DATABASE_URL` and `DIRECT_URL`, and deploy migrations; its `after` hook must disconnect Prisma and call `stopDisposablePostgres`, failing if teardown leaves the container. Add exactly one migration, `20260810000000_market_reality_compiler`, and update only its SHA-256 entry in `migration-manifest.json`. Update the existing string-vocabulary comments so Opportunity includes `CLOSED` and ContinuationReceipt includes `REFLECTED`; these are application states, not new database enums. Add these models to the canonical schema:
  - `MarketSourceSnapshot`: `id`, `sourceKey`, `sourceUrl`, `queryParameters @db.Text`, `fetchedAt`, `sourceModifiedAt?`, `payloadSha256`, `payloadBytes`, `recordCount`, `schemaVersion`, `payloadJson @db.Text`, `createdAt`; unique `[sourceKey,payloadSha256]`; source/fetch index; relations to observations/resolutions.
  - `MarketObservation`: `id`, `snapshotId`, `sourceRecordKey`, `sourceObjectId?`, `observationType`, `observedValue @db.Text`, `normalizedValue @db.Text`, `observedAt`, `freshnessExpiresAt`, `sourceRecordSha256`, `parserVersion`, `createdAt`; unique `[snapshotId,sourceRecordKey,observationType]`; snapshot FK `Restrict`.
  - `MarketEntityResolution`: `id`, `snapshotId`, `sourceRecordKey`, `externalNamespace`, `externalId`, `status`, `method`, `retailerId?`, `geoEntityId?`, `evidenceSha256`, `createdAt`; unique `[snapshotId,sourceRecordKey]`; optional `Retailer`/`GeoEntity` FKs `Restrict` and reverse relations.
  - `MarketClaim`: `id`, `tenant`, `claimKey`, `claimType`, `claimValue @db.Text`, `version`, `resolutionId`, `snapshotId`, `supersedesClaimId?`, `freshnessExpiresAt`, `confidence?`, `uncertainty`, `createdAt`; unique `[tenant,claimKey,version]`; self-version relation; evidence and verification relations.
  - `MarketClaimEvidence`: composite ID `[claimId,observationId]`, both FKs `Restrict`.
  - `MarketVerificationEvent`: `id`, `claimId`, `decision`, `publicEligible=false`, `verifier`, `courtVersion`, `verifiedAt`, `evidenceSha256`, `detail @db.Text`, `createdAt`; unique `[claimId,evidenceSha256]`; claim FK `Restrict`.
  - Add optional unique `marketClaimId` plus relation on `GeoClaim` so the compatibility row is traceable one-to-one to its market claim.
  Add PostgreSQL `BEFORE UPDATE OR DELETE` refusal triggers for the six new evidence tables; verified projections remain mutable only in the legacy `Retailer`/`GeoClaim` compatibility layer. Regenerate the MariaDB candidate and add all new unbounded text fields to its generator mapping. Derive the migration digest with Node SHA-256, update the manifest, then run the canonical universe validator.

  Must NOT do: Do not add a second datasource, migration, enum-backed authority, fuzzy index, writable snapshot update path, or PostGIS dependency to the new market tables. Do not edit existing migrations. The only migration-court change is the required fifth-migration and append-only coverage.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 8] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/prisma/schema.prisma:597-679` - canonical GeoEntity/alias/GeoClaim provenance, eligibility, and indexes
  - Pattern:  `apps/web/prisma/schema.prisma:707-844` - plain-string/append-only kernel conventions and opportunity state
  - Pattern:  `apps/web/prisma/migration-manifest.mjs:37-83` - exact migration universe and SQL digest validator
  - Test:     `apps/web/tests/migration-manifest.test.mjs:36-88` - missing/unexpected/reordered/tampered migration refusals
  - Test:     `apps/web/tests/migration-court.test.mjs:319-428` - existing automatic empty/populated forward-migration and truth-preservation proof
  - Pattern:  `tools/mariadb-sim/generate-schema.mjs:5-57` - generated provider candidate and text-field mapping
  - External: `https://www.prisma.io/docs/orm/prisma-migrate/workflows/generating-down-migrations` - migration workflow reference; repository rules still require committed forward migrations only

  Acceptance criteria (agent-executable only):
  - [ ] `node apps/web/prisma/migration-manifest.mjs` exits 0 and the manifest contains exactly five ordered migrations, with the new migration last.
  - [ ] `cd apps/web && npx --no-install prisma validate && npx --no-install prisma generate` exits 0 with both `DATABASE_URL` and `DIRECT_URL` pointed to the disposable PostgreSQL URL.
  - [ ] `node tools/mariadb-sim/generate-schema.mjs && git diff --exit-code -- tools/mariadb-sim/schema.prisma` exits 0 after the generated file is committed.
  - [ ] On a disposable PostgreSQL database, `prisma migrate deploy` applies all five migrations; direct UPDATE and DELETE attempts against every new evidence table fail with `CANA_MARKET_EVIDENCE_IMMUTABLE`.
  - [ ] `node --test apps/web/tests/migration-manifest.test.mjs` and the schema/immutability subset of `market-reality-court.test.mjs` pass.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: fresh and populated databases accept the one forward migration
    Tool:     bash
    Steps:    Run `node --test apps/web/tests/market-reality-court.test.mjs 2>&1 | tee <attemptDir>/task-2-market-schema.txt`; the court's owned `before`/`after` hooks start, migrate, and destroy the loopback disposable PostgreSQL container.
    Expected: Exit 0; all six models, relations, unique constraints, migration rows, and immutable triggers are present.
    Evidence: <attemptDir>/task-2-market-schema.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: mutation and migration tampering are refused
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(immutable|migration manifest)' apps/web/tests/market-reality-court.test.mjs apps/web/tests/migration-manifest.test.mjs 2>&1 | tee <attemptDir>/task-2-market-schema-error.txt`.
    Expected: Exit 0 because UPDATE/DELETE, unexpected migration, reordered manifest, and changed SQL digest fixtures all fail with the named refusal.
    Evidence: <attemptDir>/task-2-market-schema-error.txt
  ```

  Commit: YES | Message: `feat(reality): add immutable market evidence schema` | Files: [`apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/20260810000000_market_reality_compiler/migration.sql`, `apps/web/prisma/migration-manifest.json`, `apps/web/tests/market-reality-court.test.mjs`, `tools/mariadb-sim/generate-schema.mjs`, `tools/mariadb-sim/schema.prisma`]

- [ ] 3. Capture and validate the official DC ABCA snapshot without CI network access

  What to do: Write `official-source-snapshot.test.mjs` first. Add a pure loader/validator and a maintenance-only capture command. The source key is `dcgis:abca:licensed-medical-cannabis-retailers:layer-31`; layer URL is the official endpoint below. The capture command must require `--allow-network`, refuse when `CI` is set, refuse an existing/non-empty output directory, fetch layer metadata plus paginated query pages using explicit `outFields=OBJECTID,GLOBALID,ABCA_NUMBER,FACILITY_NAME,FACILITY_TYPE,LICENSE_TYPE,EXPIRATION_DATE,ADDRESS,LATITUDE,LONGITDUE,TRADE_NAME,ENTITY_NAME,STATUS,ISSUE_DATE,EDITED,WARD,ENDORSEMENTS`, `where=1=1`, `orderByFields=OBJECTID`, and deterministic page sizes not exceeding `maxRecordCount`. Store a deterministic `snapshot.json` envelope containing the exact metadata and ordered query-page response bodies losslessly encoded as base64; the manifest binds the envelope plus every decoded raw response body by byte count and SHA-256. Store `schema_version`, endpoint, exact params, `fetched_at`, the mandated reviewed catalog date `source_catalog_modified_date=2026-06-05`, any actually supplied source-modified instant (or explicit `null`; never infer it from record `EDITED` values), page inventory, record count, byte counts, hashes, and field list in `manifest.json`. If current authoritative metadata contradicts the reviewed catalog date, stop and preserve both observations rather than relabeling bytes. The loader must recompute all manifest values and reject symlinks, path traversal, ArcGIS errors, duplicate IDs, missing required fields, incomplete pagination, non-monotonic OBJECTIDs, record-count drift, and digest drift. Tests monkeypatch network to throw and use only committed bytes.

  Must NOT do: Do not run live capture in CI/final gates, infer history from the `EDITED` field, treat `OBJECTID` as stable identity, rewrite an existing snapshot directory, or import/verify anything in this task.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 9] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - External: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31` - official licensed medical cannabis retailer Feature Layer
  - External: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31?f=pjson` - machine-readable layer metadata, fields, pagination, max record count, and time reference
  - External: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31/query` - ArcGIS query endpoint
  - External: `https://abca.dc.gov/page/retailer-license` - official ABCA retailer-license meaning
  - Pattern:  `apps/web/src/lib/data-status.mjs:37-76` - time validation and fail-closed truth style
  - Test:     `apps/web/tests/daypart-theme.test.mjs:180-218` - committed-byte SHA-256 regression pattern

  Acceptance criteria (agent-executable only):
  - [ ] `node --test apps/web/tests/official-source-snapshot.test.mjs` passes and performs zero network requests.
  - [ ] A Node SHA-256 recomputation of `snapshot.json` equals `manifest.json.payload_sha256`; byte count, record count, page count, exact fields, source URL, params, and source-modified value also match.
  - [ ] `CI=1 node apps/web/scripts/capture-dc-abca-snapshot.mjs --allow-network --output /tmp/cana-phase-b-refusal` exits nonzero with `CANA_OFFICIAL_SOURCE_NETWORK_REFUSED_IN_CI` before calling `fetch`.
  - [ ] Running the validator twice produces byte-identical normalized output and never changes the committed snapshot/manifest.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: committed official snapshot validates offline
    Tool:     bash
    Steps:    Run `node --test apps/web/tests/official-source-snapshot.test.mjs 2>&1 | tee <attemptDir>/task-3-official-snapshot.txt` with network unavailable.
    Expected: Exit 0; exact source/params/fields/hash/count/order checks pass and the test reports zero fetches.
    Evidence: <attemptDir>/task-3-official-snapshot.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: CI network and byte tampering fail closed
    Tool:     bash
    Steps:    Run the named tests with `node --test --test-name-pattern='(CI network|tampered|pagination|duplicate)' apps/web/tests/official-source-snapshot.test.mjs 2>&1 | tee <attemptDir>/task-3-official-snapshot-error.txt`.
    Expected: Exit 0 because capture refuses CI and the validator rejects altered bytes, incomplete pages, duplicate identity fields, and count drift with named error codes.
    Evidence: <attemptDir>/task-3-official-snapshot-error.txt
  ```

  Commit: YES | Message: `feat(reality): bind immutable dc abca source snapshot` | Files: [`apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/manifest.json`, `apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05/snapshot.json`, `apps/web/scripts/capture-dc-abca-snapshot.mjs`, `apps/web/src/lib/reality/official-source-snapshot.mjs`, `apps/web/tests/official-source-snapshot.test.mjs`, `docs/reality/PHASE_B_SLICE1_CONTRACT.md`]

- [ ] 4. Compile official rows into observations and exact sovereign resolutions

  What to do: Write pure and database tests first. Implement deterministic record canonicalization and observation emission for `LICENSE_NUMBER`, `LICENSE_TYPE`, `LICENSE_STATUS`, `LICENSE_EXPIRATION`, `FACILITY_NAME`, `LEGAL_ENTITY_NAME`, `POSTAL_ADDRESS`, and `COORDINATES`. Use `ABCA_NUMBER` as the normalized source record key; preserve `GLOBALID` and `OBJECTID` only as source metadata/aliases. The observation time is the manifest `fetched_at`; preserve record `EDITED` only inside raw evidence. Define `OFFICIAL_MARKET_TTL_MS = 30 * 24 * 60 * 60 * 1000`; set claim freshness to the earlier of `fetched_at + TTL` and a valid `EXPIRATION_DATE`, and make the court refuse `asOf < fetched_at` or `asOf >= freshnessExpiresAt`. A missing/invalid/past license expiration cannot support a current public cohort. Treat only the exact trimmed source status `Active` as an active-license claim; preserve every other status (including `Emergency Closure`) as non-active evidence. Coordinates are admitted only when both values are finite, within explicit DC bounds, and consistent with any returned point geometry; otherwise record a quarantine result and emit no coordinate claim. Resolution order is: exact `Retailer.licenseNumber`; exact `GeoEntityAlias(namespace='dc_abca_license',externalId=<ABCA_NUMBER>)`; otherwise create a new non-demo `Retailer` in `AWAITING_VERIFICATION` only when the complete required field cohort and real coordinates exist, then a `GeoEntity(verification='UNKNOWN')` and exact `dc_abca_license`/`dcgis_globalid` aliases. Existing exact matches are linked but not overwritten. Missing/ambiguous/duplicate exact identities become `UNRESOLVED` or `CONFLICTED`; names, addresses, and substring matches are forbidden. Never emit a negative/unlicensed claim for a record missing from the snapshot. `compile-market-reality.mjs` loads only a verified local snapshot, then one serializable transaction idempotently creates the snapshot row, observations, resolution rows, UNKNOWN version-1 claims and evidence links. Reimport of the same digest is a no-op with a receipt; a changed snapshot creates new evidence/versions without mutating old rows.

  Must NOT do: Do not set any verification/public eligibility, write `VERIFIED_CURRENT`, update an existing retailer by name, attach menus, invent coordinates, delete prior evidence, or import the Verification Court.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/prisma/schema.prisma:597-650` - sovereign GeoEntity identity and alias uniqueness
  - Pattern:  `apps/web/scripts/backfill-geo-entities.mjs:6-20` - observations-not-truth and retailerId-based deduplication precedent
  - Pattern:  `apps/web/scripts/etl-abca-retailers.mjs:67-141` - legacy exact-license-then-name behavior and coordinate default being replaced
  - Pattern:  `tools/growth-foundry/m001/claim-graph.mjs:306-358` - source hash, observation, subject/class, timestamp, TTL, and evidence linkage validation
  - Test:     `tools/growth-foundry/m001/claim-graph.test.mjs:310-377` - contradiction preservation and correction history precedent
  - API/Type: `apps/web/src/lib/geo/geo-repository.mjs:4-19` - canonical geo repository ownership boundary

  Acceptance criteria (agent-executable only):
  - [ ] Reality tests pass exact-license, exact-linked-alias, unmatched quarantine with no provisional retailer, conflict, invalid-coordinate, tenant idempotency, and versioning cases.
  - [ ] The disposable-PostgreSQL subprocess case in `market-reality-court.test.mjs` invokes `node apps/web/scripts/compile-market-reality.mjs --snapshot apps/web/fixtures/reality/dc-abca-layer-31/2026-06-05` twice against its owned URL, observes identical counts/no duplicates, and tears the container down.
  - [ ] After compilation, every `MarketClaim` has evidence links and zero `MarketVerificationEvent` rows; every created retailer is `AWAITING_VERIFICATION`, every created GeoEntity is `UNKNOWN`, and no public-eligible GeoClaim exists.
  - [ ] Static scan shows neither the parser nor compiler imports `market-claim-court.mjs`, writes `marketVerificationEvent`, or contains `VERIFIED_CURRENT`/`decisionEligible: true`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: offline compiler is deterministic and idempotent
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(compiler|resolution|idempotent)' apps/web/tests/market-reality.test.mjs apps/web/tests/market-reality-court.test.mjs 2>&1 | tee <attemptDir>/task-4-reality-compiler.txt`; the court hook owns database startup, migration, URL injection, teardown, and invokes the compiler twice.
    Expected: Exit 0; one snapshot cohort exists, repeated compilation is a no-op, exact identities resolve, and all claims remain UNKNOWN/unverified.
    Evidence: <attemptDir>/task-4-reality-compiler.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: fuzzy identity and fake coordinates are quarantined
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(fuzzy|coordinate|conflict|quarantine)' apps/web/tests/market-reality.test.mjs apps/web/tests/market-reality-court.test.mjs 2>&1 | tee <attemptDir>/task-4-reality-compiler-error.txt`.
    Expected: Exit 0 because same/similar names, substring licenses, missing coordinates, non-finite values, out-of-DC values, and conflicting exact aliases never produce a resolved public entity or coordinate claim.
    Evidence: <attemptDir>/task-4-reality-compiler-error.txt
  ```

  Commit: YES | Message: `feat(reality): compile official observations and exact entities` | Files: [`apps/web/scripts/compile-market-reality.mjs`, `apps/web/src/lib/reality/entity-resolution.mjs`, `apps/web/src/lib/reality/reality-repository.mjs`, `apps/web/tests/market-reality.test.mjs`, `apps/web/tests/market-reality-court.test.mjs`]

- [ ] 5. Verify claims independently and project through the GeoClaim compatibility adapter

  What to do: Write adversarial court tests first. Implement a pure `market-claim-court.mjs` that rereads the stored raw snapshot, recomputes manifest and record hashes, and independently checks each observation/value/resolution/claim/evidence link. It may approve only source-authoritative claim types from the exact official source, within freshness, with a complete exact resolution and no contradictory current observation. Parser/compiler modules cannot call or impersonate it. The write path `verify-market-reality.mjs` invokes the court separately and appends an immutable `MarketVerificationEvent` for every approval/rejection/conflict/stale decision. `market-claim-adapter.mjs` then selects only an all-approved cohort for the same resolution/snapshot: active license number/type/status, a current valid license expiration, facility name, postal address, and real coordinates. In one serializable transaction it maps provenance/freshness to the existing retailer truth fields, sets `VERIFIED_CURRENT` only while the court window is current, updates/creates the linked GeoEntity, and creates traceable GeoClaim compatibility rows for `licensed_in` and `located_at` using `marketClaimId`. An exact official non-active status such as `Emergency Closure` makes the matched retailer `DISPUTED` and all adapter-owned compatibility claims non-eligible; a stale/incomplete cohort makes adapter-owned projections `STALE`/non-eligible. Independently reviewed legacy evidence is never silently overwritten, but a current official contradiction still blocks public eligibility by setting `DISPUTED`. Corrections create new claim versions/events/compatibility rows; prior evidence is retained. Preserve M001 semantics for expiration, authority, conflicts, and corrections without importing M001 as live authority.

  Reuse the Task 2 `market-reality-court.test.mjs` lifecycle for every database-backed verifier/adapter case: its hooks start the disposable PostgreSQL instance, deploy the canonical migration set, inject URLs, and always disconnect/stop it. The verifier subprocess receives only that owned URL and the committed fixture clock; no manual or persistent database is a prerequisite.

  Must NOT do: Do not trust compiler-declared hashes/status, allow a parser call to append an event, approve merchant/self-submitted evidence as official truth, mark a partial cohort current, change sponsorship/menu state, or render a stale/superseded claim.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [7, 9] | Blocked by: [2, 3, 4, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `tools/growth-foundry/m001/claim-graph.mjs:500-577` - expiry, authority, conflicts, independent verification, and deterministic evaluation hashes
  - Pattern:  `tools/growth-foundry/m001/claim-graph.mjs:579-596` - correction appends new observations/claim/event without erasing prior evidence
  - Test:     `tools/growth-foundry/m001/claim-graph.test.mjs:194-308` - expiry, official-vs-merchant authority, and seven claim-class rules
  - API/Type: `apps/web/src/lib/geo/geo-repository.mjs:163-192` - only existing customer-facing eligible GeoClaim accessor
  - Pattern:  `apps/web/src/lib/geo/public-map-projection.mjs:24-123` - eligible/current/allowlisted claim projection and no coordinate fallback
  - Pattern:  `apps/web/src/lib/data-status.mjs:49-96` - legacy VERIFIED_CURRENT freshness resolution
  - Test:     `apps/web/tests/admin-mutations.test.mjs:453-530` - existing reviewed source/freshness field mappings

  Acceptance criteria (agent-executable only):
  - [ ] Focused court tests first fail with missing verifier/adapter behavior, then `node --test apps/web/tests/market-reality.test.mjs apps/web/tests/market-reality-court.test.mjs apps/web/tests/public-map-projection.test.mjs` passes.
  - [ ] Compiler-only execution produces zero events/current retailers/eligible GeoClaims; separate verifier execution produces events and projections only for complete approved cohorts.
  - [ ] A tampered manifest, raw row, parser version, observation value, evidence link, resolution, self-declared status, expired claim, contradictory value, or merchant source yields a non-public court decision and no legacy truth promotion.
  - [ ] Re-running verification/adaptation is idempotent; concurrent verifier runs create one event per `[claimId,evidenceSha256]` and one linked GeoClaim per `marketClaimId`.
  - [ ] `node apps/web/scripts/verify-market-reality.mjs --snapshot-sha <committed-sha> --as-of <fixture-time>` emits a JSON receipt containing counts by decision, projections, zero providers, zero spend, zero production effects, and no live-source access.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: independent court admits a complete official cohort
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(court approves|compatibility|projection)' apps/web/tests/market-reality.test.mjs apps/web/tests/market-reality-court.test.mjs apps/web/tests/public-map-projection.test.mjs 2>&1 | tee <attemptDir>/task-5-verification-court.txt`; the court hook owns database startup, migrations, compiler/verifier subprocesses, fixture clock, and teardown.
    Expected: Exit 0; approval events are append-only, the retailer is current only inside the window, and linked GeoClaims expose exact provenance with no fallback coordinates.
    Evidence: <attemptDir>/task-5-verification-court.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: parser self-verification and forged evidence fail closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(self-verification|forged|tampered|contradict|expired|partial)' apps/web/tests/market-reality.test.mjs apps/web/tests/market-reality-court.test.mjs 2>&1 | tee <attemptDir>/task-5-verification-court-error.txt`.
    Expected: Exit 0 because each forged or incomplete cohort produces REJECTED/CONFLICTED/STALE evidence and zero public projection.
    Evidence: <attemptDir>/task-5-verification-court-error.txt
  ```

  Commit: YES | Message: `feat(reality): verify and project official market claims` | Files: [`apps/web/scripts/verify-market-reality.mjs`, `apps/web/src/lib/reality/market-claim-court.mjs`, `apps/web/src/lib/reality/market-claim-adapter.mjs`, `apps/web/src/lib/reality/reality-repository.mjs`, `apps/web/tests/market-reality.test.mjs`, `apps/web/tests/market-reality-court.test.mjs`, `docs/reality/PHASE_B_SLICE1_CONTRACT.md`]

- [ ] 6. Close the public-retailer laundering gap across every customer consumer

  What to do: Write failing regressions showing stale/non-expiring previously verified records are currently discoverable. Refactor `publicRetailerWhere` to reuse `currentPublicRecordWhere(asOf)` by default and `isPubliclyDiscoverable` to reuse `isPubliclyVerified`. If local demonstration surfaces still need demos, expose an explicit `includeDemonstration` option defaulting false and prove no customer caller enables it. Keep the existing imports in directory search, tenant retailer, neighborhood search, product discovery, and retailer compare, but update static/behavioral tests to prove they all receive the strict predicate. Ensure compatibility-projected retailers and existing independently reviewed retailers remain visible only during a valid freshness window.

  Must NOT do: Do not weaken SEO/ASK, silently retain the old `{verifiedAt:not null}` gate, make demos public by default, or require MarketClaim rows for unrelated already-approved legacy records.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 7, 8] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/src/lib/public-retailer.mjs:8-39` - loose policy being corrected
  - Test:     `apps/web/tests/public-retailer.test.mjs:15-45` - stale-as-discoverable regression that must flip
  - API/Type: `apps/web/src/lib/seo-truth.mjs:1-17` - strict current, non-demo, verification, and expiry predicate
  - API/Type: `apps/web/src/lib/data-status.mjs:49-96` - strict post-query public verification
  - Pattern:  `apps/web/src/lib/ask/ask-service.mjs:109-147` - double query/post-query truth gate to match

  Acceptance criteria (agent-executable only):
  - [ ] `node --test apps/web/tests/public-retailer.test.mjs apps/web/tests/ask-service-where.test.mjs` passes after a captured RED showing stale laundering.
  - [ ] Records that are demo, AWAITING, DISPUTED, STALE, missing `verifiedAt`, missing expiry, expired at `asOf`, or future-verified are excluded from all customer consumers.
  - [ ] A real `VERIFIED_CURRENT` record with `verifiedAt <= asOf < freshnessExpiresAt` remains discoverable; the same record becomes invisible exactly at expiry.
  - [ ] Static import/call scan proves no customer module reconstructs or bypasses the predicate.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: current verified retailer remains discoverable
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='current verified' apps/web/tests/public-retailer.test.mjs apps/web/tests/ask-service-where.test.mjs 2>&1 | tee <attemptDir>/task-6-public-truth.txt`.
    Expected: Exit 0; every customer consumer admits the current non-demo fixture using the canonical predicate.
    Evidence: <attemptDir>/task-6-public-truth.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: stale and demonstration laundering is refused
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(stale|expired|demonstration|missing freshness)' apps/web/tests/public-retailer.test.mjs 2>&1 | tee <attemptDir>/task-6-public-truth-error.txt`.
    Expected: Exit 0 because every non-current fixture is absent and expiry is enforced at the exact boundary.
    Evidence: <attemptDir>/task-6-public-truth-error.txt
  ```

  Commit: YES | Message: `fix(truth): require current evidence for public retailers` | Files: [`apps/web/src/lib/public-retailer.mjs`, `apps/web/tests/public-retailer.test.mjs`]

- [ ] 7. Execute the ASK market-gap recheck as a bounded REFLECTION_ONLY consumer

  What to do: Write consumer and database concurrency tests first. Add a generic exact-name consumer dispatcher that parses `evidenceRequirements`, accepts only registered functions, and refuses malformed/unknown consumers. Do not add `REFLECTION_ONLY` to the authority rank; add it as an exact `loop_mode` in ASK evidence requirements while mission/trigger ceilings remain `OBSERVE_ONLY`. Implement `market-gap-recheck.mjs`: accept only a durable receipt ID hint, verify the complete receipt chain plus exact FIRED trigger, mission, tenant, tick, authority, evidence requirements, and opportunity bindings, then load the OPEN `MARKET_GAP`, validate/minimize stored intent evidence, find the exact canonical brand, and rerun `answerIntent` with the injected clock. Trigger firing remains truth-neutral. Consumer evaluation, opportunity/mission mutation, and the `REFLECTED` receipt share a separate serializable transaction. If count is positive, close the opportunity and mission and cancel remaining armed work. If zero, leave the opportunity OPEN/UNKNOWN. Forged, malformed, cross-tenant, wrong-tick, non-FIRED, tampered, or mismatched inputs refuse without mutation. Wire the default registry only in `continuation-tick.mjs`; tests may inject it.

  The `ask-market-gap-recheck.test.mjs` court owns its database lifecycle: in `before`, call `startDisposablePostgres({ label: 'askrecheck', publishLoopback: true })`, set `DATABASE_URL`/`DIRECT_URL`, and deploy the canonical migrations; in `after`, disconnect Prisma and call `stopDisposablePostgres`, failing on teardown or migration drift. No QA command may depend on a manually provisioned database.

  Must NOT do: Do not create merchants/menus/claims, change verification, publish, invoke live sources/providers, spend, raise authority, close on UNKNOWN, register `ask_capability_gap_recheck` as implemented, or promote any SiteMind/memory/cognitive state.

  Parallelization: Can parallel: YES | Wave 4 | Blocks: [10] | Blocked by: [5, 6]

  References (executor has NO interview context - be exhaustive):
  - API/Type: `apps/web/src/lib/ask/ask-work.mjs:45-69` - existing consumer names and stop/evidence contract
  - Pattern:  `apps/web/src/lib/ask/ask-work.mjs:79-190` - atomic opportunity/mission/trigger/signal producer
  - API/Type: `apps/web/src/lib/ask/ask-service.mjs:55-191` - exact evidence-gated recheck and closure condition
  - Pattern:  `apps/web/src/lib/continuation/continuation-repository.mjs:175-304` - exactly-once claim/receipt/reschedule transaction to extend
  - Pattern:  `apps/web/src/lib/continuation/continuation-storage.mjs:3-63` - serializable retries and hash-chained receipt append
  - Test:     `apps/web/tests/continuation-court.test.mjs:138-470` - exactly-once, restart, bounded recurrence, chain, and atomicity precedent; do not edit this global court
  - API/Type: `apps/web/prisma/schema.prisma:809-861` - Opportunity and AskIntentSignal persistence contracts

  Acceptance criteria (agent-executable only):
  - [ ] `node --test apps/web/tests/ask-market-gap-recheck.test.mjs apps/web/tests/continuation-core.test.mjs` passes after captured RED.
  - [ ] The database test proves two concurrent ticks yield one REFLECTED result, one close/completion at most, one valid receipt chain, and no successor after closure.
  - [ ] A zero-candidate recheck leaves the opportunity OPEN/UNKNOWN and produces one finite successor; after the existing recurrence budget is exhausted there is no further trigger.
  - [ ] Missing signal, malformed IR/requirements, wrong tenant, wrong kind, unknown consumer, or capability consumer never closes/reschedules and yields the exact fail-closed receipt.
  - [ ] Receipt/response scans show `loop_mode=REFLECTION_ONLY`, `authority_ceiling=OBSERVE_ONLY`, `provider_calls=0`, `spend_cents=0`, `production_effects=0`, and no learning/promotion field.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: verified supply closes a market gap exactly once
    Tool:     bash
    Steps:    Against the disposable DB fixture with one current tenant-linked retailer, run `node --test --test-name-pattern='closes.*exactly once' apps/web/tests/ask-market-gap-recheck.test.mjs 2>&1 | tee <attemptDir>/task-7-ask-reflection.txt`.
    Expected: Exit 0; one tick wins, the opportunity is CLOSED/VERIFIED, mission COMPLETED, receipt chain valid, and no successor exists.
    Evidence: <attemptDir>/task-7-ask-reflection.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: unknown or insufficient evidence cannot close the gap
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(persistent|malformed|cross-tenant|unknown consumer|capability)' apps/web/tests/ask-market-gap-recheck.test.mjs 2>&1 | tee <attemptDir>/task-7-ask-reflection-error.txt`.
    Expected: Exit 0; zero remains OPEN with bounded recurrence, while malformed/unauthorized consumers are REJECTED with no closure, effect, or authority escalation.
    Evidence: <attemptDir>/task-7-ask-reflection-error.txt
  ```

  Commit: YES | Message: `feat(continuation): close ask market gaps by reflection` | Files: [`apps/web/scripts/continuation-tick.mjs`, `apps/web/src/lib/ask/ask-work.mjs`, `apps/web/src/lib/ask/market-gap-recheck.mjs`, `apps/web/src/lib/continuation/continuation-consumers.mjs`, `apps/web/src/lib/continuation/continuation-repository.mjs`, `apps/web/tests/ask-market-gap-recheck.test.mjs`, `docs/capabilities/cana.ask-orderweeddc.contract.json`, `docs/capabilities/cana.continuation-kernel.contract.json`]

- [ ] 8. Surface reality and reflection state in Site Intelligence without promotion

  What to do: Write snapshot tests first. Extend the server collector with read-only counts for official snapshots, quarantined/unresolved/conflicted resolutions, total/current/verified/stale market claims, open/closed MARKET_GAP opportunities, and REFLECTED receipts. Extend deterministic observations with `OFFICIAL_SOURCE_FRESHNESS`, `MARKET_ENTITY_RESOLUTION`, `MARKET_CLAIM_COVERAGE`, and `ASK_MARKET_GAP_REFLECTION`; every summary must distinguish observed counts from real-world truth. Add a `Reflection` plane whose status is `READY` only for read/recheck receipts and whose proof states `REFLECTION_ONLY under OBSERVE_ONLY; no learning or promotion`. Keep prepared actions `PREPARE_ONLY`/`ADMIN_REVIEW_REQUIRED`. Update lineage docs and TypeScript shape. The collector may query only; snapshot persistence remains the existing bounded, fingerprinted transaction.

  Must NOT do: Do not call compile/verify/recheck from Site Intelligence, create opportunities/triggers/claims, change retailer/market state, infer demand/value, add winner memory, or label local evidence as external/live outcomes.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [10] | Blocked by: [2, 3, 6]

  References (executor has NO interview context - be exhaustive):
  - API/Type: `apps/web/src/lib/site-intelligence.mjs:122-147` - deterministic observation shape
  - Pattern:  `apps/web/src/lib/site-intelligence.mjs:154-363` - truth-bounded observation rules and closed production authority
  - Pattern:  `apps/web/src/lib/site-intelligence.mjs:366-426` - fingerprint and plane construction
  - Pattern:  `apps/web/src/lib/site-intelligence.server.ts:42-174` - parallel read-only metric collection
  - Test:     `apps/web/tests/site-intelligence.test.mjs:44-75` - determinism, blocked external gates, and PREPARE_ONLY checks
  - Pattern:  `docs/RSI_SITE_INTELLIGENCE_LINEAGE.md:22-43` - evidence-first observation and immutable snapshot lineage

  Acceptance criteria (agent-executable only):
  - [ ] `node --test apps/web/tests/site-intelligence.test.mjs` passes after captured RED and the same inputs/time yield the same fingerprint.
  - [ ] Tests prove all four new observations use only injected counts/evidence, expose uncertainty, and never claim live license state, demand, revenue, ranking, or causal effect.
  - [ ] Static mocks prove the collector invokes no create/update/delete/upsert, compiler, court, recheck, fetch, provider, or promotion function.
  - [ ] Existing snapshot persistence/audit/retention tests remain unchanged in meaning and pass.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Site Intelligence reports bounded reality/reflection metrics
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(reality|reflection|deterministic)' apps/web/tests/site-intelligence.test.mjs 2>&1 | tee <attemptDir>/task-8-site-intelligence.txt`.
    Expected: Exit 0; four new observations and the Reflection plane are deterministic, source-labeled, uncertain where appropriate, and PREPARE/READ only.
    Evidence: <attemptDir>/task-8-site-intelligence.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: Site Intelligence cannot promote or mutate
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(read-only|no promotion|untrusted actor)' apps/web/tests/site-intelligence.test.mjs 2>&1 | tee <attemptDir>/task-8-site-intelligence-error.txt`.
    Expected: Exit 0; mutation/provider/promotion spies remain at zero and untrusted persistence is rejected.
    Evidence: <attemptDir>/task-8-site-intelligence-error.txt
  ```

  Commit: YES | Message: `feat(sitemind): observe market reality reflection state` | Files: [`apps/web/src/lib/site-intelligence.mjs`, `apps/web/src/lib/site-intelligence.server.ts`, `apps/web/tests/site-intelligence.test.mjs`, `docs/RSI_SITE_INTELLIGENCE_LINEAGE.md`]

- [ ] 9. Retire legacy ABCA bypasses and keep live capture out of artifacts

  What to do: Write a spawning/static artifact test first. Replace the three legacy entrypoints with deterministic refusals: `CANA_LEGACY_ABCA_ETL_RETIRED` for `etl-abca-retailers.mjs`/`ingest-abca-feed.mjs`, and `CANA_LEGACY_ABCA_SEED_RETIRED` for `seed-abca-retailers.mjs`, each pointing to the offline compiler/verification commands. Remove the old seed script from `deploy/namecheap/build-artifact.mjs`; do not include the live capture script, raw snapshot, or verification maintenance script in the production artifact. Update the migration doc to describe exact-license compiler resolution and explicitly retire trade-name fallback. Add the new offline pure/unit tests to candidate CI, leaving network capture absent. Preserve historical CSV files as inert evidence only.

  Must NOT do: Do not delete historical inputs, delegate to old code behind a flag, permit environment bypasses, ship live-source capture, add a production cron, or fix unrelated deployment/security findings.

  Parallelization: Can parallel: YES | Wave 4 | Blocks: [10] | Blocked by: [3, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/scripts/etl-abca-retailers.mjs:67-141` - unsafe exact-license/name fallback and fake coordinates being made unreachable
  - Pattern:  `apps/web/scripts/ingest-abca-feed.mjs:11-50` - legacy mutable staging bypass
  - Pattern:  `apps/web/scripts/seed-abca-retailers.mjs:54-110` - mutable universe seed path being retired
  - Pattern:  `deploy/namecheap/build-artifact.mjs:450-470` - current script inclusion surface
  - Pattern:  `docs/migration/SQLITE_TO_POSTGRES.md:38-50` - stale trade-name-resolution documentation to correct
  - Test:     `deploy/namecheap/artifact-exclusions.test.mjs` - production artifact exclusion pattern
  - Pattern:  `.github/workflows/cana-verify.yml:18-30` - offline candidate-unit command

  Acceptance criteria (agent-executable only):
  - [ ] `node --test apps/web/tests/legacy-abca-etl.test.mjs deploy/namecheap/artifact-exclusions.test.mjs` passes after captured RED.
  - [ ] Spawning any legacy script with any documented old arguments exits nonzero with its exact retirement code before opening Prisma, reading CSV, or calling fetch.
  - [ ] A built artifact contains none of the three legacy scripts, the live capture script, raw official snapshot, or maintenance verifier; candidate CI runs only committed fixture tests and contains no capture invocation.
  - [ ] `rg -n "etl-abca-retailers|ingest-abca-feed|seed-abca-retailers" apps/web deploy docs` returns only retirement docs/tests/refusal modules, not an executable caller.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: supported offline pipeline remains documented and tested
    Tool:     bash
    Steps:    Run `node --test apps/web/tests/legacy-abca-etl.test.mjs deploy/namecheap/artifact-exclusions.test.mjs 2>&1 | tee <attemptDir>/task-9-legacy-retirement.txt`.
    Expected: Exit 0; the new offline compiler is the only admitted repository path and production artifact exclusions pass.
    Evidence: <attemptDir>/task-9-legacy-retirement.txt   (attemptDir = currentAttemptDir from `omo ulw-loop status --json`, .omo/evidence/ulw/<session>/<goalId>/a<attempt>)

  Scenario: every legacy entrypoint fails closed
    Tool:     bash
    Steps:    Spawn each legacy script under the test harness with old CSV/seed arguments and capture `node --test --test-name-pattern='refuses' apps/web/tests/legacy-abca-etl.test.mjs 2>&1 | tee <attemptDir>/task-9-legacy-retirement-error.txt`.
    Expected: Exit 0 because all subprocesses exit nonzero with the exact retirement code and record zero DB/network calls.
    Evidence: <attemptDir>/task-9-legacy-retirement-error.txt
  ```

  Commit: YES | Message: `refactor(ingestion): retire legacy abca bypasses` | Files: [`.github/workflows/cana-verify.yml`, `apps/web/scripts/etl-abca-retailers.mjs`, `apps/web/scripts/ingest-abca-feed.mjs`, `apps/web/scripts/seed-abca-retailers.mjs`, `apps/web/tests/legacy-abca-etl.test.mjs`, `deploy/namecheap/build-artifact.mjs`, `deploy/namecheap/artifact-exclusions.test.mjs`, `docs/migration/SQLITE_TO_POSTGRES.md`]

- [ ] 10. Assemble the Phase B evidence packet and run full release/durability gates

  What to do: First implement and test `tools/reality/verify-evidence-packet.mjs`. Its exact CLI is `node tools/reality/verify-evidence-packet.mjs --packet "$packetDir"`; it must reject missing/extra entries, symlinks, path escapes, byte/hash/count mismatches, command failures, mixed commit/tree identities, a base other than `74dd042f572f64e1da3709f71e602a9c0cda1917`, nonzero effects, and any ownership entry outside the exact manifest. Its unit test must construct a valid temporary packet and prove one-byte tamper, an extra file, a symlink, and an unowned path are rejected. Commit the verifier and its test before gathering evidence so the candidate worktree can be clean.

  On that exact clean candidate commit, create the packet outside the candidate worktree with `packetDir="$(mktemp -d "${TMPDIR:-/tmp}/cana-phase-b-evidence.XXXXXX")"`; never write evidence into `.omo/evidence` or any candidate path before or during clean-tree gates. Populate `identity.json`, `source-snapshot.json`, `red-green.json`, `migration-court.txt`, `reality-court.txt`, `ask-reflection.txt`, `site-intelligence.txt`, `candidate-unit.txt`, `focused.txt`, `full.txt`, `clean-clone.txt`, `release.txt`, `maria.txt`, `cpanel.txt`, `durability.txt`, `scope-diff.json`, and `MANIFEST.json`. `MANIFEST.json` must list each file, bytes, SHA-256, command, exit code, commit/tree, timestamp, and explicit effects `{network_live_source_calls:0, provider_calls:0, paid_calls:0, spend_cents:0, production_mutations:0, deployments:0, cognitive_promotions:0}`. Run the exact candidate-unit command from the workflow, all focused suites, migration/reality database courts, every CANA verifier profile, and durability build/verify/restore. Recompute the exact ownership diff from base, then run the packet verifier. Do not amend implementation to hide a red gate: return to its owning task and add a new RED→GREEN receipt.

  Must NOT do: Do not contact GitHub, production, hosted DB, cPanel, or the live ArcGIS layer; do not merge/deploy/push; do not describe local evidence as production proof; do not include secrets, database files, build caches, or node_modules in evidence.

  Parallelization: Can parallel: NO | Wave 5 | Blocks: [F1, F2, F3, F4] | Blocked by: [1, 2, 3, 4, 5, 6, 7, 8, 9]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `.github/workflows/cana-verify.yml:18-95` - candidate, focused, MariaDB, cPanel, and durability commands
  - Pattern:  `tools/test-runner/container-verify.sh:188-249` - profile-specific migration/build/test execution
  - Pattern:  `AGENTS.md:20-40` - canonical migration and full verification commands
  - Pattern:  `docs/DETERMINISTIC_TESTING.md:3-37` - receipt and isolated verifier contract
  - Pattern:  `tools/durability/cli.mjs:947-982` - outgoing changed-file ownership enforcement
  - Test:     `apps/web/tests/migration-court.test.mjs:627-789` - lock, interruption, rollback, and canonical migration coverage

  Acceptance criteria (agent-executable only):
  - [ ] `node --test tools/reality/verify-evidence-packet.test.mjs` passes, including valid packet, byte tamper, extra-file, symlink, and unowned-path fixtures.
  - [ ] `git status --porcelain` is empty; identity equals the candidate commit/tree under test; base remains `74dd042...`.
  - [ ] Candidate units, `npm test -w apps/web`, market courts, migration manifest/court, and all task-specific focused tests exit 0.
  - [ ] `./cana verify focused`, `full`, `clean-clone`, `release`, `maria`, and `cpanel` all exit 0 on the exact candidate.
  - [ ] `./cana durability build`, `verify`, and `restore --target <empty-dir>` pass; `assert-ci-durability.mjs` approves the receipts/restored tree.
  - [ ] `scope-diff.json` proves every changed path appears exactly once in the Phase B authorized set and no global-no-edit/unrelated path changed.
  - [ ] `node tools/reality/verify-evidence-packet.mjs --packet "$packetDir"` exits 0; `MANIFEST.json` lists both RED and GREEN receipts for Tasks 2-9 and asserts zero network/provider/paid/production/deployment/cognitive-promotion effects.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: exact candidate passes the complete offline verification battery
    Tool:     bash
    Steps:    Set `packetDir="$(mktemp -d "${TMPDIR:-/tmp}/cana-phase-b-evidence.XXXXXX")"`; run the workflow candidate-unit command, `cd apps/web && npm test`, then from repo root run `./cana verify focused`, `./cana verify full`, `./cana verify clean-clone`, `./cana verify release`, `./cana verify maria`, `./cana verify cpanel`, and the durability build/verify/restore/assert sequence, teeing each output to its named file under `$packetDir`; generate the manifest and run `node tools/reality/verify-evidence-packet.mjs --packet "$packetDir"`.
    Expected: Every command and the packet verifier exit 0 on one clean commit/tree; `git status --porcelain` remains empty; restored durability tree equals the candidate tree; no live-source call occurs.
    Evidence: `$packetDir/MANIFEST.json` (external temporary directory recorded in the final handoff)

  Scenario: evidence tamper and scope drift are detected
    Tool:     bash
    Steps:    Run `node --test tools/reality/verify-evidence-packet.test.mjs`; copy `$packetDir` to a second `mktemp -d` location, alter one receipt byte, run `node tools/reality/verify-evidence-packet.mjs --packet "$tamperedPacketDir"`, and retain its stderr as `$packetDir/tamper-check.txt`; run the ownership validator fixture with `apps/web/src/lib/reality-neighbor.mjs` and retain its expected rejection as `$packetDir/ownership-check.txt`; regenerate `MANIFEST.json` only for the canonical packet and re-run its verifier.
    Expected: Both checks exit nonzero with digest mismatch/unowned-path errors while the canonical packet remains unchanged and valid.
    Evidence: `$packetDir/tamper-check.txt` and `$packetDir/ownership-check.txt`
  ```

  Commit: YES | Message: `test(reality): verify phase b evidence packets` | Files: [`tools/reality/verify-evidence-packet.mjs`, `tools/reality/verify-evidence-packet.test.mjs`] (external `$packetDir/*` evidence is generated only after this commit and is never committed)

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - every task done, every acceptance criterion met
- [ ] F2. Code quality review - diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA - every QA scenario executed with evidence captured
- [ ] F4. Scope fidelity - nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Every AI commit includes `Co-Authored-By: OpenAI Codex <noreply@openai.com>` (`AGENTS.md:70-76`).
- Do not commit final evidence, databases, caches, or secrets. Task 10 evidence remains in its recorded external `$packetDir` and is hash-indexed; task-level RED/GREEN receipts may use `<attemptDir>` before the final clean candidate is formed.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/cana-phase-b-reality-compiler.md`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
- The official-source snapshot is exact and immutable, CI is offline, parser output is never self-verified, entity links are exact, and invalid coordinates remain quarantined.
- Public retailers and GeoClaims are current only through a complete independently approved cohort; stale/demo/partial/forged data cannot leak.
- ASK MARKET_GAP closes only on verified current tenant supply, and the REFLECTION_ONLY loop records bounded evidence without effects or cognitive promotion.
- All ownership, migration, portability, full verifier, and durability gates approve the exact clean candidate.
