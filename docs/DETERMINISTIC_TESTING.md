# Deterministic CANA verification

The root `./cana` command is the candidate lane’s verification surface:

```text
./cana verify focused
./cana verify full
./cana verify clean-clone
./cana verify release
./cana verify maria
./cana verify cpanel
```

The four general profiles refuse a dirty source, create a detached worktree, restore a deliberate mutation by exact blob hash, bundle the committed source, and clone it inside the reviewed Node 24.14.1 image pinned by digest. `CANA_VERIFY_IMAGE` is rejected unless it equals that immutable image. The container owns its database, build output, network namespace and server. No host port is published.

HTTP profiles rebuild Next with webpack before startup, detect the absence of a stale build, generate a runtime-only interaction secret, and require `/api/release` to state the exact expected 40-character commit with `Cache-Control: no-store`. The runner recreates the repository’s legacy absolute test paths only inside the disposable container.

The full test process loads a verification-only entropy adapter seeded by the expected commit. It preserves distinct sequential byte strings but makes repeated full-suite runs reproducible, preventing random privacy-test values from occasionally resembling phone numbers. The adapter is activated only for the disposable `node --test` process; the application server and product source continue to use the runtime's real cryptographic entropy.

Each invocation:

- has a profile-specific wall-clock limit;
- stops only the server or container it created;
- checks container and worktree removal;
- records hanging-handle and cleanup evidence;
- writes a JSON receipt under `${CANA_RECEIPT_DIR:-<system-temp>/cana-receipts}`;
- exits nonzero when the executed profile or cleanup fails.

`maria` and `cpanel` dispatch to their specialized isolated runners. Neither is silently skipped when its substrate is unavailable.

## Receipt boundary

A PASS receipt proves only its named profile at its recorded commit, tree, image digest and time. It is not a production deployment receipt and it cannot be reused after a commit changes.

The final candidate aggregator first creates a mode-0600 session file and mode-0700 sibling receipt directory. When `CANA_RECEIPT_SESSION` is set, every receipt carries the session ID, nonce hash, start time and source identity; the aggregator accepts exactly one matching receipt per required kind. This proves local session consistency and exact hashes. It is deliberately labelled externally unattested and does not claim freshness against a malicious local caller.

## Known environment boundary

The restored baseline’s Prisma 6.19.3 migration court fails on this macOS host when the SQLite file is absent, but passes unchanged in the exact Linux Node 24 substrate. The verifier therefore uses the Linux substrate; it does not weaken or edit the migration court.
