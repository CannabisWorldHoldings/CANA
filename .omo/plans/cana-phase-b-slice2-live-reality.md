# CANA Phase B Slice 2 — Bounded Live Reality Acquisition

## TL;DR
> Summary:      Starting from exact base `e3139d960b837a8ea7ef7f01acfab5111dd96cc7`, add a bounded, operator-invoked live acquisition path for the one admitted DC ABCA ArcGIS layer. Preserve immutable content separately from acquisition attempts, renew freshness only through independent revalidation, deduplicate ASK work at a canonical Answerability Frontier, retain `REFLECTION_ONLY`, and stop at a draft PR with CI evidence.
> Deliverables:
> - One additive PostgreSQL migration that separates immutable source content artifacts from append-only acquisition events
> - A fixed-origin, fail-closed ABCA ArcGIS adapter and explicit acquisition state machine with zero-change and revision-drift handling
> - Event-bound compilation, verification, freshness, and revalidation without evidence mutation or verification laundering
> - A canonical ASK Answerability Frontier and concurrency-safe Opportunity/continuation deduplication
> - Exact ownership, durability, evidence documentation, local verification receipts, a draft PR, and exact-head hosted CI results
> Effort:       XL
> Risk:         High - live networking, canonical schema, freshness, public truth, continuation concurrency, and release evidence meet in one slice.

## Scope
### Must have
- Begin at commit `e3139d960b837a8ea7ef7f01acfab5111dd96cc7`, tree `5b6c4b85d613d1de71879bc7e27b63cb96ba7405`, on branch `feat/live-reality-acquisition`; every receipt and the draft PR must retain that base identity.
- Admit exactly one live source: `dcgis:abca:licensed-medical-cannabis-retailers:layer-31` at `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31` and its `/query` endpoint. No caller-supplied origin, layer, field set, predicate, or URL is permitted.
- Add exactly one additive migration, `20260810200000_live_reality_acquisition`; preserve all five existing migrations and all existing evidence rows.
- Separate identical reusable response content into an immutable content artifact from each acquisition attempt/event. A zero-change run appends an acquisition event but creates no duplicate content artifact, observations, resolutions, claims, or opportunity.
- Record an append-only acquisition state machine as one immutable event per transition, grouped by attempt identity and sequence, with exact transition validation, terminal outcome, request contract digest, pre/post source revision, pre/post count, artifact digest/link, timestamps, bounded error code, and no secrets/raw stack traces.
- Bound live I/O with an explicit operator opt-in, CI refusal, fixed HTTPS origin/port/path, redirect refusal, public-address resolution, timeouts, maximum bytes/records, exact content type/JSON shape, exact fields/order, and zero credential/cookie/auth propagation.
- Prevent torn captures: fetch preflight metadata/count, retrieve one deterministic `OBJECTID`-ordered page, re-read metadata/count, and reject without compilation when revision/count changes, transfer-limit is asserted, the page is incomplete, or source identity drifts.
- Preserve zero-change, revision, freshness, and revalidation as separate concepts. A matching digest proves content equality only; it does not itself extend truth. Only a separately invoked court may append an event-bound revalidation and extend compatibility-projection freshness.
- Keep all content, acquisition, observations, claims, and court events append-only. Corrections and freshness renewals create new records/events; no historical artifact or evidence row is updated or deleted.
- Keep public truth fail-closed: compiler output remains `UNKNOWN` and non-public; only an approved, complete, current cohort tied to a successful acquisition event may update the existing `Retailer`/`GeoClaim` compatibility projection.
- Add an ASK Answerability Frontier that canonically describes normalized scope, required predicates, blocking predicates, evidence boundary, and frontier digest. Equivalent unanswered intents deduplicate to one tenant-scoped OPEN Opportunity and one active continuation mission even under concurrency.
- Close a MARKET_GAP only when a recheck of that exact frontier finds a current, decision-eligible candidate satisfying every required predicate. UNKNOWN, stale, partial, unsupported, or mismatched evidence leaves it OPEN.
- Preserve existing `REFLECTION_ONLY` semantics and `OBSERVE_ONLY` authority. Live acquisition/reflection may write bounded evidence receipts but may not promote memory, cognition, truth authority, provider authority, or value claims.
- Exclude live acquisition entrypoints from the hosted production artifact and prove no route, request handler, build, seed, migration, continuation tick, CI unit test, or page render can initiate live acquisition.
- Produce exact-base/exact-head RED/GREEN, migration, security, zero-change, revision drift, freshness, ASK dedupe, ownership, durability, and CI evidence; open a draft PR only.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No merge, squash, rebase of canonical `main`, ready-for-review transition, deploy, publish, cPanel access, production database/service access, production migration, credential use, or production mutation.
- No second source, generic crawler, configurable URL, alternate ABCA endpoint/layer, third-party provider, paid call, browser scraping, or hidden network fallback.
- No live request in CI, automated tests, build, seed, Prisma migration, runtime route, scheduled continuation, or Site Intelligence collection.
- No `prisma db push`, reset, destructive DDL, edit to an existing migration, drop/rename of existing models/columns, or backfill that deletes/rewrites historical evidence.
- No content digest interpreted as a source revision; no acquisition timestamp interpreted as proof that source content was unchanged; no zero-change event automatically extending claim/public freshness.
- No parser/verifier fusion, self-verification, mutable verification evidence, partial-cohort publication, or direct update of append-only claim state.
- No fuzzy entity matching, name/address identity, invented/default coordinate, negative inference from absence, whole-market completeness claim, or inference about separately listed internet retailers.
- No raw customer query in the frontier/dedupe key, no cross-tenant dedupe, no duplicate mission for an existing OPEN frontier, and no closure based only on retailer count.
- No new authority rank named `REFLECTION_ONLY`; it remains a reflection state beneath the existing `OBSERVE_ONLY` ceiling.
- No wildcard/directory ownership, unrelated court edits, neighboring-path admission, verifier bypass, self-promotion, cognitive promotion, or claim of demand/revenue/ranking/causality.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Node built-in test runner, Prisma 6.19.3, disposable PostgreSQL/PostGIS, existing MariaDB/cPanel simulators, and CANA verifier/durability commands
- QA policy: every task has agent-executed scenarios
- Evidence: `<attemptDir>/task-<N>-<slug>.<ext>` — under ulw-loop, `<attemptDir>` is the `currentAttemptDir` from `omo ulw-loop status --json` (`.omo/evidence/ulw/<session>/<goalId>/a<attempt>`); outside ulw-loop use `.omo/evidence/`
- RED-before-GREEN policy: Tasks 2-8 must first add the named assertions, run the exact focused command, capture a non-zero RED receipt whose failure names the missing behavior, then implement and capture the identical command at exit 0. A task without both artifacts is incomplete.
- Live-test policy: unit/integration tests inject a scripted transport and local disposable database; only Task 9 may exercise the real ABCA endpoint, only with explicit opt-in, and never in CI. If live authority is absent, Task 9 records `LIVE_NOT_RUN_AUTHORITY_REQUIRED` and the draft PR remains locally verified/live-pending rather than fabricating success.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (serialized base and ownership gate):
- Task 1: bind exact base, branch, file ownership, and plan

