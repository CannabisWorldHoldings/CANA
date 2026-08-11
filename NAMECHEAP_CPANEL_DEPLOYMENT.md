# orderweeddc — Namecheap Stellar Business (cPanel) Deployment

This deploys the **exact** Next.js 16 application — no redesign, no WordPress,
no static placeholder. Builds happen **off-server** (Namecheap's own guidance;
shared hosting cannot reliably run `next build`). You upload a self-contained
standalone artifact and run it under Phusion Passenger.

- **Production commit:** see `receipt.json` inside each artifact (`gitSha`).
- **Deploy branch:** `deploy/namecheap-production`
- **Artifact:** `dist/namecheap/orderweeddc-<full-40-char-sha>.tar.gz` (+ `.sha256`)

---

## 0. Feasibility verdict (evidence-backed)

Namecheap Stellar Business **can** run this app, with three managed risks.
Evidence table: `deploy/namecheap/FEASIBILITY.md`.

| Requirement | Stellar Business | Verdict |
|---|---|---|
| Node.js version | Selector offers 20.20 / 22.22 / 24.13 | ✅ Next 16 needs ≥20.9 |
| Passenger startup file | `app.js` + `tmp/restart.txt` | ✅ provided |
| Port handling | Passenger reverse-binds the socket; app calls `.listen()` once | ✅ standalone `server.js` complies |
| Memory | 2 GB PMEM, 40 procs | ⚠️ build OFF-server (we do) |
| Database | Owner-provisioned managed PostgreSQL/PostGIS | ✅ required canonical architecture; credentials and migration remain owner-gated |
| Prisma engine | CloudLinux = RHEL 8/9 → openssl 1.1.x/3.0.x | ✅ both `binaryTargets` bundled |
| SSL | free automatic AutoSSL/SSL-proxy | ✅ apex + www |
| Cron | ≥5-min interval, ≤5 jobs | ✅ sufficient |

**Top risks:** (1) in-place server builds OOM — mitigated by off-server artifact;
(2) Prisma engine/OpenSSL mismatch — mitigated by explicit `binaryTargets`;
(3) Namecheap's own Pingora edge proxy can 502 independently of the app
(observed provider-wide on 2026-07-23) — diagnose host-side before app-side.

---

## 1. Exact cPanel values — "Setup Node.js App"

Enter these in **cPanel → Setup Node.js App → Create Application**:

| Field | Value |
|---|---|
| **Node.js version** | `20.20` (or newest ≥20.9 offered; 22.22 fine) |
| **Application mode** | `Production` |
| **Application root** | `apps/orderweeddc/current` (relative to home; **outside** `public_html`) |
| **Application URL** | `orderweeddc.com` (and add `www.orderweeddc.com`) |
| **Application startup file** | `app.js` |
| **Passenger log file** | leave default |

Then **Environment variables** (same screen — see §3). Save, then **do not**
click "Run NPM Install" (deps are pre-bundled in the artifact).

---

## 2. First deployment (one command at a time)

All commands run in **cPanel → Terminal**. Nothing here needs your Namecheap or
cPanel password typed into chat.

**2.1 — Probe the environment (read-only), paste output back:**
```
cd ~ && sh /home/$USER/uploads/probe.sh
```
(Upload `deploy/namecheap/probe.sh` to `~/uploads/` first via File Manager.)

**2.2 — Upload the artifact** `orderweeddc-<full-40-char-sha>.tar.gz` to `~/uploads/`
(File Manager → Upload), then verify its checksum:
```
cd ~/uploads && sha256sum -c orderweeddc-<full-40-char-sha>.tar.gz.sha256
```

**2.3 — Deploy code only (swaps release, keeps rollback):**
```
sh ~/uploads/deploy.sh orderweeddc-<full-40-char-sha>.tar.gz <trusted-64-hex-sha256>
```
(Upload the same-commit `deploy.sh` and `verify-owner-artifact-input.sh` beside the artifact.)

**2.4 — Initialize an empty owner-provisioned PostgreSQL database:**
```
cd ~/apps/orderweeddc/current
CANA_PRE_MIGRATION_BACKUP_RECEIPT=<provider-receipt> sh migrate.sh
/opt/alt/alt-nodejs20/root/usr/bin/node scripts/init-production-db.mjs
/opt/alt/alt-nodejs20/root/usr/bin/node scripts/db-inspect.mjs
```
This step requires separate owner authorization and a verified provider backup
receipt. The initializer creates one canonical organization and brand, zero
retailers, and zero demonstration rows. It does not import ABCA data.

**2.5 — Point cPanel at the app & restart:** in Setup Node.js App, confirm the
env vars (§3), then **Restart**. Or from Terminal:
```
sh ~/apps/orderweeddc/restart.sh
```

