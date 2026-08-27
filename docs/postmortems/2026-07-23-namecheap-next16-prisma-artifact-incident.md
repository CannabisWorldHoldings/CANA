# Postmortem: Next 16 Turbopack standalone artifact incident (2026-07-23)

**Status:** resolved · production HEALTHY · all permanent controls implemented
**Severity:** launch-blocking (no data loss; database provably untouched)
**Owner impact:** ~2 hours of guided terminal work across 4 failed attempts

## Timeline (UTC)

| Time | Event |
|---|---|
| ~11:20 | First artifact (`c2b9c17`, Turbopack) deployed to `~/apps/orderweeddc/current` |
| ~11:48 | Owner merges PR #3 (head `b336327`); branch auto-reset to merge head |
| ~12:04 | DB init fails: `The table main.Brand does not exist` — no schema bootstrap existed |
| ~12:20 | Schema-template + guarded bootstrap shipped (`c2796de`/`33e7bae`); bootstrap succeeds: 1 brand, 74 retailers |
| ~12:40 | App still 500. Direct DB test proves `{"database":"UP","brands":1,"retailers":74}` — DB exonerated |
| ~12:50 | Direct app start exposes: `Cannot find module '@prisma/client-2c3a283f134fdcb6'` |
| ~13:00 | Root cause confirmed: Turbopack hashed external, unresolvable in artifact |
| ~13:05 | Webpack artifact (`c1e8ac7`) built, proven in true isolation, deployed |
| ~13:08 | Production `/api/health`: HTTP 200, HEALTHY, brandCount 1, totalRetailers 74. DB hash identical before/after swap |

## Root cause

Next.js 16 defaults to Turbopack, whose standalone output externalizes
generated hashed package references (`@prisma/client-<hex>`) that have no
resolvable package inside the assembled artifact.

## Contributing factor: the contaminated smoke test

The pre-ship smoke test ran the artifact from `dist/namecheap/<name>/` —
**inside the repository tree**. Node's upward `node_modules` resolution
silently satisfied the unresolvable import from the repo's own dependencies,
making an incomplete artifact appear healthy. Local success is not artifact
success; the release candidate is the exact final archive bytes.

## Incorrect assumptions made during diagnosis

1. `HOSTNAME=127.0.0.1` theory presented before proof — change did not alter
   the failure; recorded as disproven (HYPOTHESIS mislabeled as fix).
2. Runbook restart path (`~/apps/orderweeddc/restart.sh`) did not match the
   packaged layout (`current/restart.sh`) — commands were published without
   execution against the exact artifact layout.
3. PR #3 reported as "updated, not merged" from narrative memory while GitHub
   showed it merged — remote state must be queried live before every claim.
4. A cPanel Terminal disconnect was initially conflated with app health; a
   pasted-command concatenation (`/api/healthcurl`) produced a misleading 404.

## What went right

- The persistent database at `~/orderweeddc-data/prod.db` was never touched by
  any deploy or rollback: SHA-256 identical before/after the replacement swap.
- The layered diagnosis (DNS → edge → Passenger → startup → artifact → engine
  → database) eventually isolated the failing layer without data risk.
- Bootstrap hard-stop rules prevented any destructive database action.

## Permanent controls (all implemented in this repo)

| Control | Location |
|---|---|
| Webpack-only artifact builds (`next build` under pinned Next 15.5.24) | `deploy/namecheap/build-artifact.mjs` |
| Unresolved hashed-external hard-stop scan (all `.next/server` JS) | builder, `unresolvedExternalScan` in receipt |
| True-isolation runtime test before any artifact is kept (extract outside repo, no parent `node_modules`, cleared env, copied test DB, health/pages/boundaries/restart/rollback) | builder phase 5 |
| Release gates doctrine | `deploy/namecheap/PRODUCTION_RELEASE_GATES.md` |
| Owner-safe verifier (one command, all gates, auto-rollback, DB-hash guard) | `deploy/namecheap/verify-and-deploy.sh` |
| Command-path consistency test | `apps/web/tests/deployment-integrity.test.mjs` |
| Artifact-contamination regression (red-before/green-after fixture) | `apps/web/tests/deployment-integrity.test.mjs` |
| Failure-signature knowledge base | `deploy/namecheap/failure-signatures.json` |
| Stable restart/rollback wrappers installed by deploy.sh at `~/apps/orderweeddc/` | `deploy/namecheap/deploy.sh` |
| Sentinel durable memory entry | `docs/sentinel-memory.md` (2026-07-23 incident entry) + platform memory |

## Follow-up ownership

| Action | Owner | Status |
|---|---|---|
| All controls above | Sentinel (this repo) | DONE |
| New PR for post-merge hotfixes (merged PR cannot be updated) | Sentinel | DONE (see PR referenced in commit) |
| First committed Prisma migration to replace `db push` template path | Sentinel, next HEAL cycle | OPEN |
| Public DNS + SSL validation once Namecheap edge stabilizes | Owner + Sentinel | OPEN |