Wave 2 (independent RED-first foundations after Task 1):
- Task 2: additive content/acquisition migration
- Task 3: acquisition state machine and security policy
- Task 6: ASK Answerability Frontier
- Task 8: Slice 2 contracts, reflection, and evidence schemas

Wave 3 (integration after foundations):
- Task 4: fixed-origin live ABCA adapter and acquisition persistence; depends [2, 3]
- Task 5: event-bound compilation, court revalidation, and freshness; depends [2, 4]
- Task 7: Opportunity/continuation dedupe and frontier closure; depends [5, 6]

Wave 4 (exact-head proof):
- Task 9: local/live-optional evidence packet and all repository gates; depends [1-8]

Wave 5 (external draft boundary):
- Task 10: push branch, open draft PR, monitor exact-head CI, and stop; depends [9]

Critical path: Task 1 -> Task 2/3 -> Task 4 -> Task 5 -> Task 7 -> Task 9 -> Task 10

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1 | none | 2, 3, 6, 8 | none |
| 2 | 1 | 4, 5 | 3, 6, 8 |
| 3 | 1 | 4 | 2, 6, 8 |
| 4 | 2, 3 | 5 | 6, 8 |
| 5 | 2, 4 | 7, 9 | 6, 8 |
| 6 | 1 | 7 | 2, 3, 4, 8 |
| 7 | 5, 6 | 9 | 8 |
| 8 | 1 | 9 | 2, 3, 4, 5, 6, 7 |
| 9 | 1-8 | 10 | none |
| 10 | 9 | final verification | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Bind the exact Slice 2 base and no-wildcard ownership lane

  What to do: Assert clean `HEAD=e3139d960b837a8ea7ef7f01acfab5111dd96cc7`, tree `5b6c4b85d613d1de71879bc7e27b63cb96ba7405`, and branch `feat/live-reality-acquisition` before any implementation. Add a `phase_b_slice2_live_reality_2026_08_10` assignment and matching constant/digest validation to `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`, `tools/durability/cli.mjs`, and `tools/durability/cli.test.mjs`. Authorize only the plan and paths named by Tasks 2-10: `.github/workflows/cana-verify.yml`; `.omo/plans/cana-phase-b-slice2-live-reality.md`; `apps/web/prisma/migration-manifest.json`; `apps/web/prisma/migrations/20260810200000_live_reality_acquisition/migration.sql`; `apps/web/prisma/schema.prisma`; `apps/web/scripts/acquire-live-market-reality.mjs`; `apps/web/scripts/replay-live-reality-benchmark.mjs`; `apps/web/src/lib/ask/answerability-frontier.mjs`; `apps/web/src/lib/ask/ask-service.mjs`; `apps/web/src/lib/ask/ask-work.mjs`; `apps/web/src/lib/ask/market-gap-recheck.mjs`; `apps/web/src/lib/continuation/continuation-consumers.mjs`; `apps/web/src/lib/reality/acquisition-state-machine.mjs`; `apps/web/src/lib/reality/live-abca-adapter.mjs`; `apps/web/src/lib/reality/live-reality-acquisition.mjs`; `apps/web/src/lib/reality/market-claim-adapter.mjs`; `apps/web/src/lib/reality/market-claim-court.mjs`; `apps/web/src/lib/reality/official-source-snapshot.mjs`; `apps/web/src/lib/reality/reality-compiler.mjs`; `apps/web/src/lib/reality/reality-repository.mjs`; `apps/web/tests/answerability-frontier.test.mjs`; `apps/web/tests/ask-frontier-dedupe.test.mjs`; `apps/web/tests/ask-service-where.test.mjs`; `apps/web/tests/live-abca-adapter.test.mjs`; `apps/web/tests/live-reality-acquisition.test.mjs`; `apps/web/tests/live-reality-court.test.mjs`; `apps/web/tests/migration-court.test.mjs`; `apps/web/tests/migration-manifest.test.mjs`; `apps/web/tests/reality-cognitive-evolution.test.mjs`; `apps/web/tests/reality-compiler.test.mjs`; `apps/web/tests/reality-organism-loop.test.mjs`; `apps/web/tests/security-boundary.test.mjs`; `apps/web/tests/verification-laundering.test.mjs`; `deploy/namecheap/artifact-exclusions.test.mjs`; `deploy/namecheap/build-artifact.mjs`; `docs/evidence/phase-b-slice2/ACQUISITION_STATE_MACHINE.md`; `docs/evidence/phase-b-slice2/ANSWERABILITY_FRONTIER.md`; `docs/evidence/phase-b-slice2/LIVE_REALITY_BENCHMARK.json`; `docs/evidence/phase-b-slice2/REFLECTION_RECEIPT.json`; `docs/migration/SQLITE_TO_POSTGRES.md`; `docs/reality/PHASE_B_SLICE2_LIVE_ACQUISITION.md`; `tools/durability/cli.mjs`; `tools/durability/cli.test.mjs`; `tools/mariadb-sim/generate-schema.mjs`; `tools/mariadb-sim/run.test.mjs`; `tools/mariadb-sim/schema.prisma`; `tools/reality/verify-slice2-evidence-packet.mjs`; `tools/reality/verify-slice2-evidence-packet.test.mjs`; `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`. Bind exact ordered paths, exact base commit/tree, approval digest, and root ownership digest. The authorization effect must explicitly deny generic network/provider/credentials/spend/publish/deploy/production/promotion authority; the only external effect admitted is one operator-opted read from the fixed ABCA origin.

  Must NOT do: Do not start from a descendant, reuse Slice 1 authority, add a glob/directory/neighbor, edit unrelated global-no-edit courts, or let ownership imply execution/production authority.

  Parallelization: Can parallel: NO | Wave 1 | Blocks: [2, 3, 6, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `tools/durability/cli.mjs:41-45` - Slice 1 assignment and bound digests
  - Pattern:  `tools/durability/cli.mjs:139-216` - exact ordered authorized-path array
  - API/Type: `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json:521-605` - existing Phase B exact-base ownership contract
  - Test:     `tools/durability/cli.test.mjs` - path, digest, base, and authority tamper courts

  Acceptance criteria (agent-executable only):
  - [ ] `test "$(git rev-parse e3139d960b837a8ea7ef7f01acfab5111dd96cc7^{tree})" = 5b6c4b85d613d1de71879bc7e27b63cb96ba7405` exits 0.
  - [ ] `node --test tools/durability/cli.test.mjs` passes with new neighbor, wildcard, duplicate, removal, reorder, base-drift, digest-tamper, and authority-broadening cases.
  - [ ] A Node assertion over `authorized_paths` proves uniqueness, lexical order, exact equality with the planned path set, and absence of `*`, absolute paths, `..`, and any unlisted path.
  - [ ] Task stop condition: stop the entire plan immediately if base/tree/branch differs or the starting worktree contains an unexplained change; otherwise commit the plan and ownership gate before Task 2.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: exact Slice 2 ownership validates
    Tool:     bash
    Steps:    Run `node --test tools/durability/cli.test.mjs 2>&1 | tee <attemptDir>/task-1-ownership.txt`.
    Expected: Exit 0; exact base/tree/path/digest tests pass.
    Evidence: <attemptDir>/task-1-ownership.txt

  Scenario: scope broadening fails closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='Slice 2.*(wildcard|neighbor|authority|digest|base)' tools/durability/cli.test.mjs 2>&1 | tee <attemptDir>/task-1-ownership-error.txt`.
    Expected: Exit 0 because every injected broadening/tamper is rejected.
    Evidence: <attemptDir>/task-1-ownership-error.txt
  ```

  Commit: YES | Message: `chore(ownership): admit exact phase b slice 2 paths` | Files: [`.omo/plans/cana-phase-b-slice2-live-reality.md`, `tools/durability/cli.mjs`, `tools/durability/cli.test.mjs`, `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`]

- [ ] 2. Add the additive content-artifact and acquisition-event migration

  What to do: Add RED assertions first in `apps/web/tests/migration-court.test.mjs` and `apps/web/tests/migration-manifest.test.mjs`. Create exactly `20260810200000_live_reality_acquisition`. Add `MarketSourceContentArtifact` keyed by `[sourceKey,payloadSha256]` with fixed source URL, request-contract digest, payload length/body, record count, schema version, and immutable creation time. Add `MarketSourceAcquisitionEvent` as one immutable transition event with `attemptId`, monotonic `sequence`, state, optional terminal outcome, started/event/acquired/completed timestamps, pre/post revision, pre/post count, request digest, optional artifact ID/digest, prior-event digest, event digest, bounded error code/detail, and zero external-secret fields; enforce unique `[attemptId,sequence]` and unique `eventDigest`. Add nullable `contentArtifactId`/terminal `acquisitionEventId` bridges to `MarketCompilation`, and nullable terminal `acquisitionEventId`/`freshnessExpiresAt` to `MarketVerificationEvent`; add restrictive FKs/indexes. Backfill one content artifact and one terminal historical `IMPORTED_FIXTURE` event per existing `MarketSourceSnapshot`, then bind existing compilations/events where deterministically possible. Retain every existing table/column/row for rollback compatibility; new live writes use the new owners. Add PostgreSQL UPDATE/DELETE refusal triggers for both new evidence tables and extend append-only coverage. Update Prisma, migration manifest digest, MariaDB candidate generation/schema/text mappings, migration documentation, and exact-six-migration validators.

  Must NOT do: Do not rename/drop `MarketSourceSnapshot`, rewrite its rows, edit an existing migration, create a second datasource, use a database enum for authority, or make acquisition event fields mutable.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [4, 5] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - API/Type: `apps/web/prisma/schema.prisma:690-742` - current snapshot/tenant compilation boundary being extended additively
  - API/Type: `apps/web/prisma/schema.prisma:876-893` - append-only verification event to bind to acquisition/freshness
  - Pattern:  `apps/web/prisma/migration-manifest.json:1-25` - exact ordered five-migration universe and digests
  - Test:     `apps/web/tests/migration-manifest.test.mjs:36-88` - missing, unexpected, reordered, and tampered migration failures
  - Test:     `apps/web/tests/migration-court.test.mjs:300-470` - disposable PostgreSQL and append-only court patterns
  - Pattern:  `tools/mariadb-sim/generate-schema.mjs:1-30` - portable unbounded-text mapping

  Acceptance criteria (agent-executable only):
  - [ ] RED receipt exists from `node --test apps/web/tests/migration-manifest.test.mjs apps/web/tests/migration-court.test.mjs` failing specifically because the sixth migration/models are absent; the identical command then exits 0 GREEN.
  - [ ] Fresh disposable PostgreSQL migration deploy succeeds, schema introspection finds both new tables/FKs/indexes/triggers, and UPDATE/DELETE attempts return the named append-only refusal.
  - [ ] Upgrade from a five-migration fixture preserves counts/digests and backfills exactly one artifact/event per legacy snapshot without duplicate payload storage.
  - [ ] `node --test tools/mariadb-sim/run.test.mjs` passes and generated candidate schema includes the new models/text fields.
  - [ ] Task stop condition: stop if the migration requires destructive DDL, cannot deterministically backfill, changes any prior migration digest, or creates more than one new migration.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: fresh and upgraded databases converge
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(live acquisition|content artifact|sixth migration|upgrade)' apps/web/tests/migration-manifest.test.mjs apps/web/tests/migration-court.test.mjs 2>&1 | tee <attemptDir>/task-2-migration.txt`.
    Expected: Exit 0; fresh deploy and five-to-six upgrade preserve history and create the separated models.
    Evidence: <attemptDir>/task-2-migration.txt

  Scenario: evidence mutation and migration tamper fail closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(append-only|tamper|unexpected|reordered)' apps/web/tests/migration-manifest.test.mjs apps/web/tests/migration-court.test.mjs 2>&1 | tee <attemptDir>/task-2-migration-error.txt`.
    Expected: Exit 0 because UPDATE/DELETE, digest drift, and universe drift are rejected.
    Evidence: <attemptDir>/task-2-migration-error.txt
  ```

  Commit: YES | Message: `feat(reality): separate source content from acquisition events` | Files: [`apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/20260810200000_live_reality_acquisition/migration.sql`, `apps/web/prisma/migration-manifest.json`, `apps/web/tests/migration-court.test.mjs`, `apps/web/tests/migration-manifest.test.mjs`, `docs/migration/SQLITE_TO_POSTGRES.md`, `tools/mariadb-sim/generate-schema.mjs`, `tools/mariadb-sim/run.test.mjs`, `tools/mariadb-sim/schema.prisma`]

- [ ] 3. Define the fail-closed acquisition state machine and security contract

  What to do: Add RED state/security tests, then implement a pure transition reducer in `acquisition-state-machine.mjs`. Use exact success branches `REQUESTED -> PREFLIGHT_VALIDATED -> FETCHING -> CAPTURED -> POSTFLIGHT_VALIDATED -> CHANGED -> PERSISTED -> COMPLETED` and `REQUESTED -> PREFLIGHT_VALIDATED -> FETCHING -> CAPTURED -> POSTFLIGHT_VALIDATED -> UNCHANGED -> REVALIDATION_PENDING -> COMPLETED`; `FAILED` is reachable from any nonterminal state, terminal states cannot transition, and every transition yields a canonical hash-chained event digest. Define fixed request contract constants in `live-abca-adapter.mjs`: HTTPS, host `maps2.dcgis.dc.gov`, port 443/default only, layer 31 metadata and `/31/query`, exact `ABCA_FIELDS`, `where=1=1`, `orderByFields=OBJECTID`, `returnGeometry=true`, `f=json`, no caller query overrides. Add `assertLiveAcquisitionAuthority`: require `CANA_LIVE_REALITY_NETWORK=1`, refuse any truthy CI marker, reject proxy/auth/cookie/header/user-URL inputs, validate public DNS answers (no loopback/private/link-local/multicast/unspecified IPv4/IPv6), enforce redirect `manual`, connect/body/whole-run timeouts, JSON content type, maximum 2 MiB per response/4 MiB run, maximum 500 records, and sanitized stable error codes.

  Must NOT do: Do not perform network I/O in this task, accept a generic fetch URL, log bodies/secrets, follow redirects, retry unboundedly, or allow a state transition to imply verification/publication.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [4] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - API/Type: `apps/web/src/lib/reality/official-source-snapshot.mjs:5-26` - exact source, query URL, and field allowlist
  - Pattern:  `apps/web/src/lib/reality/official-source-snapshot.mjs:30-47` - stable errors and unversioned multipage refusal
  - Pattern:  `apps/web/src/lib/reality/official-source-snapshot.mjs:98-168` - byte, page, identity, order, and count validation
  - Test:     `apps/web/tests/security-boundary.test.mjs` - repository security-boundary assertions
  - External: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31` - sole admitted official layer contract

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/live-abca-adapter.test.mjs apps/web/tests/security-boundary.test.mjs`.
  - [ ] Exhaustive transition-table tests prove all allowed transitions and reject skips, reversals, repeated terminal transitions, unknown states, and post-failure continuation.
  - [ ] Security tests reject CI, missing opt-in, alternate host/scheme/port/path/query/fields, redirects, private DNS, oversized/slow/non-JSON responses, credentials, and excessive records with stable `CANA_LIVE_REALITY_*` codes.
  - [ ] Task stop condition: stop if the transport cannot enforce redirect refusal, timeout, byte cap, or resolved-address policy before any live request is authorized.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: fixed-source state contract accepts a bounded scripted capture
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(state machine|fixed ABCA contract|bounded response)' apps/web/tests/live-abca-adapter.test.mjs 2>&1 | tee <attemptDir>/task-3-state-security.txt`.
    Expected: Exit 0; scripted exact-origin transitions end only in COMPLETED.
    Evidence: <attemptDir>/task-3-state-security.txt

  Scenario: SSRF, redirect, CI, timeout, and size attacks fail closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(SSRF|redirect|CI|timeout|oversize|credential)' apps/web/tests/live-abca-adapter.test.mjs apps/web/tests/security-boundary.test.mjs 2>&1 | tee <attemptDir>/task-3-state-security-error.txt`.
    Expected: Exit 0 because each adversarial request terminates FAILED before untrusted content is admitted.
    Evidence: <attemptDir>/task-3-state-security-error.txt
  ```

  Commit: YES | Message: `feat(reality): bound live acquisition authority` | Files: [`apps/web/src/lib/reality/acquisition-state-machine.mjs`, `apps/web/src/lib/reality/live-abca-adapter.mjs`, `apps/web/tests/live-abca-adapter.test.mjs`, `apps/web/tests/security-boundary.test.mjs`]

- [ ] 4. Acquire the fixed ABCA layer with revision and zero-change persistence

  What to do: Write scripted-transport/database RED tests first. Implement `acquireAbcaReality` and the operator CLI. Acquire a per-source PostgreSQL advisory lock; append the `REQUESTED` event before I/O; read metadata and `returnCountOnly` preflight; require layer ID 31, exact required fields, count within bounds, and a finite `editingInfo.lastEditDate` revision. Fetch exactly one ordered page and require `exceededTransferLimit=false` plus exact count; read metadata/count again and require exact revision/count equality. Build validated bytes through the existing official-source validator. In one serializable transaction, upsert content by `[sourceKey,payloadSha256]`, append the immutable acquisition event/outcome, and link the artifact. Existing digest => `UNCHANGED` with zero new artifact; new digest => `CHANGED` with one artifact. Drift/outage/parser/security failure => terminal `FAILED`, sanitized receipt, no artifact/compile/claim/public mutation. CLI requires `--tenant`, `--as-of`, and opt-in env; emits one JSON receipt; no cron/route registration. Exclude the CLI and live modules from the Namecheap artifact.

  Must NOT do: Do not paginate without a revision-bound API, compile inside the network adapter, refresh truth on `UNCHANGED`, store response bodies in errors, or retry after a security/contract failure.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [5] | Blocked by: [2, 3]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/src/lib/reality/official-source-snapshot.mjs:171-219` - deterministic content artifact construction
  - Pattern:  `apps/web/src/lib/reality/reality-repository.mjs:1-120` - serializable persistence and snapshot/compiler repository boundary
  - API/Type: `apps/web/prisma/schema.prisma:701-742` - existing artifact/compilation uniqueness contracts
  - Test:     `apps/web/tests/reality-compiler.test.mjs` - deterministic fixture/compiler harness
  - Pattern:  `deploy/namecheap/build-artifact.mjs` - production artifact inclusion/exclusion boundary

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/live-abca-adapter.test.mjs apps/web/tests/live-reality-acquisition.test.mjs deploy/namecheap/artifact-exclusions.test.mjs`.
  - [ ] Two identical scripted acquisitions yield two complete append-only event chains with distinct attempt IDs, one content artifact, no compilation/claim writes, and second terminal outcome `UNCHANGED`.
  - [ ] Changed bytes under stable pre/post revision/count yield one new artifact and `CHANGED`; revision/count drift yields `FAILED` and zero artifact/compilation/claim/public writes.
  - [ ] Concurrent acquisitions serialize per source and cannot duplicate artifacts/events or exceed bounded run limits.
  - [ ] Production artifact inventory contains none of `acquire-live-market-reality.mjs`, `live-abca-adapter.mjs`, or `live-reality-acquisition.mjs`.
  - [ ] Task stop condition: stop on any real network call during tests/CI, any zero-change truth refresh, any torn-capture admission, or any live module in the production artifact.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: changed then unchanged acquisitions preserve content dedupe
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(changed acquisition|zero-change|concurrent)' apps/web/tests/live-reality-acquisition.test.mjs 2>&1 | tee <attemptDir>/task-4-acquisition.txt`.
    Expected: Exit 0; events are per attempt, content is per digest, and no duplicate downstream work exists.
    Evidence: <attemptDir>/task-4-acquisition.txt

  Scenario: revision drift and partial capture are quarantined
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(revision drift|count drift|transfer limit|partial|outage)' apps/web/tests/live-abca-adapter.test.mjs apps/web/tests/live-reality-acquisition.test.mjs 2>&1 | tee <attemptDir>/task-4-acquisition-error.txt`.
    Expected: Exit 0 because each case appends only a sanitized FAILED event and leaves truth unchanged.
    Evidence: <attemptDir>/task-4-acquisition-error.txt
  ```

  Commit: YES | Message: `feat(reality): persist bounded abca acquisitions` | Files: [`apps/web/scripts/acquire-live-market-reality.mjs`, `apps/web/src/lib/reality/live-abca-adapter.mjs`, `apps/web/src/lib/reality/live-reality-acquisition.mjs`, `apps/web/src/lib/reality/official-source-snapshot.mjs`, `apps/web/src/lib/reality/reality-repository.mjs`, `apps/web/tests/live-abca-adapter.test.mjs`, `apps/web/tests/live-reality-acquisition.test.mjs`, `deploy/namecheap/build-artifact.mjs`, `deploy/namecheap/artifact-exclusions.test.mjs`]

- [ ] 5. Bind compilation and independent freshness revalidation to acquisition events

  What to do: Add RED court/database cases first. Allow compilation only from a successful `CHANGED` acquisition whose artifact passes byte/digest/schema/source/revision checks; compilation stays tenant-scoped, idempotent, UNKNOWN, and non-public. For `UNCHANGED`, permit only a separate `revalidate` operation: the court rereads the exact artifact and acquisition event, verifies matching pre/post revision/count, recomputes every observation/claim/evidence digest, checks the complete source-authoritative cohort, and appends a new `MarketVerificationEvent` containing acquisition event ID and `freshnessExpiresAt=min(acquiredAt+30d, valid license expiration)`. A fresh verification event may update only the mutable legacy compatibility projection; it may not mutate the claim/artifact/observation. Expired, future, partial, conflicted, failed, drifted, wrong-source, wrong-tenant, or digest-mismatched events yield non-public decisions. Repeated revalidation of one acquisition is idempotent; a later acquisition may append a later court event. Update adapter selection to use the latest admitted event, not `MarketClaim.verification` alone.

  Must NOT do: Do not treat acquisition as verification, extend freshness from digest equality alone, mutate append-only claim fields, accept partial cohorts, overwrite independent legacy evidence, or compile FAILED/UNCHANGED events.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [7, 9] | Blocked by: [2, 4]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/src/lib/reality/reality-compiler.mjs:44-78` - current evidence snapshot identity/freshness inputs
  - Pattern:  `apps/web/src/lib/reality/reality-compiler.mjs:143-248` - UNKNOWN observations/claims and deterministic compile output
  - API/Type: `apps/web/src/lib/reality/market-claim-court.mjs` - independent evidence adjudication owner
  - Pattern:  `apps/web/src/lib/reality/reality-repository.mjs:440-607` - transaction, court-event, and compatibility projection path
  - API/Type: `apps/web/prisma/schema.prisma:802-893` - versioned claims and append-only court events
  - Test:     `apps/web/tests/verification-laundering.test.mjs` - parser/public truth separation

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/reality-compiler.test.mjs apps/web/tests/live-reality-court.test.mjs apps/web/tests/verification-laundering.test.mjs`.
  - [ ] CHANGED acquisition compiles once; UNCHANGED acquisition creates no content/observation/claim duplicates and requires the separate court call before freshness changes.
  - [ ] Exact boundary assertions prove eligibility for `verifiedAt <= asOf < freshnessExpiresAt` and ineligibility at `asOf >= freshnessExpiresAt` or before acquisition.
  - [ ] Parser/compiler imports cannot reach the court write path; static scan finds no live adapter import from routes/build/seed/continuation/Site Intelligence.
  - [ ] Task stop condition: stop if freshness can advance without a unique successful acquisition event plus independent court event, or if any append-only row changes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: unchanged content is independently revalidated
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(unchanged revalidation|freshness boundary|latest court event)' apps/web/tests/live-reality-court.test.mjs 2>&1 | tee <attemptDir>/task-5-revalidation.txt`.
    Expected: Exit 0; no duplicate content/claims are created, one append-only event renews the projection, and exact expiry is enforced.
    Evidence: <attemptDir>/task-5-revalidation.txt

  Scenario: forged acquisition and self-verification fail closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(forged|failed acquisition|revision mismatch|self-verification|partial|expired)' apps/web/tests/live-reality-court.test.mjs apps/web/tests/verification-laundering.test.mjs 2>&1 | tee <attemptDir>/task-5-revalidation-error.txt`.
    Expected: Exit 0 because every invalid event creates no current public projection.
    Evidence: <attemptDir>/task-5-revalidation-error.txt
  ```

  Commit: YES | Message: `feat(reality): revalidate freshness from acquisition evidence` | Files: [`apps/web/src/lib/reality/reality-compiler.mjs`, `apps/web/src/lib/reality/reality-repository.mjs`, `apps/web/src/lib/reality/market-claim-court.mjs`, `apps/web/src/lib/reality/market-claim-adapter.mjs`, `apps/web/tests/reality-compiler.test.mjs`, `apps/web/tests/live-reality-court.test.mjs`, `apps/web/tests/verification-laundering.test.mjs`]

- [ ] 6. Define the canonical ASK Answerability Frontier

  What to do: Add RED pure tests, then implement `answerability-frontier.mjs`. Canonicalize tenant, normalized supported intent scope (including normalized location), sorted unique required predicates, sorted blocking predicates, evidence gate version, and verified subject/predicate coverage. Exclude raw query text, timestamps, candidate ordering, and mutable prose. Produce `frontier_key=sha256:<hex>`, `answerable`, `covered_predicates`, `blocking_predicates`, and `evidence_digest`. Refactor `answerIntent` to derive candidate truth through the existing double gate and return this frontier. A candidate counts only when one subject satisfies every required predicate from current decision-eligible evidence; a mere retailer count cannot close the frontier. Preserve honest UNKNOWN/unsupported results.

  Must NOT do: Do not invent a new truth store, store raw queries in the key, infer unsupported predicates, collapse tenants, or mark answerable from partial coverage across different subjects.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [7] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - API/Type: `apps/web/src/lib/ask/ask-service.mjs:34-48` - canonical public candidate query
  - Pattern:  `apps/web/src/lib/ask/ask-service.mjs:55-191` - current answer/opportunity result contract
  - Pattern:  `apps/web/src/lib/reality/reality-compiler.mjs:257-270` - existing subject-scoped intent coverage logic
  - Pattern:  `apps/web/src/lib/ask/intent-ir.mjs` - persistence-safe normalized intent contract
  - Test:     `apps/web/tests/ask-service-where.test.mjs` - current double truth gate cases

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/answerability-frontier.test.mjs apps/web/tests/ask-service-where.test.mjs`.
  - [ ] Semantically equivalent normalized intents produce the same frontier key; different tenant, scope, or required-predicate set produces a different key.
  - [ ] Raw query/time/order changes do not affect the key, and no raw query appears in serialized frontier evidence.
  - [ ] Partial evidence split across subjects, stale evidence, UNKNOWN evidence, and unsupported predicates remain unanswerable with exact blockers.
  - [ ] Task stop condition: stop if a stable key cannot be derived without raw customer text or if answerability requires weakening the existing public truth gate.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: equivalent intents share one frontier
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(canonical frontier|equivalent intent|complete subject)' apps/web/tests/answerability-frontier.test.mjs 2>&1 | tee <attemptDir>/task-6-frontier.txt`.
    Expected: Exit 0; equivalent scopes hash equally and a complete current subject is answerable.
    Evidence: <attemptDir>/task-6-frontier.txt

  Scenario: cross-subject and stale evidence cannot fake answerability
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(cross-subject|stale|unknown|raw query|tenant)' apps/web/tests/answerability-frontier.test.mjs 2>&1 | tee <attemptDir>/task-6-frontier-error.txt`.
    Expected: Exit 0 because invalid coverage stays blocked and keys remain tenant scoped/privacy safe.
    Evidence: <attemptDir>/task-6-frontier-error.txt
  ```

  Commit: YES | Message: `feat(ask): define answerability frontier` | Files: [`apps/web/src/lib/ask/answerability-frontier.mjs`, `apps/web/src/lib/ask/ask-service.mjs`, `apps/web/tests/answerability-frontier.test.mjs`, `apps/web/tests/ask-service-where.test.mjs`]

- [ ] 7. Deduplicate Frontier Opportunities and close only on exact recheck

  What to do: Add RED unit and disposable-PostgreSQL concurrency tests. Change MARKET_GAP dedupe to use the canonical frontier key plus tenant/kind, stored in `Opportunity.dedupeKey`, evidence, and observed state. Upsert an equivalent OPEN gap without creating a second mission/trigger; under concurrency, exactly one Opportunity owns exactly one active follow-up. Preserve separate work for distinct tenants/frontiers. Bind continuation requirements to `frontier_key`, opportunity ID, evidence digest, consumer name, and `loop_mode=REFLECTION_ONLY` while authority remains `OBSERVE_ONLY`. On recheck, reconstruct and compare the frontier, then close only when the exact required-predicate set is answerable from current evidence; otherwise append `REFLECTED` with `PERSISTENT`, refreshed blockers, and no truth mutation. Tamper, cross-tenant, wrong frontier/event/tick, duplicate receipt, or stale evidence refuses without mutation.

  Must NOT do: Do not dedupe across tenants, create a mission on conflict/retry, close by `verified_candidate_count > 0` alone, add REFLECTION_ONLY to authority ranking, or let the continuation trigger live acquisition.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [9] | Blocked by: [5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/src/lib/ask/ask-work.mjs:79-164` - current atomic Opportunity/mission/trigger producer and dedupe boundary
  - API/Type: `apps/web/src/lib/ask/market-gap-recheck.mjs:18-110` - current FIRED receipt validation and closure transaction
  - Pattern:  `apps/web/src/lib/continuation/continuation-consumers.mjs:7-56` - bounded consumer/retry dispatcher
  - API/Type: `apps/web/prisma/schema.prisma:1022` - tenant-scoped Opportunity uniqueness owner
  - Test:     `apps/web/tests/reality-organism-loop.test.mjs:167-286` - durable authority, retry, gap closure, and repeated-demand cases

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/ask-frontier-dedupe.test.mjs apps/web/tests/reality-organism-loop.test.mjs`.
  - [ ] Ten concurrent equivalent writes produce one OPEN Opportunity, one mission, one trigger, ten minimized intent signals, and no orphan row.
  - [ ] Distinct tenant or blocker set produces distinct work; repeated settled receipt is idempotent.
  - [ ] Recheck closes only when the same frontier becomes fully answerable; partial/stale/UNKNOWN or changed-frontier evidence remains OPEN/PERSISTENT.
  - [ ] Task stop condition: stop if dedupe is only in memory, depends on timing, loses intent signals, or closure can occur from count alone.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: concurrent equivalent gaps deduplicate durably
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(concurrent frontier|equivalent gap|single mission)' apps/web/tests/ask-frontier-dedupe.test.mjs 2>&1 | tee <attemptDir>/task-7-opportunity-dedupe.txt`.
    Expected: Exit 0; database uniqueness and transaction logic yield one Opportunity/mission/trigger.
    Evidence: <attemptDir>/task-7-opportunity-dedupe.txt

  Scenario: forged or incomplete frontier cannot close
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(wrong frontier|cross-tenant|partial|stale|unknown|count alone)' apps/web/tests/ask-frontier-dedupe.test.mjs apps/web/tests/reality-organism-loop.test.mjs 2>&1 | tee <attemptDir>/task-7-opportunity-dedupe-error.txt`.
    Expected: Exit 0 because each case leaves the gap OPEN and appends no false closure.
    Evidence: <attemptDir>/task-7-opportunity-dedupe-error.txt
  ```

  Commit: YES | Message: `feat(ask): deduplicate frontier opportunities` | Files: [`apps/web/src/lib/ask/ask-work.mjs`, `apps/web/src/lib/ask/market-gap-recheck.mjs`, `apps/web/src/lib/continuation/continuation-consumers.mjs`, `apps/web/tests/ask-frontier-dedupe.test.mjs`, `apps/web/tests/reality-organism-loop.test.mjs`]

- [ ] 8. Freeze Slice 2 contracts, REFLECTION_ONLY evidence, and packet verification

  What to do: Add RED validator tests first. Document the source authority, state machine, artifact/event split, zero-change semantics, revision-drift policy, freshness/revalidation formula, Answerability Frontier, security budgets, rollback, and explicit no-production boundary. Extend cognitive tests to prove acquisition/reflection emits `state=REFLECTION_ONLY`, `value_state=VALUE_NOT_ESTABLISHED`, `cognitive_mutations_promoted=0`, `next_action=OWNER_REVIEW`, and zero provider/spend/publish/deploy/production effects. Create a deterministic offline benchmark using scripted acquisition responses and disposable PostgreSQL; include changed, unchanged, drift, outage, revalidation, frontier-dedupe, and gap-closure counts. Implement a Slice 2 packet verifier that binds exact base/head/tree, exact changed paths/ownership digest, migration universe/digest, benchmark/doc/receipt hashes, zero-effect claims, and required hosted run IDs. Add the focused Slice 2 tests to `candidate-unit`; do not add a live network step to CI.

  Must NOT do: Do not claim live success from scripted evidence, convert reflection to promotion, add a CI/live request, make hosted checks optional for final handoff, or use mutable/unhashed evidence.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [9] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `apps/web/src/lib/reality/reality-compiler.mjs:308-345` - existing REFLECTION_ONLY receipt contract
  - Test:     `apps/web/tests/reality-cognitive-evolution.test.mjs` - no-promotion court
  - Pattern:  `tools/reality/verify-evidence-packet.mjs:8-39` - required receipts/effects/hosted runs
  - Pattern:  `tools/reality/verify-evidence-packet.mjs:134-260` - exact identity, hash inventory, ownership, receipt, and hosted-state verification
  - Test:     `tools/reality/verify-evidence-packet.test.mjs:146-205` - packet tamper and migration tamper refusals
  - Pattern:  `.github/workflows/cana-verify.yml:17-108` - candidate and hosted verification jobs

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN receipts exist for `node --test apps/web/tests/reality-cognitive-evolution.test.mjs tools/reality/verify-slice2-evidence-packet.test.mjs`.
  - [ ] Offline benchmark deterministically reports one changed artifact, one unchanged event, zero duplicate artifacts/claims/opportunities, drift/outage denied, revalidation append-only, and zero external effects.
  - [ ] Packet byte/extra-file/symlink/base/head/tree/ownership/migration/receipt/hosted-ID tampering each fails with a stable Slice 2 code.
  - [ ] CI workflow runs Slice 2 unit/packet tests but contains no ABCA URL, opt-in env, or acquisition CLI invocation.
  - [ ] Task stop condition: stop if documentation and executable state/constants disagree, or if any evidence claim cannot be independently recomputed from committed bytes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: deterministic Slice 2 evidence packet verifies
    Tool:     bash
    Steps:    Run `node apps/web/scripts/replay-live-reality-benchmark.mjs > <attemptDir>/task-8-benchmark.json && node --test tools/reality/verify-slice2-evidence-packet.test.mjs apps/web/tests/reality-cognitive-evolution.test.mjs 2>&1 | tee <attemptDir>/task-8-evidence.txt`.
    Expected: Exit 0; benchmark and reflection stay offline, hash-bound, and REFLECTION_ONLY.
    Evidence: <attemptDir>/task-8-evidence.txt

  Scenario: promotion and packet tamper fail closed
    Tool:     bash
    Steps:    Run `node --test --test-name-pattern='(promotion|tamper|symlink|identity|hosted|external effect)' tools/reality/verify-slice2-evidence-packet.test.mjs apps/web/tests/reality-cognitive-evolution.test.mjs 2>&1 | tee <attemptDir>/task-8-evidence-error.txt`.
    Expected: Exit 0 because promotion, malformed evidence, and identity/hash drift are rejected.
    Evidence: <attemptDir>/task-8-evidence-error.txt
  ```

  Commit: YES | Message: `docs(reality): bind slice 2 evidence contracts` | Files: [`.github/workflows/cana-verify.yml`, `apps/web/scripts/replay-live-reality-benchmark.mjs`, `apps/web/tests/reality-cognitive-evolution.test.mjs`, `docs/evidence/phase-b-slice2/ACQUISITION_STATE_MACHINE.md`, `docs/evidence/phase-b-slice2/ANSWERABILITY_FRONTIER.md`, `docs/evidence/phase-b-slice2/LIVE_REALITY_BENCHMARK.json`, `docs/evidence/phase-b-slice2/REFLECTION_RECEIPT.json`, `docs/reality/PHASE_B_SLICE2_LIVE_ACQUISITION.md`, `tools/reality/verify-slice2-evidence-packet.mjs`, `tools/reality/verify-slice2-evidence-packet.test.mjs`]

- [ ] 9. Produce exact-head local, optional-live, ownership, and durability proof

  What to do: On a clean candidate head, record `process.version`, absolute `process.execPath`, base/head/tree, branch, status, and changed paths. Run install/generation and every focused/new/full/portability/durability gate. Run the scripted benchmark and database QA. If and only if explicit live-read authority is present, invoke the acquisition CLI once with `CANA_LIVE_REALITY_NETWORK=1`, capture its sanitized receipt, then run the separate compiler/court command locally against the disposable database; never point at production. If authority is absent, emit a hash-bound `LIVE_NOT_RUN_AUTHORITY_REQUIRED` receipt and keep live proof pending. Assemble `docs/evidence/phase-b-slice2` command receipts/manifests through the verifier, amend only generated evidence/ownership digests if required, rerun all gates on the final exact commit, and require clean status.

  Must NOT do: Do not use `npm audit fix --force`, `prisma db push`, a persistent/remote database, cPanel, production service, deployment command, fake hosted/live ID, or claim live verification when skipped.

  Parallelization: Can parallel: NO | Wave 4 | Blocks: [10] | Blocked by: [1, 2, 3, 4, 5, 6, 7, 8]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `AGENTS.md:12-34` - npm/Prisma/database and verifier commands
  - Pattern:  `AGENTS.md:36-68` - ownership, PR, truth, and production boundaries
  - Pattern:  `tools/test-runner/runner.mjs:186-224` - disposable database lifecycle and cleanup
  - Pattern:  `tools/test-runner/assert-ci-durability.mjs:28-48` - matching build/verify/restore artifact receipts
  - API/Type: `tools/reality/verify-slice2-evidence-packet.mjs` - final packet contract from Task 8

  Acceptance criteria (agent-executable only):
  - [ ] `npm ci --no-audit --no-fund` and `npm run prisma:generate -w apps/web` exit 0 using the committed lockfile.
  - [ ] `node --test apps/web/tests/answerability-frontier.test.mjs apps/web/tests/ask-frontier-dedupe.test.mjs apps/web/tests/live-abca-adapter.test.mjs apps/web/tests/live-reality-acquisition.test.mjs apps/web/tests/live-reality-court.test.mjs tools/reality/verify-slice2-evidence-packet.test.mjs` exits 0.
  - [ ] `./cana verify focused`, `./cana verify maria`, `./cana verify cpanel`, `./cana durability build`, `./cana durability verify`, `./cana durability restore --target <new-empty-target>`, and `./cana github prepare` all exit 0 on the same final head; cleanup finds no leaked container/process/temp database.
  - [ ] Slice 2 packet verifier returns `LOCAL_PASS_HOSTED_PENDING` (or `LOCAL_AND_LIVE_PASS_HOSTED_PENDING` only after a real authorized live receipt), exact changed paths equal exact ownership, and all zero-effect counters except the single fixed-origin read remain 0.
  - [ ] `git status --porcelain` is empty and every receipt reports the same 40-character head/tree/runtime.
  - [ ] Task stop condition: stop before push if any mandatory local gate is red, identity differs, worktree is dirty, cleanup leaks, ownership differs, or a live result is ambiguous.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: exact-head local verification and durability pass
    Tool:     bash
    Steps:    Run `./cana verify focused 2>&1 | tee <attemptDir>/task-9-focused.txt && ./cana verify maria 2>&1 | tee <attemptDir>/task-9-maria.txt && ./cana verify cpanel 2>&1 | tee <attemptDir>/task-9-cpanel.txt && ./cana durability build 2>&1 | tee <attemptDir>/task-9-durability-build.txt && ./cana durability verify 2>&1 | tee <attemptDir>/task-9-durability-verify.txt`.
    Expected: Every command exits 0 at one exact clean head and receipts agree on identity.
    Evidence: <attemptDir>/task-9-focused.txt

  Scenario: missing live authority remains explicit and non-mutating
    Tool:     bash
    Steps:    With `CANA_LIVE_REALITY_NETWORK` unset, run `node apps/web/scripts/acquire-live-market-reality.mjs --tenant orderweeddc.com --as-of 2026-08-10T00:00:00.000Z 2>&1 | tee <attemptDir>/task-9-live-authority-error.txt`.
    Expected: Non-zero exit with `CANA_LIVE_REALITY_AUTHORITY_REQUIRED`; zero network calls and zero database/truth changes.
    Evidence: <attemptDir>/task-9-live-authority-error.txt
  ```

  Commit: YES | Message: `test(reality): certify phase b slice 2 evidence` | Files: [`docs/evidence/phase-b-slice2/LIVE_REALITY_BENCHMARK.json`, `docs/evidence/phase-b-slice2/REFLECTION_RECEIPT.json`, `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`, `tools/durability/cli.mjs`]

- [ ] 10. Open a draft PR, verify exact-head CI, and stop before release

  What to do: Confirm clean exact head and base ancestry; push only `feat/live-reality-acquisition`; create a draft PR targeting `main` with base/head identities, scope, migration/rollback, RED/GREEN receipts, live-run state, zero-effect boundary, and explicit `NO MERGE / NO DEPLOY / NO PRODUCTION MIGRATION`. Query the PR back to prove draft/base/head. Wait for every required workflow job on the exact pushed SHA. If a check fails, diagnose, fix on the branch through the owning task, rerun local gates, push the new head, and invalidate all old-head CI evidence. After the final head's checks settle, write hosted run IDs only into the external `<attemptDir>` evidence packet, verify that packet against the unchanged candidate commit, and do not create a self-referential hosted-evidence commit. Surface the final draft URL, exact SHA, check IDs/conclusions, live state, and unresolved blockers. Stop; do not mark ready or merge.

  Must NOT do: Do not force-push, merge, squash, rebase main, mark ready, close the PR, deploy, invoke cPanel, apply production migrations, or treat checks from an older SHA as proof.

  Parallelization: Can parallel: NO | Wave 5 | Blocks: [final verification] | Blocked by: [9]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `AGENTS.md:44-49` - draft/release owner boundary and stacked ancestry rules
  - Pattern:  `.github/workflows/cana-verify.yml:17-108` - required hosted jobs
  - API/Type: `tools/reality/verify-slice2-evidence-packet.mjs` - exact-head hosted run-ID contract
  - Pattern:  `tools/github-import/prepare.mjs` - offline GitHub handoff preparation

  Acceptance criteria (agent-executable only):
  - [ ] `git merge-base --is-ancestor e3139d960b837a8ea7ef7f01acfab5111dd96cc7 HEAD` exits 0 and `git diff --name-only e3139d960b837a8ea7ef7f01acfab5111dd96cc7...HEAD` equals the authorized path set.
  - [ ] `gh pr view --json isDraft,state,baseRefName,headRefName,headRefOid,url` reports `isDraft=true`, `state=OPEN`, base `main`, head `feat/live-reality-acquisition`, and `headRefOid=$(git rev-parse HEAD)`.
  - [ ] `gh pr checks --watch --fail-fast=false` completes and every required job is SUCCESS for the final `headRefOid`; external `<attemptDir>/hosted-runs.json` IDs match those runs and the packet verifier approves them against that unchanged head.
  - [ ] PR remains draft and no merge/deployment/production mutation exists after verification.
  - [ ] Task stop condition: once final exact-head CI and draft evidence are reported, stop unconditionally and wait for explicit owner authorization; any red/queued/ambiguous check means `DRAFT_PR_CI_PENDING_OR_RED`, never release-ready.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: draft PR binds the verified exact head
    Tool:     bash
    Steps:    Run `gh pr view --json isDraft,state,baseRefName,headRefName,headRefOid,url,statusCheckRollup > <attemptDir>/task-10-draft-pr.json && test "$(gh pr view --json headRefOid --jq .headRefOid)" = "$(git rev-parse HEAD)"`.
    Expected: Exit 0; PR is OPEN/DRAFT against main and exact head matches.
    Evidence: <attemptDir>/task-10-draft-pr.json

  Scenario: release actions remain prohibited
    Tool:     bash
    Steps:    Run `gh pr view --json isDraft,mergedAt,state --jq '{isDraft,mergedAt,state}' | tee <attemptDir>/task-10-no-release.json` and inspect repository receipts for `deployments=0` and `production_mutations=0` with the Slice 2 verifier.
    Expected: `isDraft=true`, `mergedAt=null`, `state=OPEN`; verifier exits 0 with zero release effects.
    Evidence: <attemptDir>/task-10-no-release.json
  ```

  Commit: NO | Message: `n/a - hosted run IDs stay in external attempt evidence to avoid self-reference` | Files: []

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
- Every AI commit includes `Co-Authored-By: OpenAI Codex <noreply@openai.com>`.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/cana-phase-b-slice2-live-reality.md`.
- Draft PR creation is not merge authorization; no merge/deploy/production commit is part of this plan.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
- The final state is an OPEN DRAFT PR with exact-head CI evidence, explicit live-run status, zero deploy/production effects, and no merge.
