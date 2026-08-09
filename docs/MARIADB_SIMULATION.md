# MariaDB 11.4 candidate simulation

Run:

```text
./cana verify maria
```

The runner starts the reviewed MariaDB 11.4.9 image by immutable digest on an internal Docker network with tmpfs data and no published host port. A disposable, digest-pinned Node 24 fetch container receives only the five workspace package manifests, runs `npm ci --ignore-scripts`, and explicitly prefetches the lockfile-pinned Prisma 6.19.3 engines; the candidate bundle and database credentials are absent. That container is removed before source execution. A separate client reconstructs the exact bundle with the fetched dependency volume attached and joins only the internal database network, with no Docker bridge or external egress. It then receives the ephemeral database URL, validates, and pushes `tools/mariadb-sim/schema.prisma`, which is mechanically generated from the live canonical PostgreSQL schema by `generate-schema.mjs`.

The provider flip, PostgreSQL-only datasource removal, generic MariaDB geometry declaration, and all required `@db.Text` annotations exist only in the candidate schema. The live `apps/web/prisma/schema.prisma` remains PostgreSQL + PostGIS. `candidate-cutover.sql` adds a candidate-only check that rejects an `ATTRIBUTION` row with a NULL event identity while retaining NULL for money rows.

Executed scenarios include:

- 405-byte, 1 KiB, representative 64-link and 65,535-byte JSON evidence chains;
- host/database SHA-256 and JSON preservation after round trip;
- strict and non-strict SQL modes, including truncation falsification;
- the unchanged `db-config.mjs` information-schema provider branch;
- DATETIME(3) with a persisted and recomputed ledger entryHash;
- case-insensitive collisions on the generated `User.email` and `Brand.domain` uniques;
- duplicate identity plus two same-merchant NULL identities under the relied-upon unique index;
- sequence contention, deadlock with ordered retry and connection exhaustion/recovery;
- empty, populated, old, interrupted and concurrent migration cases;
- logical backup, destructive-in-simulation restore and transaction rollback.

The logical backup is hash-checked during the run, restored, and then discarded with the database container. The dependency fetch container, candidate client, dependency volume, database container, and internal network are independently checked for removal. Machine and Markdown execution reports are written to the configured receipt directory.

## Remaining database claim

The business implementation caps an evidence chain at 64 links but does not cap bytes in each link’s `step` or `ref`. Consequently, no finite “maximum approved evidence-chain bytes” exists. The runner proves the MariaDB TEXT ceiling and a representative 64-link chain; it does not reinterpret the database limit as business approval. The prohibited implementation file is reported by exact hash and is not changed in this lane.

This is executed local compatibility evidence, not proof of a hosted production database, production data migration, production load or live rollback.
