# STAGING runbook — Namecheap cPanel

Purpose: bring up a COMPLETE staging installation of the exact production
artifact, side by side with (and fully isolated from) production, and prove
every item in `STAGING_DEFINITION_OF_DONE.md` before any cutover talk.

**This runbook PREPARES a deployment. Executing it is an OWNER action** — it
requires the owner's cPanel access, a staging hostname, and owner-typed
environment values. Nothing in this repo performs it autonomously, and no
receipt from this runbook may claim production is live.

## Isolation invariants (read first)

| Concern | Production | Staging |
|---|---|---|
| App home | `~/apps/orderweeddc` | `~/apps/orderweeddc-staging` (`OWD_APP_HOME`) |
| Database | owner-provisioned production PostgreSQL | separate owner-provisioned staging PostgreSQL |
| Hostname | `orderweeddc.com` / `www` | owner-chosen staging subdomain, added via `CANA_ALLOWED_HOSTS` |
| cPanel Node app | production entry | a SECOND "Setup Node.js App" entry |
| Backups | provider/operator production policy | separate provider/operator staging backup + receipt |

Staging must NEVER receive production database credentials. Both staging URLs
must identify only the owner-provisioned staging database.

## 0. Preconditions (owner-gated)

- [ ] OWNER: staging subdomain created in cPanel (e.g. `staging.<domain>`),
      pointed at the account, SSL issued (AutoSSL run or wait; see
      CAPABILITIES.md §6 — issuance timing is UNVERIFIED).
- [ ] OWNER: cPanel Terminal access.
- [ ] Artifact built off-server on the release commit:
      `node deploy/namecheap/build-artifact.mjs` → tarball + `.sha256`
      (the builder's receipt must show `isolatedRuntimeTest.passed: true`).
- [ ] Release SHA recorded: `EXPECTED_SHA=$(git rev-parse HEAD)` on the
      release branch — you will pin readiness against it.

## 1. Probe the environment (read-only)

Upload `probe.sh` to `~/uploads/`, then:

```
sh ~/uploads/probe.sh
```

Paste the output into the staging log. This settles the UNVERIFIED rows in
`CAPABILITIES.md` (node versions on this account, OpenSSL, quotas, cron).

## 2. Create the staging Node app (cPanel UI — owner)

Setup Node.js App → Create Application:

| Field | Value |
|---|---|
| Node.js version | newest ≥ 20.9 offered |
| Application mode | `Production` (staging differs by DATA and HOST, not build mode) |
| Application root | `apps/orderweeddc-staging/current` |
| Application URL | the staging subdomain |
| Startup file | `app.js` |

Environment variables (names in `ENV_MANIFEST.md`; values owner-typed, never
in git):

```
DATABASE_URL=postgresql://<owner-pooled-staging-url>
DIRECT_URL=postgresql://<owner-direct-staging-url>
NODE_ENV=production
CANA_ALLOWED_HOSTS=<staging-subdomain>
PRISMA_QUERY_ENGINE_LIBRARY=/home/<cpanel-user>/apps/orderweeddc-staging/current/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node
```

Do NOT click "Run NPM Install" — dependencies are pre-bundled.

## 3. Upload + verify + deploy the artifact

```
cd ~/uploads && sha256sum -c orderweeddc-<shortsha>.tar.gz.sha256
OWD_APP_HOME=$HOME/apps/orderweeddc-staging sh ~/uploads/deploy.sh orderweeddc-<shortsha>.tar.gz
```

## 4. Create the EMPTY provider database

Use the owner-selected managed PostgreSQL provider. Enable PostGIS/H3 as the
migration runbook requires, capture a restorable provider snapshot/branch, and
save its non-secret receipt. Provider choice and credentials remain owner-gated.

## 5. Apply migrations (BY CONVENTION — migration lane's work)

```
cd ~/apps/orderweeddc-staging/current
CANA_PRE_MIGRATION_BACKUP_RECEIPT=<receipt-path> sh migrate.sh
```

`migrate.sh` applies `prisma/migrations/**` exactly as committed by the
migration lane and HARD-STOPS if none are shipped (that is the correct
behavior until that lane lands — record the stop in the log, not a workaround).

## 6. Restart, then prove readiness

```
OWD_APP_HOME=$HOME/apps/orderweeddc-staging sh ~/apps/orderweeddc-staging/restart.sh
OWD_EXPECTED_SHA=<EXPECTED_SHA> sh ~/apps/orderweeddc-staging/current/readycheck.sh https://<staging-subdomain>
```

Readiness REQUIRES `/api/release` to serve exactly `<EXPECTED_SHA>` — a
healthy app running unknown code is a failed readiness check.

## 7. Smoke test (writes a STAGING receipt)

```
cd ~/apps/orderweeddc-staging/current
OWD_EXPECTED_SHA=<EXPECTED_SHA> sh smoke-test.sh https://<staging-subdomain>
```

The receipt is labelled `staging` and states in plain text that it makes no
claim about production. That sentence is load-bearing; do not edit it out.

## 8. Worker: cron tick + graceful shutdown proof

```
cd ~/apps/orderweeddc-staging/current
WORKER_HEALTH_URL=https://<staging-subdomain>/api/health node worker.mjs --once health
```

Then install the cron line (cPanel → Cron Jobs; ≥ 5-minute granularity,
absolute selector node path — cron does not inherit the app env):

```
*/5 * * * * mkdir -p $HOME/orderweeddc-staging-backups && cd $HOME/apps/orderweeddc-staging/current && OWD_BACKUP_DIR=$HOME/orderweeddc-staging-backups WORKER_HEALTH_URL=https://<staging-subdomain>/api/health /opt/alt/alt-nodejs20/root/usr/bin/node worker.mjs --once health >> $HOME/orderweeddc-staging-backups/cron.out 2>&1
```

Graceful-shutdown proof: start `node worker.mjs --loop --interval-ms 10000`,
send SIGTERM, confirm the log ends with `worker-shutdown","graceful":true`
and the lock dir is gone.

## 9. Managed backup / restore-elsewhere proof

Use the provider/operator backup mechanism, restore into a distinct staging
database, run `db-inspect.mjs --assert-core` plus the geo smoke test against
that restored URL, and retain the redacted receipt. The web worker intentionally
refuses to fabricate this proof from a local file.

## 10. Rollback drill

Deploy the SAME artifact a second time (creates `previous`), then:

```
OWD_APP_HOME=$HOME/apps/orderweeddc-staging sh ~/apps/orderweeddc-staging/rollback.sh
```

Re-run the read-only database inventory before and after; a code swap executes
no migration and the measured counts/migration set must remain unchanged.

## 11. Restart-survival drill

`restart.sh`, then re-run step 6 and confirm identical counts and the same
release SHA. Repeat once via the cPanel UI Restart button.

## 12. Close out

Work through `STAGING_DEFINITION_OF_DONE.md` item by item, marking each with
evidence (command output, receipt path). Anything not proven stays open —
staging is DONE when all 20 items carry evidence, not when the site "looks
fine".
