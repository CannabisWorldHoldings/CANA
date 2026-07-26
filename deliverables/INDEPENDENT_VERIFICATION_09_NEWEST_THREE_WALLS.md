# INDEPENDENT VERIFICATION 09 — attribution, Growth OS, structured data

Verifier: independent subagent, 33 attacks, bound to pinned HEAD `0ae1030` bytes
with an isolated database. Repairs committed: `3072659`.

It confirmed the running server served HEAD bytes before trusting any HTTP
result — build ID checked against source mtimes, compiled bundles grepped for
HEAD-only strings. A green test against a stale build proves nothing.

## Result: 28 of 33 blocked, 5 confirmed

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| A6 | **HIGH — live bypass** | The endpoint baked `observedAt.toISOString()` into every evidence chain, so each request produced a different digest and the ledger's dedupe could never fire. Five identical unauthenticated POSTs → five counted actions. **A comment in that same function asserted this was impossible.** | FIXED |
| A8 | MEDIUM — honesty | The four evidence links reference the tenant, retailer, action kind and endpoint. None references a person. The chain proves a request arrived, not that a human acted. | FIXED |
| B7 | LOW — latent | `spent <= 0` is false for NaN, so a non-finite total rendered as NaN | FIXED |
| B8 | LOW — latent | `audit.score` printed verbatim: 999, −5, NaN, "high" | FIXED |
| C4 | LOW | Credential path normalized case; answer path required exact `VERIFIED`. `verified` emitted a credential but no licence answer | FIXED |

**A6 is the one that matters.** The bypass existed *because* of the comment: I had
written that the ledger's digest-dedupe made an idempotency key unnecessary, so
nobody — including me — checked whether the server was varying the digest itself.
A comment asserting a guard that does not exist is worse than no comment.

Verified live after the fix: 5 identical POSTs → **1 × 201 and 4 × 409**, down
from 5 × 201.

**A12 confirmed as by-design, and the verifier agreed the system does not
overclaim.** A hand-inserted, self-consistent ledger row IS counted. `demand-credits.mjs`
already documents exactly this: replay detects any partial tampering but cannot
detect a wholesale re-signed chain by an actor with table write access — that
requires an external anchor. What it can prove: chain consistency and that no
partial edit occurred. What it cannot: that the rows reflect reality.

## Falsifiability — every guard tested flipped

The verifier neutered each of the six Growth OS laws in isolation, asserting the
anchor matched first, with **zero no-op sabotages**: L1 evidence (1 fail), L2
dedupe (1), L3 ownership (4), L4 demonstration (5), L5 no-claim (1), L6 derived
spend (6). No guard passed silently. It found **no false-coverage defect** — the
class that appeared twice in earlier cycles is now absent.

## Concurrency handled correctly by both sides

The verifier detected my concurrent work: HEAD advanced under it and
`growth-os.mjs` changed near the end. It correctly identified the change as mine
(it contained my E2E fix and zero sabotage markers), **declined to revert it**
because doing so would reintroduce the B7/L6 bug, and re-ran every B-series test
against the pinned bytes restored from git rather than from a filesystem snapshot.
It also independently reproduced the negative-SPEND defect I had found, at module
level.

## The verifier's own errors, as it reported them

- Its first curl batch hit a sandbox loopback block and returned HTTP 000.
- It backed up `growth-os.mjs` **after** I had already modified it, so its first
  sabotage-restore used a stale snapshot. It caught this via `git status`, restored
  from `git cat-file HEAD`, and used git rather than filesystem copies thereafter.
  This is the same failure mode I hit one cycle earlier — independent confirmation
  that snapshot-based restores are the weak point, not the sabotage itself.
- It could not reproduce A9 live (SQLite WAL let its lock attempt succeed) and
  fell back to a module-level proof of the 503 path.

## Test state after repairs

- Web suite **374/374**
- Skills **258/258**, e2e compiler↔packet binding **PROVEN**
- Database pristine: 5 demonstration retailers, 2 ledger rows, zero leftover
  fixtures from either agent
