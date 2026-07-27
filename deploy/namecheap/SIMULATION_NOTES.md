# cPanel-like staging simulation

Run:

```text
./cana verify cpanel
```

The runner constructs a temporary cPanel-like tree with:

```text
releases/<sha>/
current -> releases/<active-sha>
shared/data/
shared/logs/
shared/evidence-spill/
shared/backups/
```

Each release contains a source archive, release identity, web launcher, worker launcher, SQLite migration, backup and restore scripts, plus byte-for-byte copies of the existing `deploy/namecheap` operational scripts. Release directories are read-only. Activation and rollback replace only the `current` symlink; shared data is not release-owned.

The first executed lane starts the package web launcher on an ephemeral loopback port, calls health, readiness, release and homepage endpoints, verifies the exact runtime SHA and `no-store`, runs a one-shot worker, checks shared logs/spill, migrates an old populated database, backs up and restores a sentinel, rolls back to c953ebc, observes the rolled-back runtime SHA, reactivates the candidate and smokes it again.

The second executed lane constructs a disposable cPanel account home and drives the repository's existing `deploy.sh`, `app.js`, `healthcheck.sh`, `readycheck.sh`, `smoke-test.sh`, `restart.sh`, and `rollback.sh`. It deploys base then candidate artifacts, starts the existing Passenger entrypoint, emits a staging-only smoke receipt, serves the base SHA after rollback, and serves the candidate SHA after redeployment.

A third proof uses the same immutable Node image as the deterministic verifier. A networked fetch container receives only workspace package manifests and runs `npm ci --ignore-scripts`; it never receives the repository bundle and is removed before source execution. A separate `--network none` container reconstructs the exact bundle with the fetched dependency volume, generates the real Prisma 6.19.3 client, runs the unchanged `migrate.sh` through the real Prisma CLI, requires `worker.mjs` to report `CHECKPOINTED` through `@prisma/client`, and requires `restore-backup.sh` to run the real `db-inspect.mjs` and report `coreTablesPresent=true`. It then queries the restored database for the pre-backup sentinel. Both containers and the dependency volume are removed. The image digest, network policy, output hash, bounded output tail, parsed facts, and cleanup are included in the release receipt.

The retained tarball and release receipt are labelled `CPANEL_SIMULATION`. The runtime tree, proof containers, dependency volume, and only the child processes created by the runner are removed at the end.

The filesystem lane's migration, queries, backup and restore use the `node:sqlite` implementation shipped with the exact Node runtime. The existing-script proof uses the lockfile-installed Prisma CLI and generated Prisma client. Neither lane installs or resolves a mutable host `sqlite3` system package. A passing run contains 26 executed checks and records SHA-256 hashes for every existing Namecheap script it copied and ran.

No real cPanel account, credential, DNS record, Passenger process, public listener or production data is contacted. The package and receipt do not prove a live deployment.
