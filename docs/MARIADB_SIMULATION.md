# MariaDB 11.4 candidate simulation

Run:

```text
./cana verify maria
```

The runner starts `mariadb:11.4.9` on an internal Docker network with tmpfs data and no published host port. A disposable Node 24 client validates and pushes `tools/mariadb-sim/schema.prisma`, which is mechanically generated from the live SQLite schema by `generate-schema.mjs`.

The provider flip and all required `@db.Text` annotations exist only in the candidate schema. The live `apps/web/prisma/schema.prisma` remains SQLite. `candidate-cutover.sql` adds a candidate-only check that rejects an `ATTRIBUTION` row with a NULL event identity while retaining NULL for money rows.

Executed scenarios include:

- 405-byte, 1 KiB, representative 64-link and 65,535-byte JSON evidence chains;
- host/database SHA-256 and JSON preservation after round trip;
- strict and non-strict SQL modes, including truncation falsification;
- DATETIME(3), case-insensitive collation collisions and duplicate identity;
- sequence contention, deadlock with ordered retry and connection exhaustion/recovery;
- empty, populated, old, interrupted and concurrent migration cases;
- logical backup, destructive-in-simulation restore and transaction rollback.

The logical backup is hash-checked during the run, restored, and then discarded with the database container. Machine and Markdown execution reports are written to the configured receipt directory.

## Remaining database claim

The business implementation caps an evidence chain at 64 links but does not cap bytes in each link’s `step` or `ref`. Consequently, no finite “maximum approved evidence-chain bytes” exists. The runner proves the MariaDB TEXT ceiling and a representative 64-link chain; it does not reinterpret the database limit as business approval. The prohibited implementation file is reported by exact hash and is not changed in this lane.

This is executed local compatibility evidence, not proof of a hosted production database, production data migration, production load or live rollback.
