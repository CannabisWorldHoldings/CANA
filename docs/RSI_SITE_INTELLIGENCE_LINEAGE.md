# RSI/SEO recovery package integration

## Source

- Supplied archive: `RSI_SEO_PROJECT_RECOVERY_PACKAGE (1).zip`
- Archive SHA-256:
  `9F4F364A8625684DEAE6935310A78AE07023548E9BC69489345FA97C8CBC5282`
- Integrated on: 2026-07-17

The archive was validated against absolute paths and parent-directory
traversal before being extracted to a temporary review location. Its own
recovery documentation states that the original SiteMind v3.2, v4.0, v4.1,
and v4.2 source archives were unavailable. CANA therefore does **not** claim
that those runtimes, their source, or their reported binary hashes were
recovered.

## What was integrated

The following product and safety laws were selected from the readable recovery
documents and implemented against CANA's real application state:

1. Observation must identify its evidence.
2. Uncertainty must remain visible and must never be rendered as zero.
3. A proposed action cannot silently expand its authority.
4. Local verification cannot be presented as external search or commercial
   proof.
5. Durable memory must be bounded and auditable.
6. Production writes and deployment require separate authority.
7. Outcome language must distinguish a recorded handoff from a conversion or
   revenue event.

The implementation lives in:

- `apps/web/src/lib/site-intelligence.mjs`
- `apps/web/src/lib/site-intelligence.server.ts`
- `apps/web/src/app/admin/site-intelligence/page.tsx`
- `apps/web/prisma/schema.prisma`

## Runtime boundary

The Site Brain reads canonical route and database state and produces a
deterministic observation set. An authenticated administrator may capture that
set as an immutable `SiteIntelligenceSnapshot` with child `SiteObservation`
records. Capture and its audit record are atomic. Only the newest 100 snapshots
are retained.

The feature cannot:

- publish or edit public content;
- approve evidence, claims, or corrections;
- change routes or metadata;
- deploy the application;
- connect credentials;
- infer Search Console, analytics, rankings, conversions, or revenue;
- represent local HTTP success as public HTTPS proof.

Search Console, external analytics, and public HTTPS crawl status remain
explicit external reality gates until separately authorized integrations
provide accepted evidence.

## Provenance rule

The archive hash above proves which recovery package was reviewed. It does not
prove the authenticity or completeness of any missing upstream archive named
inside that package.
