# Environment-variable manifest — names only, NEVER values

Every variable the web app, worker, and ops scripts read. This file is the
authoritative inventory; `env.production.example` is the copy-paste template
for the cPanel "Setup Node.js App" panel. **No real value may ever appear in
either file, and no value below is invented — owner-supplied entries are
provisioned by the OWNER at deploy time.**

Legend — Required: R = required, O = optional, F = fixed literal.
Secret: YES = owner-supplied secret (never in git, never in chat, never in
receipts), no = non-secret configuration.

## Web application (Passenger runtime)

| Name | Purpose | Required | Secret | Supplied by |
|---|---|---|---|---|
| `DATABASE_URL` | Prisma datasource. Current data plane: `file:` SQLite path OUTSIDE the release dir (e.g. under `~/orderweeddc-data/`). If the owner selects MariaDB/PostgreSQL (see `db-config.mjs` classification), this becomes a connection string CONTAINING A PASSWORD → treat as secret then | R | path form: no · server-DB form: **YES** | Owner (cPanel env panel) |
| `NODE_ENV` | Must be `production` in every deployed environment (staging included — staging differs by data and hostname, not by build mode) | R (F: `production`) | no | Fixed |
| `PRISMA_QUERY_ENGINE_LIBRARY` | Absolute path to the bundled `rhel-openssl-1.1.x` Prisma engine. CageFS hides os-release, so auto-detection guesses wrong. `app.js` self-sets it when unset; setting explicitly is always safe | O (recommended) | no | Owner (path only) |
| `CANA_ALLOWED_HOSTS` | Extra allowed request hostnames, comma-separated, beyond the built-in tenant list. Staging host goes here (e.g. the staging subdomain) | O | no | Owner |
| `PORT` | Injected by Passenger (reverse port binding). **Never set manually** in the cPanel panel | — | no | Passenger |
| `HOSTNAME` | Bind address for the standalone server; `app.js` defaults it to `127.0.0.1` | O | no | `app.js` default |
| `RELEASE_RECEIPT_PATH` | Override path to the release-identity file for `/api/release`. Unset in normal deployments (the artifact root files are found automatically). Exists for tests and unusual layouts | O | no | Operator/tests |

## Explicitly NOT runtime variables

| Name | Why it is listed |
|---|---|
| `GEMINI_API_KEY` | **Never a production runtime variable.** The public app makes no external model calls. The key belongs to operator-side ad-creative tooling, injected per-run on the operator's machine, never stored on the server. Its appearance in a server env panel is a finding, not a configuration |
| `CANA_DEMO_ADMIN_PASSWORD` / `CANA_DEMO_RETAILER_PASSWORD` / `CANA_DEMO_CUSTOMER_PASSWORD` | Local-development seed overrides only (owner-supplied secrets when used). The production/staging bootstrap path (`bootstrap-production-db.sh` → `init-production-db.mjs` + ABCA seed) seeds **zero demonstration records**, so these must never be set on the server |

## Ops scripts (cPanel Terminal / cron), all optional overrides

| Name | Purpose | Used by | Secret |
|---|---|---|---|
| `OWD_APP_HOME` | App home override (default `$HOME/apps/orderweeddc`). Set for STAGING side-by-side installs (e.g. `$HOME/apps/orderweeddc-staging`) | `deploy.sh`, `rollback.sh`, `restart.sh`, `verify-and-deploy.sh`, `readycheck.sh` | no |
| `OWD_DATA_DIR` | Persistent data dir override (default `$HOME/orderweeddc-data`). Staging MUST set its own (e.g. `$HOME/orderweeddc-staging-data`) so staging never opens the production database | `bootstrap-production-db.sh`, `migrate.sh`, `worker.mjs`, `verify-and-deploy.sh` | no |
| `OWD_BACKUP_DIR` | Backup destination (default `$HOME/orderweeddc-backups`) | `worker.mjs`, `restore-backup.sh` | no |
| `OWD_NODE` | Absolute node binary (default CloudLinux selector path) | `bootstrap-production-db.sh`, `migrate.sh`, cron lines | no |
| `OWD_ORIGIN_IP` | Origin IP for `--resolve` health checks while public DNS lags | `verify-and-deploy.sh`, `healthcheck.sh`, `smoke-test.sh` | no |
| `OWD_BASE_URL` | Base URL under test (e.g. `https://staging.example.com`). Refuses to default to production in staging tooling | `healthcheck.sh`, `readycheck.sh`, `smoke-test.sh` | no |
| `OWD_EXPECTED_SHA` | The 40-hex SHA the deployment MUST be running; readiness fails on mismatch | `readycheck.sh`, `smoke-test.sh` | no |
| `OWD_ENVIRONMENT` | Receipt label: `staging` (default) or `production`. `smoke-test.sh` refuses to stamp `production` unless `OWD_CONFIRM_PRODUCTION=1` — **no staging receipt may claim production is live** | `smoke-test.sh` | no |
| `OWD_CONFIRM_PRODUCTION` | Explicit two-key consent for a production-labelled receipt | `smoke-test.sh` | no |
| `WORKER_HEALTH_URL` | URL the worker's `health` job probes (unset → job records SKIPPED) | `worker.mjs` | no |

## Build-time only (never on the server)

| Name | Purpose | Used by |
|---|---|---|
| `NEXT_OUTPUT` | `standalone` gates the standalone build for artifact builds only | `build-artifact.mjs` → `next.config.ts` |
| `SERVER_OPENSSL` | `1.1` prunes server-mismatched Prisma/sharp binaries | `build-artifact.mjs` |
| `CLEAN_INSTALL` | `1` forces `npm ci` before the build | `build-artifact.mjs` |
| `ALLOW_DIRTY` | `1` permits a dirty-tree THROWAWAY build (never shippable) | `release-preflight.mjs` |

## Laws

1. **No value in git.** Names, purpose, and ownership only. The artifact
   secret scan (`artifact-exclusions.mjs`) enforces this on every build.
2. **No invented values.** Where a value is owner-supplied, the runbooks say
   "owner provides"; nothing in this repo fabricates one.
3. **Fail loud on missing required config.** `app.js` refuses to start
   without `DATABASE_URL` — a site that silently starts without its database
   is worse than one that refuses to start.
