# Minimum Alive Loop Specification

Status: `IMPLEMENTED_LOCAL_BRANCH` (2026-08-17, branch agent/orderweeddc-sovereign-one-shot-vnext)

Implementation: `tools/alive-loop/adapter.mjs` (one thin composition adapter, per the
Mission 2 boundary below) + `tools/alive-loop/run-cycle.mjs` (bounded live runner).
All fourteen required executable courts pass as tests in
`tools/alive-loop/alive-loop.test.mjs` (15/15 with the acceptance test). Three live
cycles (static-court, pure-suites, public-copy) completed all ten states at a pinned
tree with zero ungranted effects, deterministic resume, and hash-chained receipts.
OS seams (`runtime/mission.py` lease, `runtime/evidence.py` envelope) are re-implemented
minimally with `[OS-CONTRACT]` provenance markers — the OS repository is not present in
the build environment and no unallowlisted symbol was copied. Hosted inclusion,
secrets, providers, backup/restore, and owner approval remain unproven and gated.

Purpose: give Mission 2 an exact, bounded implementation path without creating a new
governor, ledger, router, or loop engine.

## Goal

Prove one deterministic, restart-safe, locally bounded cycle:

`authorized mission` → `compiled context` → `candidate fix` → `governed packet` →
`mock or no-provider execution` → `receipt` → `measured outcome gate`.

The first implementation must produce a proposal or read-only local change fixture.
It must not deploy, contact a provider, spend money, or produce a real business claim.

## Selected existing seams

| Step | Selected source | Purpose |
|---|---|---|
| Mission grant | canonical CANA authority contract | Defines objective, target, capabilities, limits, and evidence requirements |
| Lease/idempotency storage | exact allowlisted symbols from `ORDERWEEDDCRSI@125c81b…/runtime/mission.py` | One active lease; retry without duplicate effect |
| Context compile | `skills-src/sitemind-context-compiler.mjs` | Deterministic normalized context and digest |
| Signal-to-Fix | `skills-src/cana-signal-to-fix.mjs` | Candidate and ChangeEvent boundary |
| Packet seal | `skills-src/hermes-governed-packet.mjs` | Bind context, grant, target, pin, and evidence expectations |
| Receipt mechanics | exact allowlisted symbols from OS `runtime/rsi.py` and `runtime/evidence.py` | Append-only, hash-bound local evidence |
| Provider route | exact allowlisted validation/mock symbols from OS `runtime/model_router.py` | Explicit `none` or `mock` only in the first court |
| Execution | bounded local fixture; Hermes remains optional and disabled until approved | Demonstrate the contract without inventing approval |
| Winner gate | `cana-signal-to-fix.mjs::toWinnerMemory` | Reject unmeasured or non-improving outcomes |
| Durable lesson adapter | selected OS lesson-store seam | Persist only after the canonical gate admits it |

TruthGraph is `MISSING` and is explicitly not required for this loop. Mission 2 must
not invent it or hide its absence.

The import boundary is the SHA/tree-bound symbol table in
`INTELLIGENCE_OS_RECOVERY_STATUS.md`. A module name is not permission to copy a
module. Any symbol not allowlisted is forbidden until a new reviewed disposition.

## Input contract

A cycle starts only with a CANA grant containing:

- `mission_id`, monotonic `mission_version`, `issued_at`, `expires_at`
- exact CANA and ORDERWEEDDC commit/tree
- target and allowlisted paths
- objective and predeclared metric
- maximum attempts, runtime, bytes, and cost (`0` for the first court)
- capability allowlist
- evidence requirements
- policy/schema versions
- provider route `none` or `mock`
- optional Hermes candidate SHA and tree, marked evaluation-only
- deterministic idempotency key derived from the stable grant fields

Any absent, expired, inconsistent, or unknown field fails closed.

## State machine

1. `GRANTED`: CANA records the immutable grant.
2. `LEASED`: the OS adapter atomically acquires one lease for the idempotency key.
3. `COMPILED`: Context Compiler emits canonical bytes and digest.
4. `PROPOSED`: Signal-to-Fix emits a candidate and ChangeEvent.
5. `SEALED`: governed packet binds all prior digests, capability subset, route, and
   optional executor identity.
6. `EXECUTED_LOCAL`: the bounded fixture or approved executor returns output and
   observed side-effect count.
7. `RECEIPTED`: the OS adapter appends evidence bound to packet and output digests.
8. `MEASURED`: ORDERWEEDDC observation is recorded with its source and window, or
   explicitly `UNKNOWN`.
9. `ADMITTED` or `REJECTED`: the canonical Winner Memory gate decides eligibility.
10. `CLOSED`: CANA records final state and releases the lease.

Transitions are append-only. Restart resumes by idempotency key from the last valid
receipt. A retry may recompute deterministic bytes but cannot append a second logical
effect.

## Failure behavior

- Pin/tree mismatch, missing approval, or stale overlay pin: deny before execution.
- Lost/expired lease: stop; a new worker may resume only after the store resolves the
  lease under the same idempotency key.
- Digest mismatch or altered receipt: quarantine the cycle and preserve both bytes.
- Missing capability, unallowlisted path, nonzero spend, or external-effect request:
  deny and emit a refusal receipt.
- Provider unavailable: remain `BLOCKED`; do not silently switch providers.
- Crash after local execution but before receipt: reconcile the idempotency key and
  recorded side-effect count before retry.
- Unknown or non-improving outcome: close without Winner Memory admission.
- Contradictory evidence: block admission and preserve the contradiction.

## Mission 2 implementation boundary

Mission 2 may add one thin composition adapter inside canonical CANA and selectively
port the named OS seams with provenance comments and exact tests. It may not import
the whole OS, legacy loop, governor, PR #1 runtime, or Hermes repository; add a
second state store/router/ledger; enable a provider; or change business semantics.

## Required executable courts

1. Exact-source and exact-tree refusal.
2. Deterministic compile: identical input produces identical bytes/digest.
3. Grant tampering and capability escalation denial.
4. Target/path escape denial.
5. Provider `none`/`mock` only; cost and external-effect count stay zero.
6. Duplicate claim and concurrent lease contention produce one logical execution.
7. Crash at every state boundary and deterministic resume.
8. Receipt mutation, deletion, reordering, and replay detection.
9. Hermes disabled path works; unapproved Hermes candidate is refused.
10. Worker return cannot mutate policy, route, grant, or evidence meaning.
11. Unknown and simulated outcomes cannot enter Winner Memory.
12. Synthetic deterministic improving and non-improving fixture outcomes take
    opposite gate paths while both remain non-business evidence.
13. Artifact-inclusion test proves the runtime absent until an intentional builder
    change is separately authorized.
14. Rollback removes the composition adapter and preserves historical receipts.

## Acceptance result

The loop is “alive” only when one isolated cycle completes all states with
deterministic bytes, zero ungranted effects, restart recovery, and a reproducible
receipt. It is not “live” or production-approved until hosted inclusion, secrets,
provider, backup/restore, and owner approval are proven separately.
