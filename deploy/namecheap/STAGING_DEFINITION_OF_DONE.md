# STAGING — definition of done (20 items, no partial credit)

Staging is DONE when every item below carries evidence from an owner-executed
run on the staging install. Marks are honest about TODAY's state:

- **PROVABLE** — the tooling and evidence path exist now; local/isolated
  proof already exists where noted. On-host execution still requires the
  owner (cPanel access, hostname, env values) — that is execution, not a gap
  in the method.
- **BLOCKED** — cannot be proven today even in principle, with the named
  blocker (owner provisioning, or a cross-lane dependency).

No item may be marked done by analogy ("worked locally, so fine"). Local
proof de-risks; only the staging run closes the item. **No receipt from this
checklist may state or imply that production is live.**

| # | Item | Mark | Evidence path / blocker |
|---|---|---|---|
| 1 | Clone/restore the release source: the deployed artifact's `/api/release` SHA checks out from the remote and rebuilds | PROVABLE | `release-preflight.mjs` gate (SHA reachable on remote) + `git checkout <sha>`; local proof: preflight tests pass |
| 2 | Install locked dependencies: `npm ci` against the committed lockfile, zero drift | PROVABLE | proven in this sandbox 2026-07-26 (`npm ci` exit 0); artifact path needs no server-side install at all (deps pre-bundled) |
| 3 | Create an EMPTY provider database and prove it schema-complete | PROVABLE | `bootstrap-production-db.sh` with staging `OWD_DATA_DIR` (installs build-verified schema template only into absent/empty db; prints inventory receipt). Local proof: builder's isolated runtime test |
| 4 | Apply committed migrations via `migrate.sh` (`prisma migrate deploy`) | **BLOCKED — cross-lane**: `apps/web/prisma/migrations/**` does not exist yet (migration lane). `migrate.sh` correctly HARD-STOPS today; item closes only after that lane lands and the command runs green on staging |
| 5 | Start the web app under Passenger (`app.js` startup file) | PROVABLE | STAGING_RUNBOOK §2-3; local proof: isolated runtime test starts `app.js` and serves traffic. On-host: owner-executed |
| 6 | Start the worker and prove graceful shutdown (SIGTERM → clean log + released lock) | PROVABLE | `worker.mjs --loop` SIGTERM drill (RUNBOOK §8); cron-tick install per cPanel Cron. Local proof: falsification-tested in this lane |
| 7 | Serve every governed route (health, release, v1 APIs, public pages, SEO surfaces) | PROVABLE | `smoke-test.sh` + `readycheck.sh`; local proof: isolated runtime HTTP battery + release-gate suite (needs its own server) |
| 8 | Complete the consumer handoff journey end-to-end on staging data | PROVABLE (method) | local proof exists (`handoff.test.mjs`, HTTP checks). On-staging AUTOMATED proof additionally needs the test harness to accept a base URL (hardcodes `127.0.0.1:3000` today — cross-lane ask); manual journey per runbook until then |
| 9 | Tenant isolation: unknown host 421, tenant spoof 404, no cross-tenant reads | PROVABLE | `smoke-test.sh` origin-pinned Host checks + isolated runtime battery (`421`/`404` cases) |
| 10 | Truth boundaries hold: no demonstration record served as live on any route | PROVABLE | `release-gate` G2 locally; on staging: `/api/v1/*` sweeps + bootstrap receipt showing `demonstrationRetailers: 0` |
| 11 | Refuse challenge replay (page-challenge single-use holds on staging) | PROVABLE (method) | local proof: `page-challenge.test.mjs`. On-staging automated proof shares item 8's harness parameterization ask |
| 12 | Attribution idempotency: duplicate submissions produce one record | PROVABLE (method) | local proof: `attribution-idempotency.test.mjs`; same harness ask for on-staging automation |
| 13 | Survive restart: `restart.sh` + cPanel Restart button; same SHA, same counts after | PROVABLE | RUNBOOK §11; local proof: isolated runtime restart-persistence step |
| 14 | Produce a backup (checkpointed copy + sha256 sidecar + retention) | PROVABLE | `worker.mjs --once backup`; log record carries checkpoint status and digest |
| 15 | Restore that backup ELSEWHERE and prove it readable (inventory printed) | PROVABLE | `restore-backup.sh <backup> <new-path>` (checksum-gated, inspect-verified) |
| 16 | Roll back: `rollback.sh` swaps to previous; database hash UNCHANGED by the swap | PROVABLE | RUNBOOK §10; local proof: isolated runtime rollback db-integrity step (byte-identical) |
| 17 | Report the deployed SHA: `/api/release` = 200 RELEASE_SHA_PRESENT = the artifact's exact commit; absence is 503, never fabricated | PROVABLE | `readycheck.sh` SHA-equality; proven in this lane: 13/13 contract tests + live MISSING/PRESENT/no-store demonstration |
| 18 | Pass smoke tests with a STAGING-labelled receipt | PROVABLE | `smoke-test.sh` (receipt refuses a production label without two-key consent) |
| 19 | Leak no secrets: artifact scan clean; env values only in the cPanel panel; receipts value-free | PROVABLE | `artifact-exclusions.mjs` audit inside the builder + `ENV_MANIFEST.md` discipline; verify on staging: no secret in any receipt/log |
| 20 | Contain no demonstration records presented as live: bootstrap receipt `demonstrationRetailers: 0`; staging banner/labels intact; every ABCA retailer `AWAITING_VERIFICATION` unless verified | PROVABLE | bootstrap JSON receipt + `db-inspect.mjs` inventory + item 10 sweeps |

## Current tally (2026-07-26, this lane)

- PROVABLE with existing tooling: 19 of 20 (all but #4). Of these, on-host
  closure is OWNER-GATED for every item — provisioning the staging subdomain,
  cPanel app, env values, and executing the runbook are owner actions.
- BLOCKED: #4 (migration lane has not landed `prisma/migrations/**` — by
  design, `migrate.sh` hard-stops rather than improvising).
- Cross-lane ask (quality-of-life, not a blocker): base-URL parameterization
  of the HTTP test suites so items 8/11/12 close on staging AUTOMATICALLY
  instead of via the manual journey steps in the runbook.
