# Production release gates — immutable doctrine

No Namecheap artifact ships unless EVERY gate below passes. A failed gate is a
hard stop, never a warning. Gates bind to the exact final archive bytes: any
edit after approval creates a new candidate and invalidates all prior
approvals.

## Build gates

1. **Official-version research completed** — bundler/runtime/engine choices
   are grounded in documented evidence (see `FEASIBILITY.md`), re-verified
   when versions change.
2. **Clean state** — `.next` and the prior artifact directory removed;
   `CLEAN_INSTALL=1` runs `npm ci` against the exact committed lockfile; the
   working-tree state is recorded verbatim in `receipt.json`.
3. **Webpack standalone build** — `next build --webpack` with
   `NEXT_OUTPUT=standalone`. Turbopack standalone output is BANNED for this
   target (hashed externals incident, 2026-07-23).
4. **Unresolved hashed-external scan** — every compiled `.next/server` JS file
   is scanned for `@prisma/client-[hex]`-class references without a matching
   package inside the artifact. Any hit fails the build.
5. **Completeness checks** — `server.js`, `app.js`, `.next/static`, fonts,
   artwork, `node_modules/@prisma/client`, `node_modules/.prisma/client`,
   the `rhel-openssl-1.1.x` engine, PostgreSQL schema, and committed migrations.

## Isolation gates (the artifact, not the source tree)

6. **Extraction outside the repository** — brand-new temp directory with no
   parent `node_modules` anywhere above it; `NODE_PATH` not inherited.
7. **Disposable canonical database** — all migrations and the packaged
   production initializer run against disposable PostgreSQL with `DATABASE_URL`
   and `DIRECT_URL` bound to that same instance; must yield exactly
   `organizations:1, canonicalBrands:1, retailers:0,
   demonstrationRetailers:0, awaitingVerification:0`. Mutable market evidence
   is never a release-build invariant.
8. **Runtime matrix** from the extracted `app.js` only:
   `/api/health` 200+HEALTHY (brandCount 1, totalRetailers 0,
   verifiedRetailers 0) · homepage, pricing, robots.txt, sitemap.xml, llms.txt
   all 200 · www→apex 308 · unknown host 421 · tenant spoof 404.
9. **Restart persistence** — kill + restart; the canonical brand remains and
   the market remains empty and demonstration-free with zero bootstrap writes.
10. **Rollback integrity** — deploy→deploy→rollback executes no database
    command and leaves the measured canonical database state unchanged.
11. **Secret scan** — zero findings inside the extracted artifact.

## Delivery gates

12. **Artifact SHA-256** recorded beside the tarball and byte-verified after
    any transfer (published URL re-downloaded and re-hashed).
13. **Receipt acceptance** — `receipt.json` must carry: bundler=webpack, git
    SHA, Next + Prisma versions, engines included, pruned items, scan result,
    isolated-test results. A receipt with `isolatedRuntimeTest: pending` is
    not shippable.
14. **Command-path consistency** — every owner-facing path in the runbook,
    deploy output, and wrapper scripts must agree
    (test: `apps/web/tests/deployment-integrity.test.mjs`).
15. **Public DNS validated separately from origin health** — `curl --resolve`
    proves origin only; report `ORIGIN_HEALTHY_PUBLIC_DNS_PENDING` when public
    resolution lags. Never conflate the two.
16. **GitHub state queried live** before any claim about PRs, branches, or
    commit reachability. A merged PR is never "updated" — later fixes get a
    new branch and a new PR.

## Governance (high-impact deployment changes)

1. A builder produces candidate hash X.
2. An adversarial reviewer reproduces the prior failure against the prior
   artifact and confirms the new isolated test catches it.
3. A second independent review approves the exact unchanged candidate X.
4. Any edit after approval creates candidate Y — all earlier approvals void.
5. Only the exact approved artifact SHA may be published.

## Database laws (always)

- Code deploys and rollbacks never modify the persistent database.
- Migration requires a verified managed-provider/operator backup receipt,
  both PostgreSQL URLs, and committed migration files.
- A manual schema reversal is a separate owner-authorized database operation,
  never part of `rollback.sh`. It requires the same backup gate, an exclusive
  maintenance window, no later successful migration, and the Prisma Migrate
  advisory lock so it cannot overlap `migrate deploy` or `migrate resolve`.
- The cPanel worker never claims that a local file copy is a managed database
  backup. Provider restore authority stays outside the application runtime.
- Never bootstrap, seed, migrate, or replace a database because an endpoint
  returned 500. Exonerate or convict the database with a read-only check first.

## Diagnosis order (never skip layers by guessing)

client command → DNS → TLS/edge → vhost/Passenger → app startup (stderr) →
compiled artifact → Prisma engine → database. Label every diagnosis
PROVEN / LIKELY / HYPOTHESIS; a disproven change is recorded as disproven.
Machine-readable signatures: `failure-signatures.json`.
