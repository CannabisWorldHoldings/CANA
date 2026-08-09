# Namecheap Stellar Business (cPanel) — exact account capabilities

Companion to `FEASIBILITY.md` (evidence table, compiled 2026-07-23) and the
2026-07-23 production incident record. Every claim below carries one of three
evidence tiers — do not silently promote a claim to a higher tier:

- **FIRST-PARTY VERIFIED** — proven by THIS project's own probes, deployments,
  or incidents on the real account (host `business194`), recorded in this repo.
- **VENDOR-DOCUMENTED** — stated by Namecheap KB / cPanel docs / Phusion
  Passenger docs; not independently re-proven by us.
- **UNVERIFIED** — needed, plausible, but proven by nobody yet. Each has a
  named probe that settles it (`probe.sh` unless stated).

## 1. Node.js application interface

| Capability | Detail | Tier |
|---|---|---|
| "Setup Node.js App" UI (CloudLinux Node Selector) | Create app: version, mode, application root, application URL, startup file, env vars, Passenger log file | FIRST-PARTY VERIFIED — the production app was created and ran through this UI (incident record 2026-07-23) |
| Node versions offered | 6.17 → 24.13 incl. 20.20 / 22.22 / 24.13 (KB page updated 2026-02-19); Next 16 requires ≥ 20.9 | VENDOR-DOCUMENTED (KB 129/22, KB 10047); exact list on THIS account: UNVERIFIED until `probe.sh` (`/opt/alt/alt-nodejs*` scan) |
| Selector node binary path | `/opt/alt/alt-nodejsNN/root/usr/bin/node` | FIRST-PARTY VERIFIED historically; current artifact uses the bundled runtime and `migrate.sh` may use the selector CLI path |
| App root must sit OUTSIDE `public_html` | We use `~/apps/orderweeddc/current` | VENDOR-DOCUMENTED (KB 10686); layout FIRST-PARTY VERIFIED in production |

## 2. Startup file & reverse proxy (Passenger)

| Capability | Detail | Tier |
|---|---|---|
| Startup file | Default `app.js` (else `PassengerStartupFile`). Ours: `deploy/namecheap/app.js` → requires `./server.js` (Next standalone) | FIRST-PARTY VERIFIED — ran in production |
| Reverse port binding | Passenger supplies `PORT`; the app must `.listen()` exactly once; the requested port is ignored | VENDOR-DOCUMENTED (Phusion docs, cPanel docs); compatible behavior of Next standalone `server.js` FIRST-PARTY VERIFIED in the isolated artifact test |
| Restart signal | `touch <app-root>/tmp/restart.txt` restarts the app; `tmp/` must exist | FIRST-PARTY VERIFIED — `restart.sh` used in production; also VENDOR-DOCUMENTED (cPanel) |
| Process count | Passenger on shared cPanel manages worker processes; per-app tuning (`PassengerMaxPoolSize` etc.) is NOT operator-controllable on shared | VENDOR-DOCUMENTED / UNVERIFIED for exact values on this account |

## 3. Git deployment, SSH, Terminal

