# ADR-0002 — Managed PostgreSQL provider selection

- **Status:** Proposed — pending human provisioning decision
- **Date:** 2026-08-08
- **Related:** ADR-0001, `docs/geo/PROVIDER_RISK_LEDGER.md`

## Context

ADR-0001 makes managed PostgreSQL + PostGIS the canonical store. A hosting
provider must be chosen without creating existential dependency on it.

Requirements:

- real PostGIS (extension installable, not merely "geometry-ish" types)
- standard PostgreSQL wire protocol; `pg_dump`/`pg_restore` export freedom
- transaction-mode pooling compatible with Prisma's `DATABASE_URL` /
  `DIRECT_URL` split
- us-east / Virginia region for Washington DC latency
- free or very low-cost start, clean paid upgrade path
- **acceptable-use terms compatible with a lawful cannabis directory business**

## The finding that dominates this decision

Provider acceptable-use policies, not technical capability, are the binding
constraint. Technical PostGIS support is near-universal among managed
providers; permission to run a cannabis-industry business is not.

| Provider | Cannabis AUP status | Source |
|---|---|---|
| **Railway** | **PROHIBITED — cannabis dispensaries named explicitly** | legal.rail.io/legal/prohibitedbusinesses |
| **Supabase** | **HIGH RISK** — "controlled substances" prohibited, no lawful-cannabis carve-out found | supabase.com/aup |
| Neon | Ambiguous — no express ban found; defers to parent AUP | neon.com/docs/security/acceptable-use-policy |
| Crunchy Bridge | Ambiguous — no express ban; standard "violating criminal laws" language | crunchybridge.com/aup |
| DigitalOcean | Ambiguous but most favourably worded (targets "unlawful" conduct) | digitalocean.com/legal/acceptable-use-policy |
| AWS / Azure / Google Cloud | No express ban found | respective service terms |

Railway and Supabase are **eliminated on policy grounds despite being
technically adequate**. Building CANA's canonical store on a provider whose
terms name your industry as prohibited is an unacceptable business-continuity
risk: the failure mode is not degraded performance, it is account termination.

> **Not legal advice.** "No express ban found" is not affirmative permission.
> US federal law still schedules cannabis, so residual risk exists with every
> US cloud provider. Written confirmation of the specific use case (directory
> and listings; no cannabis payment processing) should be obtained from the
> chosen vendor before production launch.

## Decision

**Recommended: Neon** as the initial managed provider, with **Crunchy Bridge**
as the designated upgrade/escape target.

Rationale for Neon:

- PostGIS 3.5.0 on PG17, available on the free tier
- genuine $0 tier (0.5 GB) — far beyond the current data volume of hundreds of
  records — with a clean path to ~$19/mo
- AWS us-east-1 (Virginia): best latency to Washington DC
- native database branching, which suits an evidence/experiment workflow
- built-in transaction pooler with a documented Prisma `DIRECT_URL` pattern
- standard PostgreSQL; `pg_dump`/`pg_restore` work; no proprietary format

Known weaknesses, recorded rather than glossed:

- free-tier compute sleeps (cold starts) and PITR is only ~6 hours; upgrade to
  a paid tier before production launch
- notable control-plane incidents in 2025–2026; single-provider risk is real
- cannabis AUP is ambiguous, not affirmatively permissive

Rationale for Crunchy Bridge as escape target: the strongest PostGIS
engineering pedigree (Crunchy Data are core PostgreSQL/PostGIS contributors),
full extension suite including pgRouting, 10-day PITR, no free tier ($9+/mo).

## Provider neutrality guarantees

These are the concrete mechanisms that keep the vendor replaceable:

1. **No proprietary driver.** Standard `postgresql://` URLs only. No
   provider-specific serverless driver in the application path.
2. **No provider-specific SQL.** The geo kernel uses only standard PostgreSQL
   and PostGIS features. Verified by running the identical
   `prisma/sql/geo_kernel_postgis.sql` and `geo_smoke_test.sql` against a
   vanilla self-hosted PostgreSQL 17.8 + PostGIS 3.5.6 — both passed.
3. **Portable escape hatch.** Migration off any provider is
   `pg_dump` → `pg_restore` plus a `DATABASE_URL` change.
4. **Portability is testable.** `geo_smoke_test.sql` runs against any candidate
   host and proves in seconds whether its geo layer is adequate. Run it before
   promoting any new provider.

## Status / what is blocked

Provisioning requires human action (account creation, billing, and — for a
cannabis-industry business — ideally written AUP confirmation). The exact
unblock instruction is in `docs/migration/SQLITE_TO_POSTGRES.md`.

Everything not requiring that credential has been completed and verified
against a local PostgreSQL 17.8 + PostGIS 3.5.6 instance.
