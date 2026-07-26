# Durability delta 11 — `0808871..a0b3071`

## STATUS: BUILT AND LOCALLY VERIFIED. **NOT YET DURABLE.**

Stated plainly because the standing rule is that a delta is not durable until
read-back verification passes against the remote copy. The Drive integration is
returning transport errors on every call right now, so gates 1–2 (remote byte size,
remote SHA-256) cannot be executed. Until they are, this artifact is a **local
backup**, not durability. Calling it durable would be exactly the kind of unverified
claim this chain exists to prevent.

| Field | Value |
|---|---|
| Range | `0808871..a0b3071` (14 commits) |
| Bundle | `CANA-delta-0808871-to-a0b3071.bundle` |
| Size | 131,679 bytes |
| SHA-256 | `4aa078ebe5dca6b7c19fe1781917504330b4a0629bfedbcce7205013e60495b4` |
| Prerequisite | `0808871` — the tenth artifact, already durable |
| Local copy | `/agent/workspace/durability/` (persists across sessions) |

## What IS proven, locally and independently

| Gate | Check | Result |
|---|---|---|
| 3 | Clone reset to `0808871`, fetched from the bundle alone | HEAD `a0b3071` **SHA MATCHES** |
| 4 | Tree diff against the authoritative tree | **0 differing files** |
| 5 | Prisma client regenerated from the RECONSTRUCTED schema | OK |
| 6 | Tests run **from the reconstruction**, not from my tree | **66/66** |

Gate 6 is the one that matters: evidence-spill, migration-court, release-identity and
release-sha all pass from a tree rebuilt out of the bundle. The migration lane's court
ran against its own reconstructed schema. That is working software, not matching
bytes.

`git bundle verify` was used only to read the prerequisite, never as the integrity
gate — it needs an enclosing repository and reports false failures outside one.

## Contents

Three lane merges (product `54317ea`, cpanel `9c65c7a`, migration `b0db9fd`), the F1
evidence repair, verification 13, and two checkpoints.

## Outstanding

Re-run gates 1–2 against Drive when the integration recovers. Until then the eleventh
delta is backed up but **not durable**, and the durable frontier remains `0808871`.
