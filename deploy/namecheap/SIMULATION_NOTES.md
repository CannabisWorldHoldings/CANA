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

The second executed lane constructs a disposable cPanel account home and drives the repository's existing `deploy.sh`, `migrate.sh`, `app.js`, `healthcheck.sh`, `readycheck.sh`, `smoke-test.sh`, `restart.sh`, `worker.mjs`, `restore-backup.sh`, and `rollback.sh`. It deploys base then candidate artifacts, applies the exact committed migration SQL through a local `node:sqlite` adapter for the Prisma CLI contract, starts the existing Passenger entrypoint, emits a staging-only smoke receipt, verifies a hash-sidecarred backup and restored sentinel, serves the base SHA after rollback, and serves the candidate SHA after redeployment. The receipt states explicitly that the adapter run is not proof that the Prisma CLI binary ran.

The retained tarball and release receipt are labelled `CPANEL_SIMULATION`. The runtime tree and only the child processes created by the runner are removed at the end.

Migration, queries, backup and restore use the `node:sqlite` implementation shipped with the exact Node runtime. The package does not install or resolve a mutable host `sqlite3` system package. A passing run contains 25 executed checks and records SHA-256 hashes for every existing Namecheap script it copied and ran.

No real cPanel account, credential, DNS record, Passenger process, public listener or production data is contacted. The package and receipt do not prove a live deployment.
