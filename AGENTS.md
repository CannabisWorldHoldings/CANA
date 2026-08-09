# CANA Agent Instructions

## Scope

- These rules apply repository-wide; a deeper `AGENTS.md` adds or overrides rules for its subtree.
- Read `README.md`, `docs/adr/`, `docs/governance/`, `docs/geo/`, and `docs/migration/` before architectural changes.
- Verify repository and GitHub state live; PR descriptions and old receipts are evidence inputs, not current truth.

## Package Manager

- Use npm with the committed lockfile: `npm ci --no-audit --no-fund`.
- Generate Prisma Client after install: `npm run prisma:generate -w apps/web`.
- Never run `npm audit fix --force`.

## Canonical Architecture

- `apps/web/prisma/schema.prisma` is the only application data model.
- PostgreSQL + PostGIS is the single canonical datastore; see `docs/adr/0001-postgresql-postgis-canonical-datastore.md`.
- SQLite is limited to local test fixtures and the retained pre-cutover rollback snapshot. Never create a writable second datastore.
- Geo truth is owned by the PostGIS/H3 kernel. Higher-level service-area and discovery logic must consume it, not recreate spatial truth.
- Entity, registration, creative, evidence, and geographic truth each have one canonical owner. Reconcile with the existing owner instead of adding a parallel system.

## Database and Migration

- Local/disposable verification sets both `DATABASE_URL` and `DIRECT_URL`; they may target the same direct disposable PostgreSQL instance.
- Managed deployments use pooled `DATABASE_URL` and direct/unpooled `DIRECT_URL` supplied by the owner.
- Apply only committed migrations with `prisma migrate deploy`. Never use `prisma db push`, `--force-reset`, or an improvised production schema change.
- Preserve migration court, seed safety, provider portability, column-width cutover, and fresh-database proof.
- A production migration requires owner authorization and a verified provider/operator backup receipt.

## Verification

```text
./cana verify focused
./cana verify maria
./cana verify cpanel
./cana durability build
./cana durability verify
./cana durability restore --target <empty-directory>
./cana github prepare
```

- Run the focused verifier before specialized courts; all release-required lanes must pass on the exact candidate commit.
- Do not bypass runtime, dirty-tree, ownership, durability, or database contracts.
- Local, GitHub Actions, and independent review evidence are cumulative; none replaces the others.

## Ownership and Durability

- Every outgoing changed path requires exact ownership in `tools/test-runner/CODEX_CHANGED_FILE_OWNERSHIP.json`.
- Use narrow paths and legitimate lane authority. Never add repository-wide wildcards or an allow-all lane.
- Court edits remain prohibited unless the manifest binds the exact reviewed blob hash. Future court edits must fail closed.

## PR and Release Rules

- Do not merge, deploy, close PRs, rewrite history, or mutate production without explicit owner authorization.
- Keep dependency maintenance separate from architectural recovery.
- Preserve stacked ancestry and rebase/reconcile layers only after their parent is canonical.
- A red PR can contain unique work. Diagnose, transplant, or supersede with traceable evidence; never discard it merely because checks fail.

## Truth and Authority

- Label capability claims `VERIFIED_IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `PLANNED`, `RESEARCH_ONLY`, `BLOCKED`, or `FALSIFIED`.
- Unknown facts remain `UNKNOWN`; unverified facts remain `UNVERIFIED`; demonstration data never becomes customer truth.
- Never invent rankings, traffic, availability, eligibility, price, hours, ETA, inventory, licenses, reviews, revenue, analytics, provider access, deployments, production outcomes, or causal effects.
- No paid provider call, spending, sponsorship promotion, publishing, or production mutation without its explicit authority and receipt.

## Production Boundary

- Do not access cPanel, production credentials, `prod.db`, or production services during repository verification.
- cPanel is an application surface; the canonical database is a separate owner-provisioned managed PostgreSQL service.
- Preserve loopback-only development, remote-URL refusal, no-store public geo responses, evidence gates, rollback, and audit receipts.

## Commit Attribution

AI commits MUST include:

```text
Co-Authored-By: OpenAI Codex <noreply@openai.com>
```