| Capability | Detail | Tier |
|---|---|---|
| cPanel Terminal | Interactive shell in browser; all deploy commands were run through it | FIRST-PARTY VERIFIED |
| SSH | Available on Stellar Business (enable in cPanel; key auth) | VENDOR-DOCUMENTED; not exercised by us — UNVERIFIED |
| cPanel "Git Version Control" | Exists (clone repo, deploy via `.cpanel.yml`) | VENDOR-DOCUMENTED. **Deliberately unused**: in-place `next build` is unreliable under the 2 GB LVE (Namecheap's own KB 10686 says build locally), so our pipeline ships a pre-built artifact tarball instead. Treat git-deploy-to-server as UNVERIFIED and out of scope |

## 4. Environment variables

| Capability | Detail | Tier |
|---|---|---|
| Set via Setup Node.js App UI | Re-injected on each Passenger spawn; persist across restarts | FIRST-PARTY VERIFIED — `DATABASE_URL` and `PRISMA_QUERY_ENGINE_LIBRARY` carried the production app (persistence across many restarts: VENDOR-DOCUMENTED + observed, no long-horizon proof) |
| No secrets in git | Values live only in the UI; templates in `env.production.example`, names in `ENV_MANIFEST.md` | Policy — enforced by artifact secret scan (FIRST-PARTY VERIFIED tooling) |

## 5. Database connectivity

| Capability | Detail | Tier |
|---|---|---|
| SQLite on `/home` filesystem | Historical runtime was proven, but it is now restricted to local tests and the retained pre-cutover rollback snapshot | FIRST-PARTY historical evidence; **not a canonical deployment option** |
| Outbound TLS to managed PostgreSQL/PostGIS | Required by ADR-0001; exact provider/account connectivity is owner-gated | UNVERIFIED on this cPanel account until staging; local disposable PostgreSQL verifier is not production proof |
| MariaDB 11.4.9 | Offered on the plan (cPanel MySQL Databases UI) | VENDOR-DOCUMENTED (KB 129/22); provisioning/connectivity from Node: UNVERIFIED |
| PostgreSQL 10.23 | Listed for Stellar Plus/Business | VENDOR-DOCUMENTED (KB 129/22, corrected finding); UNVERIFIED on this account |
| Prisma engine on CloudLinux | CageFS hides `/etc/os-release` → Prisma platform detection guesses `debian` while the host is RHEL-family (OpenSSL 1.1.1k FIPS, probed live) → must pin `PRISMA_QUERY_ENGINE_LIBRARY` to the bundled `rhel-openssl-1.1.x` engine | FIRST-PARTY VERIFIED — genuine production incident, fix shipped in `app.js` |

## 6. SSL

| Capability | Detail | Tier |
|---|---|---|
| Free AutoSSL / SSL-proxy for apex + www | Automatic issuance on shared | VENDOR-DOCUMENTED (KB 10504/10743/10728); issuance latency and staging-subdomain coverage: UNVERIFIED |
| Provider edge (Pingora) in front of origin (LiteSpeed 6.2.2) | The edge can 502 zone-wide independent of the app — observed live on 2026-07-23 across `namecheaphosting.com`, `cp.`, `webmail.`, and our domain | FIRST-PARTY VERIFIED (live header probes). Diagnosis law: edge before app |

## 7. Writable persistent directories

| Capability | Detail | Tier |
|---|---|---|
| `$HOME` is persistent and writable | Releases at `~/apps/orderweeddc/{current,previous}`, data at `~/orderweeddc-data/`, uploads at `~/uploads/`, backups at `~/orderweeddc-backups/` | FIRST-PARTY VERIFIED for the first three (production layout); backups dir is new — created by `worker.mjs` |
| Quota / inode limits | Plan-dependent | VENDOR-DOCUMENTED; headroom on this account UNVERIFIED (`df -h $HOME` in `probe.sh`) |

## 8. Cron / scheduled workers

| Capability | Detail | Tier |
|---|---|---|
| cPanel Cron Jobs | Minimum interval 5 minutes, ≤ 5 simultaneous jobs | VENDOR-DOCUMENTED (KB 9453/29) |
| Long-running daemons | No documented prohibition, but constrained by LVE (40 entry processes, 2 GB PMEM) and provider process-management policy | UNVERIFIED / under-documented — our worker model is cron-tick (`worker.mjs --once`), not a daemon, precisely to avoid this |
| Cron environment | Cron does NOT inherit the Node Selector PATH or the app's env vars; jobs must use the absolute selector node path and set their own env | VENDOR-DOCUMENTED (CloudLinux); exact behavior UNVERIFIED — `WORKER` section of `STAGING_RUNBOOK.md` proves it on staging |

## 9. Process restart

| Capability | Detail | Tier |
|---|---|---|
| `touch tmp/restart.txt` | Rolling restart of the Passenger app | FIRST-PARTY VERIFIED (`restart.sh`) |
| "Restart" button in Setup Node.js App | Same effect via UI | FIRST-PARTY VERIFIED |
| Graceful shutdown signals | Passenger sends SIGTERM on restart/shutdown; in-flight requests are drained per Passenger policy | VENDOR-DOCUMENTED; drain behavior under load on this account UNVERIFIED |

## 10. Memory & execution limits (LVE, Stellar Business)

| Capability | Detail | Tier |
|---|---|---|
| CPU 100% (burst 400%), PMEM 2 GB, 40 entry processes, IO 50 MB/s | LVE faults appear in cPanel → Resource Usage | VENDOR-DOCUMENTED (KB 1127/103) |
| `next build` on-server exceeds what shared can reliably give | Namecheap's own guide says build locally and upload | VENDOR-DOCUMENTED (KB 10686) + FIRST-PARTY VERIFIED consequence: our pipeline is off-server artifact only |

## 11. Log locations

| Capability | Detail | Tier |
|---|---|---|
| App stderr | `stderr.log` in the application root (cPanel Node apps); "Passenger log file" field in the UI can redirect | VENDOR-DOCUMENTED; exact paths on this account UNVERIFIED (confirm during staging: `ls ~/apps/orderweeddc/current/stderr.log`, UI field value) |
| Web server / access logs | cPanel → Metrics → Raw Access / Errors | VENDOR-DOCUMENTED |
| Application-level receipts | `receipt.json` + `release.json` inside every release; worker writes `~/orderweeddc-backups/worker-log.jsonl` | FIRST-PARTY (ours, by construction) |

## Standing corrections (do not re-litigate)

1. **Turbopack standalone is banned for this target.** Its standalone output
   externalizes hashed package references (`@prisma/client-<hex>`) that are
   unresolvable outside the build tree. FIRST-PARTY VERIFIED production
   incident (2026-07-23, host business194). Webpack (`next build --webpack`)
   only. Enforced by `build-artifact.mjs` + `deployment-integrity.test.mjs`.
2. **Prisma auto-detection lies under CageFS.** Pin the engine (see §5).
3. **A 502 is not necessarily your app.** The provider's Pingora edge 502'd
   zone-wide on 2026-07-23. Diagnose host-side first
   (`failure-signatures.json`).
