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
| Data dir | `~/orderweeddc-data` | `~/orderweeddc-staging-data` (`OWD_DATA_DIR`) |
| Hostname | `orderweeddc.com` / `www` | owner-chosen staging subdomain, added via `CANA_ALLOWED_HOSTS` |
| cPanel Node app | production entry | a SECOND "Setup Node.js App" entry |
| Backups | `~/orderweeddc-backups` | `~/orderweeddc-staging-backups` (`OWD_BACKUP_DIR`) |

Staging must NEVER read `~/orderweeddc-data/prod.db`. Every staging command
below sets `OWD_*` overrides explicitly — copy-paste them as written.

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
DATABASE_URL=file:/home/<cpanel-user>/orderweeddc-staging-data/prod.db
NODE_ENV=production
CANA_ALLOWED_HOSTS=<staging-subdomain>
PRISMA_QUERY_ENGINE_LIBRARY=/home/<cpanel-user>/apps/orderweeddc-staging/current/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node
```

Do NOT click "Run NPM Install" — dependencies are pre-bundled.

## 3. Upload + verify + deploy the artifact

```
mkdir -p ~/orderweeddc-staging-data
cd ~/uploads && sha256sum -c orderweeddc-<shortsha>.tar.gz.sha256
OWD_APP_HOME=$HOME/apps/orderweeddc-staging sh ~/uploads/deploy.sh orderweeddc-<shortsha>.tar.gz
```

## 4. Create the EMPTY provider database, then initialize

```
cd ~/apps/orderweeddc-staging/current
OWD_DATA_DIR=$HOME/orderweeddc-staging-data sh bootstrap-production-db.sh
```

The bootstrap installs the build-verified schema template ONLY into an
absent/empty database, then runs the idempotent canonical init and the real
ABCA retailer seed (`AWAITING_VERIFICATION`, **zero demonstration records**).
It prints a JSON verification receipt — keep it in the staging log.

## 5. Apply migrations (BY CONVENTION — migration lane's work)

```
cd ~/apps/orderweeddc-staging/current
OWD_DATA_DIR=$HOME/orderweeddc-staging-data sh migrate.sh
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
OWD_DATA_DIR=$HOME/orderweeddc-staging-data OWD_BACKUP_DIR=$HOME/orderweeddc-staging-backups node worker.mjs --once backup
```

Then install the cron line (cPanel → Cron Jobs; ≥ 5-minute granularity,
absolute selector node path — cron does not inherit the app env):

```
17 3 * * * cd $HOME/apps/orderweeddc-staging/current && OWD_DATA_DIR=$HOME/orderweeddc-staging-data OWD_BACKUP_DIR=$HOME/orderweeddc-staging-backups /opt/alt/alt-nodejs20/root/usr/bin/node worker.mjs --once backup >> $HOME/orderweeddc-staging-backups/cron.out 2>&1
```

Graceful-shutdown proof: start `node worker.mjs --loop --interval-ms 10000`,
send SIGTERM, confirm the log ends with `worker-shutdown","graceful":true`
and the lock dir is gone.

## 9. Backup / restore-elsewhere proof

```
cd ~/apps/orderweeddc-staging/current
OWD_DATA_DIR=$HOME/orderweeddc-staging-data OWD_BACKUP_DIR=$HOME/orderweeddc-staging-backups node worker.mjs --once backup
sh restore-backup.sh $HOME/orderweeddc-staging-backups/prod-<stamp>.db $HOME/restore-proof/prod.db
```

`restore-backup.sh` verifies the checksum, refuses to overwrite, and proves
the restored file readable via `db-inspect.mjs` — restorability is only
proven by the inventory it prints.

## 10. Rollback drill

Deploy the SAME artifact a second time (creates `previous`), then:

```
OWD_APP_HOME=$HOME/apps/orderweeddc-staging sh ~/apps/orderweeddc-staging/rollback.sh
OWD_DATA_DIR=$HOME/orderweeddc-staging-data  # db hash must be UNCHANGED by the swap
```

## 11. Restart-survival drill

`restart.sh`, then re-run step 6 and confirm identical counts and the same
release SHA. Repeat once via the cPanel UI Restart button.

## 12. Close out

Work through `STAGING_DEFINITION_OF_DONE.md` item by item, marking each with
evidence (command output, receipt path). Anything not proven stays open —
staging is DONE when all 20 items carry evidence, not when the site "looks
fine".
