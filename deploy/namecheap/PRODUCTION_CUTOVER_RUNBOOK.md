# PRODUCTION cutover runbook — Namecheap cPanel

Scope: promote a staging-proven artifact to the production hostname. This
runbook PREPARES the cutover; **executing it is an OWNER decision and an
OWNER action.** Nothing here runs autonomously, and nothing below is a
statement that production is live — liveness is only ever established by the
verification receipts produced DURING an owner-executed cutover.

## 0. Entry criteria (all hard)

- [ ] `STAGING_DEFINITION_OF_DONE.md`: all 20 items carry evidence from an
      owner-executed staging run. Items marked BLOCKED are cleared.
- [ ] The candidate artifact is the EXACT tarball staging proved
      (`sha256sum -c` — byte identity, not "same branch").
- [ ] `receipt.json` inside it: `bundler: webpack`,
      `isolatedRuntimeTest.passed: true`, empty unresolved-external scan.
- [ ] The release SHA is reachable on the remote
      (`release-preflight.mjs` gate — unreachable-commit incident 2026-07-23).
- [ ] Owner has confirmed the production data plane decision. Current
      classification (`db-config.mjs`): SQLite = LOCAL_TEST_DATABASE_ONLY for
      the handoff workload; MariaDB/PostgreSQL exist on the plan
      (VENDOR-DOCUMENTED, UNVERIFIED). **Selecting and provisioning the
      production database is an owner action.**
- [ ] Rollback rehearsed on staging within this release cycle.

## 1. Pre-cutover snapshot (production account, cPanel Terminal)

```
sh ~/apps/orderweeddc/current/healthcheck.sh https://orderweeddc.com || true   # record current state
curl -s https://orderweeddc.com/api/release | tee ~/cutover-logs/release-before.json
node ~/apps/orderweeddc/current/worker.mjs --once backup                        # fresh pre-cutover backup
sha256sum ~/orderweeddc-data/prod.db | tee ~/cutover-logs/db-before.sha256
```

## 2. Deploy through the gated verifier (one command, auto-rollback)

Upload both maintained verifier files to `~/uploads` before running the gate:

- `verify-and-deploy.sh`
- `verify-owner-artifact-input.sh`

```
sh ~/uploads/verify-and-deploy.sh <https-artifact-url> orderweeddc-<shortsha>.tar.gz <expected-tarball-sha256>
```

The verifier fails closed when its adjacent structural helper is absent. It snapshots
the downloaded archive into its private verification directory, then uses that same
checksum-verified snapshot for structural inspection and extraction. The verifier
enforces: checksum, receipt and release identity acceptance, DB-hash-unchanged across
the swap, origin health with bounded retries, automatic code rollback on
failure, and separates ORIGIN health from PUBLIC-DNS health
(`ORIGIN_HEALTHY_PUBLIC_DNS_PENDING` is a real state — never conflate).

## 3. Migrations (ONLY when this release ships approved migrations)

```
cd ~/apps/orderweeddc/current && sh migrate.sh
```

Database laws apply: pre/post hashes recorded; a code-only release must show
an UNCHANGED database hash; `migrate.sh` is the only approved way a release
changes it. If the migration lane shipped nothing, this step is SKIPPED — do
not improvise schema changes on the box.

## 4. Post-cutover verification (owner-witnessed)

```
OWD_EXPECTED_SHA=<release-sha> sh ~/apps/orderweeddc/current/readycheck.sh https://orderweeddc.com
cd ~/apps/orderweeddc/current && OWD_ENVIRONMENT=production OWD_CONFIRM_PRODUCTION=1 \
  OWD_EXPECTED_SHA=<release-sha> sh smoke-test.sh https://orderweeddc.com
```

Only THIS receipt — environment `production`, produced against the production
hostname, by the owner — may state production results. A staging receipt
re-labelled after the fact is falsification; the tooling refuses to produce
one without both `OWD_ENVIRONMENT=production` and `OWD_CONFIRM_PRODUCTION=1`.

Browser spot-checks (from §5 of NAMECHEAP_CPANEL_DEPLOYMENT.md): age gate,
homepage + mobile nav, retailer/product/legal pages, `/business/*` and
`/admin` noindex + redirect to login.

## 5. Rollback triggers and procedure

Trigger on ANY of: readiness failure; `/api/health` non-200 or UNHEALTHY;
`/api/release` serving the WRONG SHA; database hash changed by a code-only
deploy; error spike in `stderr.log`.

```
sh ~/apps/orderweeddc/rollback.sh     # code-only; database untouched; broken release preserved
OWD_EXPECTED_SHA=<previous-sha> sh ~/apps/orderweeddc/current/readycheck.sh https://orderweeddc.com
```

Remember the 2026-07-23 lesson before blaming the app: the provider's Pingora
edge can 502 zone-wide. `healthcheck.sh` with `OWD_ORIGIN_IP` distinguishes
origin failure from edge failure; a host-side edge outage is NOT a rollback
trigger.

## 6. Close-out

- [ ] `release-after.json` (from `/api/release`) archived next to
      `release-before.json`; SHAs differ exactly as intended.
- [ ] Production smoke receipt archived.
- [ ] Post-cutover backup taken (`worker.mjs --once backup`).
- [ ] Deployment log updated: artifact name, tarball sha256, release SHA,
      db hashes before/after, receipts, operator, timestamps.