**2.6 — Verify (see §5).**

---

## 3. Environment variables (NO secrets in git)

Set in **Setup Node.js App → Environment variables**. Template:
`deploy/namecheap/env.production.example`.

| Variable | Value | Source |
|---|---|---|
| `DATABASE_URL` | owner-provisioned pooled PostgreSQL URL with strict TLS | owner/provider |
| `DIRECT_URL` | owner-provisioned direct PostgreSQL URL with strict TLS | owner/provider |
| `NODE_ENV` | `production` | fixed |
| `CANA_ALLOWED_HOSTS` | *(optional)* extra hostnames, comma-separated | you |
| `PRISMA_QUERY_ENGINE_LIBRARY` | `/home/<cpanel-user>/apps/orderweeddc/current/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node` | fixed path (CageFS hides os-release, so Prisma's auto-detection guesses debian; newer artifacts also self-set this in app.js) |

`orderweeddc.com` and `www.orderweeddc.com` are **built-in** allowed hosts — no
env var needed. `GEMINI_API_KEY` is **not** a production runtime variable; the
public app never calls external models. It is injected only into the
operator-side ad-creative tooling, per-run, and never stored on the server.

---

## 4. Build a new artifact (off-server, on your machine or CI)

```
git pull
CANA_VERIFIED_NODE=$HOME/.nvm/versions/node/v20.20.2/bin/node \
  SERVER_OPENSSL=1.1 CLEAN_INSTALL=1 ./deploy/namecheap/build-artifact.mjs
# → dist/namecheap/orderweeddc-<full-40-char-sha>.tar.gz (+ .sha256)
```
The builder is **webpack-only** (`next build --webpack` — Turbopack standalone
is banned for this target; see `deploy/namecheap/PRODUCTION_RELEASE_GATES.md`),
runs `npm ci` from the exact lockfile, restores brand assets, generates the
Prisma client with RHEL engines, scans every compiled server file for
unresolved hashed externals, bakes the schema-template database, and — before
keeping any tarball — proves it in TRUE ISOLATION (extracted outside the
repository, no parent node_modules, copied test DB, full health/route/restart/
rollback matrix). Results land in `receipt.json` (`bundler`, versions, scan,
isolated-test steps).

**Preferred owner deploy path** (all gates + auto-rollback in one command):
```
sh ~/uploads/verify-and-deploy.sh "<artifact-url>" "<artifact-file.tar.gz>" "<expected-sha256>"
```

---

## 5. Post-deploy verification (public domain)

```
curl -sI https://orderweeddc.com/                       # 200, HSTS, no x-powered-by
curl -s  https://orderweeddc.com/api/health | head       # {"status":"HEALTHY",...}
curl -sI https://www.orderweeddc.com/         # 308 -> https://orderweeddc.com/
curl -sI https://orderweeddc.com/pricing                 # 200
curl -sI https://orderweeddc.com/sitemap.xml             # 200
curl -sI https://orderweeddc.com/robots.txt              # 200
curl -sI https://orderweeddc.com/llms.txt                # 200
curl -sI https://orderweeddc.com/wellness.localhost      # 404 (no cross-tenant addressing)
```
Also confirm in a browser: age gate appears, homepage + mobile nav render,
retailer/neighborhood/product/strain/legal pages load, fonts + artwork load,
`/business/*` and `/admin` return noindex + no-store and redirect to login.

**Local pre-flight equivalence** (already verified on this branch, standalone
artifact): all public pages 200, all SEO surfaces 200, `/api/health` HEALTHY,
unknown host 421, www 308, spoofed tenant path 404, private surfaces 307 +
noindex, full security-header set present, no secrets in the artifact.

---

## 6. Rollback

```
sh ~/apps/orderweeddc/rollback.sh      # swaps current <- previous, restarts
```
The managed PostgreSQL database is never touched by deploy or rollback. The
broken release is preserved as `~/apps/orderweeddc/broken-<timestamp>` for
diagnosis.

**Auto-revert trigger:** if `curl -s https://orderweeddc.com/api/health` returns
non-200 or `"status":"UNHEALTHY"` after a deploy, run rollback immediately.

---

## 7. Domain & SSL

- **DNS:** already on Namecheap Web Hosting DNS. In cPanel, ensure `orderweeddc.com`
  and `www.orderweeddc.com` both map to the Node app's Application URL.
- **SSL:** Namecheap AutoSSL/SSL-proxy issues free certs automatically for apex +
  www. Verify: `curl -sI https://orderweeddc.com/` returns `200` with a valid
  chain (no cert warning). If pending, wait for the AutoSSL run or trigger it in
  cPanel → SSL/TLS Status.
