# orderweeddc

`orderweeddc` is the public product. CANA is its internal deterministic
evolution and release-safety engine.
The canonical naming contract is documented in
[`docs/PRODUCT_IDENTITY.md`](docs/PRODUCT_IDENTITY.md).
The current capability comparison and measurable gap are documented in
[`docs/FRONTIER_BENCHMARK.md`](docs/FRONTIER_BENCHMARK.md).

This repository contains one production application, one deterministic
quality-contract package, and the independently supervised CANA loop:

- `apps/web` is the canonical Next.js application.
- `apps/web/prisma/schema.prisma` is the only application data model.
- `packages/ai` is a provider-free, deterministic release-quality contract. It
  does not call external models or inspect provider credentials.

The application is a truth-aware, multi-tenant cannabis directory and retailer
operations platform. Public discovery is restricted to clearly labeled
demonstration data or non-demonstration records backed by current, approved
evidence. Business claims and corrections remain private until administrator
review.

Administrators also have deterministic Site Intelligence at
`/admin/site-intelligence`. It reports local route, evidence, freshness,
index-eligibility, and handoff state with explicit uncertainty and authority
boundaries. Authenticated administrators can preserve bounded immutable
snapshots, while external search, analytics, public HTTPS, publishing, and
deployment remain separate evidence and authorization gates. See
[`docs/RSI_SITE_INTELLIGENCE_LINEAGE.md`](docs/RSI_SITE_INTELLIGENCE_LINEAGE.md)
for recovery-package provenance and limits.

## Local release workflow

From the repository root:

```powershell
npm ci
./cana verify focused
./cana verify maria
./cana verify cpanel
```

With the production server listening on port 3000:

```powershell
npm run test:http -w apps/web
node apps/web/scripts/lab-check.mjs
```

Local bootstrap credentials are generated with high entropy, written only to
the ignored local credential document, and never printed. Verifiers provision
disposable PostgreSQL/PostGIS/H3 instances and remove them after the run;
runtime logs, generated build output, local credentials, and loop state are
excluded from source control.

No deployment, external provider runtime, or external model access is part of
the application release path.

The product-discovery benchmark uses a frozen, explicitly synthetic corpus and
a disposable verifier database. Its JSON receipt is local regression
evidence only: it is not evidence of real-user conversion, revenue, legal
approval, accessibility certification, public deployment, or competitor
superiority. See [`docs/FRONTIER_BENCHMARK.md`](docs/FRONTIER_BENCHMARK.md) for
the corpus, mutation, determinism, and rollback contract.
