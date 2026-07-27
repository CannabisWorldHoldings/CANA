# CANA technical promotion state

Updated: 2026-07-27

## Identity

- Protected branch: `recover/competitive-ui-day-night`
- Protected commit: `c953ebcd25c46ef33af0700d7913a899d839bce8`
- Protected tree: `f7c56f6dad3875ccba10dfadbd2d953baf5c1509`
- Candidate branch: `codex/cana-bottleneck-clearance`
- Candidate commit: `de4a497b6c039a5dccc9c3fb9a470dc0bf610318`
- Candidate tree: `432cf8117f24a7401b29df4c403181dae8e7ec32`
- Candidate range: 40 commits, ordered from protected base to candidate
- Integration branch: `integration/cana-technical-promotion-de4a497b`
- History-preserving merge: `d84486b32fd424d196bc8b535d13396245875042`
- Merge parents: protected `c953ebc`, candidate `de4a497b`

The exact release-candidate commit and tree are resolved from the clean branch
HEAD and written by `./cana promotion finalize` to the persistent local promotion
receipt. A tracked file cannot contain its own final commit hash without changing
that hash; the executable resolver avoids a false self-reference:

```text
git rev-parse HEAD
git rev-parse HEAD^{tree}
./cana promotion status
```

## Accepted integration

- Complete candidate history, without squashing or replaying recovery artifacts.
- MariaDB 11.4-compatible provider schema candidate and executed migration court.
- Deterministic focused, full, clean-clone, and release verification.
- Durability build, reconstruction, restore, prerequisite refusal, and remote
  proof gate.
- cPanel-like immutable release, activation, backup, restore, rollback, and
  reactivation simulation.
- Offline canonical GitHub classification, secret scan, protection policy, and
  runtime-SHA comparison.
- Site-intelligence resolver correction and fail-closed Next warning gate.
- Promotion-specific evidence-chain sizing and exact-SHA receipt normalization.

## Integration decisions and repaired defects

- The protected head had not advanced, so there was no independent semantic or
  file overlap. The merge retained the candidate tree byte-for-byte and kept both
  protected and candidate parents.
- Recovery analysis was not restarted.
- Standard verifier receipts formerly recorded container cleanup before removing
  the isolated worktree. The runner enforced worktree removal but the receipt did
  not contain that fact. Promotion writes the receipt only after removal and
  records `worktree.cleanup=true`.
- The evidence-chain byte maximum is now an executable technical decision
  artifact. No acceptance behavior in the prohibited demand-credit implementation
  changed.

## Rejected changes

- No historical archive replay.
- No provider flip in the live SQLite schema.
- No evidence-grade, merchant-value, sponsorship, ledger-authority, brand, or
  approval-policy change.
- No remote push, deployment, service provisioning, credential use, merchant
  contact, DNS change, or spending.

## Verification contract

The normalized promotion receipt refuses to pass unless one fresh,
session-bound receipt exists for every required court:

- focused, full, clean-clone, and release verification;
- MariaDB and cPanel verification;
- durability build, verify, and restore;
- offline GitHub import preparation.

It additionally requires six independent exact-SHA verifier reports for MariaDB,
the deterministic runner, durability, cPanel, release identity, and security.
The receipt binds all subreceipts, reports, tracked state files, source identity,
candidate history, prohibited paths, evidence-chain measurements, and rollback.

The exact executed results and receipt hashes are in the persistent path printed
by `./cana promotion finalize`. This document is the durable semantic state; the
machine receipt is the exact execution record.

## Locally proven guarantees

- Traceable 40-commit candidate history and immutable protected base.
- Exact clean build, Next warning refusal, stale-build detection, bounded
  execution, isolated resources, and owned-process/worktree cleanup.
- MariaDB evidence and migration behaviors enumerated in
  `docs/MARIADB_SIMULATION.md`.
- Durability bundle and binary-patch reconstruction to the exact tree, fsck,
  focused verification, restore-to-new-path, and owner-gated remote refusal.
- cPanel-like activation, health/readiness/release identity, backup, restore,
  rollback, reactivation, and cleanup.
- Offline GitHub preparation executes zero owner-gated commands.

## Hosted guarantees still unproven

- Hosted MariaDB behavior, production data migration, load, backup, and restore:
  `UNPROVEN`.
- Real cPanel filesystem, Passenger runtime, DNS, private staging, and runtime SHA:
  `UNPROVEN`.
- Canonical GitHub access, pushes, protection, checks, PR, merge, tag, or release:
  `UNPROVEN`.
- Candidate upload/download/hash readback and remote durability: `UNPROVEN`.
- Production secrets and payment, merchant, ranking, revenue, or outreach
  behavior: `UNPROVEN`.

## Rollback

`./cana promotion finalize` emits the exact newest-to-oldest revert sequence. It
reverts every post-merge promotion commit, then reverts the integration merge
with mainline parent 1:

```text
git revert --no-edit <newest-post-merge-commit>
git revert --no-edit <each-older-post-merge-commit>
git revert --no-edit -m 1 d84486b32fd424d196bc8b535d13396245875042
```

The resulting tree must equal protected tree
`f7c56f6dad3875ccba10dfadbd2d953baf5c1509`. This rollback changes only the local
integration branch; no production rollback exists because nothing was deployed.

## Owner-gated actions

The exact authorization sequence is in `OWNER_ACTION_PACKET.md`. Until an owner
performs its first action, the next technical wall is canonical GitHub access and
a private hosted staging substrate. The live provider cutover remains a separate
authorized migration commit, not an inferred business approval.
