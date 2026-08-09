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

Each release contains a source archive, release identity, web launcher, worker launcher, simulation-control migration/backup/restore fixtures, plus byte-for-byte copies of the existing `deploy/namecheap` operational scripts. Release directories are read-only. Activation and rollback replace only the `current` symlink; shared state is not release-owned. The filesystem fixture is not an application datastore and cannot establish database architecture.

The first executed lane starts the package web launcher on an ephemeral loopback port, calls health, readiness, release and homepage endpoints, verifies the exact runtime SHA and `no-store`, runs a one-shot worker, checks shared logs/spill, migrates an old populated database, backs up and restores a sentinel, rolls back to c953ebc, observes the rolled-back runtime SHA, reactivates the candidate and smokes it again.

The second executed lane constructs a disposable cPanel account home and drives the repository's existing `deploy.sh`, `app.js`, `healthcheck.sh`, `readycheck.sh`, `smoke-test.sh`, `restart.sh`, and `rollback.sh`. It deploys base then candidate artifacts, starts the existing Passenger entrypoint, emits a staging-only smoke receipt, serves the base SHA after rollback, and serves the candidate SHA after redeployment.

A third proof uses the same immutable Node image as the deterministic verifier. A networked fetch container receives only workspace package manifests, runs `npm ci --ignore-scripts`, and explicitly prefetches the lockfile-pinned Prisma 6.19.3 engines; it never receives the repository bundle and is removed before source execution. A separate source container runs on an internal-only Docker network with a disposable PostgreSQL/PostGIS/H3 container. It reconstructs the exact bundle, generates the real client, runs the shipped `migrate.sh` with both URL contracts and a simulation-labelled backup receipt, proves all migrations and extensions, proves URL redaction, and requires `worker.mjs` to refuse a fabricated local-file backup. All containers, the internal network, and the dependency volume are removed. Their immutable image identities, output hashes, facts, and cleanup are included in the receipt.

The retained tarball and release receipt are labelled `CPANEL_SIMULATION`. The runtime tree, proof containers, dependency volume, and only the child processes created by the runner are removed at the end.

The filesystem-control lane uses the `node:sqlite` implementation shipped with the exact Node runtime. The canonical database proof uses the lockfile-installed Prisma CLI, generated client, and disposable PostgreSQL verifier image. Neither lane installs or resolves a mutable host database package. The receipt records SHA-256 hashes for every existing Namecheap script it copied and ran.

No real cPanel account, credential, DNS record, Passenger process, public listener or production data is contacted. The package and receipt do not prove a live deployment.
