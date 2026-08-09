# ADR-0001 — PostgreSQL + PostGIS becomes the canonical CANA datastore

- **Status:** Accepted
- **Date:** 2026-08-08
- **Supersedes:** the implicit "SQLite is the production database" decision
- **Related:** ADR-0002 (hosting provider selection)

## Context

CANA's application data lived in SQLite (`provider = "sqlite"`, `apps/web/prisma/schema.prisma`),
deployed as a file on Namecheap cPanel shared hosting. Geography was represented
by two bare `Float` columns (`Retailer.lat`, `Retailer.lng`) and rendered with
Leaflet against CARTO raster tiles.

The CANA Geo Intelligence Kernel mission requires capabilities SQLite cannot
provide at any level of effort:

- exact geometry with a real spatial type and SRID
- spatial indexing (GiST) for viewport, radius and containment queries
- polygon containment and intersection for jurisdictions and service areas
- geodesic distance (metres on the ellipsoid, not degrees)
- temporal geographic state and provenance at scale
- a foundation for H3 aggregation, routing, isochrones and a feature store

SQLite has no geometry type, no spatial index, and no geodesic functions.
SpatiaLite exists but is not supported by Prisma and would not be installable
on the shared-hosting target either.

### The constraint that was NOT allowed to decide this

Shared cPanel hosting cannot run PostGIS, Valhalla, or a tile server. The
tempting conclusion is "therefore CANA cannot have PostGIS." That reasoning
lets the weakest deployment surface define the architecture ceiling. It is
rejected. cPanel is one deployment surface; the database is a separate,
network-reachable managed service.

## Decision

**PostgreSQL with the PostGIS extension is the single canonical CANA datastore.**

- `apps/web/prisma/schema.prisma` uses `provider = "postgresql"` with a
  `directUrl` for migrations and `extensions = [postgis]`.
- The web application, wherever it is deployed, opens an outbound TLS
  connection to managed PostgreSQL. It no longer reads a local database file.
- SQLite is retained **only** as a pre-migration rollback snapshot artifact.
  It is explicitly **not** a second writable production store. A permanent
  dual-store split-brain is prohibited.
- Geometry is a real `geometry(Point, 4326)` column with a GiST index, not a
  pair of floats.

### Consequences accepted

- The application now has a hard network dependency on the database. A DB
  outage is an application outage; previously a file could not be "unreachable."
  Mitigated by connection pooling, TLS, and provider selection (ADR-0002).
- Latency per query rises from microseconds (local file) to single-digit
  milliseconds (same-region managed Postgres). Irrelevant at current volume
  (hundreds of records) and a fair price for real spatial capability.
- `prisma migrate` now needs an unpooled `DIRECT_URL` alongside the pooled
  `DATABASE_URL`.
- Deployment gains a secret (the database URL) that must never reach a client
  bundle. Enforced by test.

## Alternatives considered and rejected

**Keep SQLite; do geometry in application code.** Rejected. Haversine in JS
cannot do polygon containment, cannot use a spatial index, and would degrade
to full table scans. It also pushes geometry into the LLM/application layer,
which the mission explicitly forbids: geometry must be computed by
deterministic engines.

**SQLite now, PostGIS adapter behind a port, swap later.** A defensible
staging strategy, and it was offered. Rejected by decision-maker in favour of
converging on one truth layer immediately, on the grounds that a port with no
production implementation tends to encode SQLite's limitations into its own
interface and the "later" swap rarely happens.

**Dual store — SQLite for the app, PostGIS as a geo warehouse.** Rejected.
Two sources of truth violates the anti-duplication rule and creates entity
drift between the operational record and its geographic twin, which is exactly
the failure mode the evidence architecture exists to prevent.

## Verification

This decision was validated against a real instance, not assumed:

| Check | Result |
|---|---|
| PostgreSQL | 17.8 |
| PostGIS | 3.5.6 (GEOS 3.14.1, PROJ 9.8.1) |
| `CREATE EXTENSION postgis` | succeeded |
| `ST_Contains` DC polygon test | correctly excluded Silver Spring, MD |
| `ST_Distance` geography | Dupont Circle → White House = 1460 m (correct) |
| `ST_DWithin` 3 km | returned exactly Dupont + Georgetown |
| GiST index usage | confirmed `Index Scan` via `EXPLAIN` |
| `prisma/sql/geo_smoke_test.sql` | 14/14 assertions passed |
| Negative control (DB without PostGIS) | gate correctly FAILED, exit 3 |

The negative control matters: it proves the gate detects a broken geo layer
rather than passing vacuously.
