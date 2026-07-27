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

Each release contains a source archive, release identity, web launcher, worker launcher, SQLite migration, backup and restore scripts. Release directories are read-only. Activation and rollback replace only the `current` symlink; shared data is not release-owned.

The executed simulation starts the web launcher on an ephemeral loopback port, calls health, readiness, release and homepage endpoints, verifies the exact runtime SHA and `no-store`, runs a one-shot worker, checks shared logs/spill, migrates an old populated database, backs up and restores a sentinel, rolls back to c953ebc, observes the rolled-back runtime SHA, reactivates the candidate and smokes it again.

The retained tarball and release receipt are labelled `CPANEL_SIMULATION`. The runtime tree and only the child processes created by the runner are removed at the end.

Migration, queries, backup and restore use the `node:sqlite` implementation shipped with the exact Node runtime. The package does not install or resolve a mutable host `sqlite3` system package.

No real cPanel account, credential, DNS record, Passenger process, public listener or production data is contacted. The package and receipt do not prove a live deployment.
