# CANA Mission 2 contracts

Status: deterministic shadow runtime implemented; not deployed or included in the
ORDERWEEDDC production artifact.

## Authority and ownership

The Mission 1 authority chain remains binding:

`OWNER_CONSTITUTION` → `CANA_DURABLE_AUTHORITY` →
`RSI_SITEMIND_INTELLIGENCE` → replaceable execution port → bounded worker →
`ORDERWEEDDC_PRODUCT`.

Mission 2 extends the selected canonical owners without activating a second
governor, ledger, router, memory, provider, or legacy loop:

| Surface | Canonical owner | Mission 2 implementation |
|---|---|---|
| mission contract, authorization, lifecycle, evidence, promotion, rollback | `CANA_DURABLE_AUTHORITY` | `tools/mission-2/contracts.mjs`, `authorization.mjs`, `lease.mjs`, `store.mjs`, `kernel.mjs` |
| minimum context and deterministic policy | `RSI_SITEMIND_INTELLIGENCE` | `context.mjs` over the canonical `skills-src/sitemind-context-compiler.mjs` |
| execution | replaceable execution port | `mock-executor.mjs`, deterministic mock only |
| independent falsification | CANA-admitted independent verifier | `verifier.mjs`, separate identity and no mutable executor state |
| technical TruthGraph projection | `RSI_SITEMIND_INTELLIGENCE` | promotion-gated evidence node in `kernel.mjs` |
| technical Winner Memory | `RSI_SITEMIND_INTELLIGENCE` | verified technical learning with `VALUE_NOT_ESTABLISHED`; never a commercial claim |
| Knowledge-to-Mechanism Foundry | RSI beneath CANA | `foundry.mjs` |
| Intelligence OS read model | subordinate read-only adapter | `intelligence-contracts.mjs` |

Hermes remains disabled, its approved pin remains `NONE`, provider remains `NONE`,
budget remains `$0`, and external/production effects remain `NONE`.

## Canonical mission contract

`cana.mission/2.0.0` is schema-validated, canonicalized with sorted JSON object
keys, SHA-256 bound, tenant/workspace/source bound, exact-path scoped, versioned,
and replay-resistant through a stable contract hash plus monotonic event versions.
Undefined, non-finite, missing, stale, malformed, broadened, cross-tenant, or
non-canonical values fail closed.

The contract carries every required identity, source, evidence, context,
authorization, capability, provider/Hermes state, budget, timeout, expiry, success
criterion, verifier, rollback, lifecycle, checkpoint, attempt, failure, promotion,
and next-action field named by the Mission 2 authorization.

## Lifecycle and durability

The append-only SHA-256 event chain and atomic current-state projection implement:

`SIGNAL_OBSERVED` → `CONTEXT_COMPILED` → `MISSION_SEALED` →
`CANA_AUTHORIZED` → `EXECUTOR_DISPATCHED` → `ACTION_EXECUTED` →
`EVIDENCE_CAPTURED` → `INDEPENDENTLY_VERIFIED` → `PROMOTED` or
`REJECTED` → `TRUTHGRAPH_UPDATED` → `WINNER_MEMORY_UPDATED` →
`ROLLED_BACK` when requested.

Each event binds the prior hash, global sequence, monotonic mission version,
tenant, workspace, actor, timestamp, lifecycle state, and payload. A keyed
HMAC-SHA-256 head anchor binds the durable event count and tail hash. Its private
32-byte key is created exclusively with mode `0600` beside, rather than inside,
the mutable store root; existing durable state cannot start without that key.
Reconstruction repairs only the two valid crash windows in which the event log is
ahead of the head or projection; it rejects mutation, coordinated store-root tail
deletion, reordering, stale versions, tenant/workspace drift, and history
divergence. Content-addressed evidence is written exclusively and verified on
every read. Store roots, event files, head files, projections, evidence
directories, evidence objects, and the external key reject symlink redirection
and opened-file replacement. A structured append lock identifies its owning
process, recovers only a proven dead-owner lock, and rejects a live or replaced
lock. The projection remains a cache; the event chain, keyed head, and external
key are the reconstructable authority.

The head anchor is a local durable-store integrity boundary, not protection
against an administrator or same-account attacker who can modify both the store
and its external key. Mission 2 grants no production authority and stores no
credential in source or generated evidence.

The Autonomy Kernel provides bounded queue eligibility, canonical hash-bound worker
leases, heartbeats, lease expiry, checkpoints, process-restart restoration,
stale-worker rejection, bounded retry/backoff enforcement, dead-letter state,
blocker history, pause, cancellation, reachable owner-decision state, and
capability quarantine. A paused mission cannot dispatch before authorization, and
it never retries forever.

## Context and authorization

The Context Compiler adapter accepts only current, verified, deduplicated evidence
bound to the exact tenant, workspace, repository commit/tree, and permitted files.
It refuses whole-repository context, unrelated files, stale or forged evidence,
cross-tenant evidence, duplicates, and contradictory canonical inputs. A frozen
clock makes identical input produce identical canonical bytes and packet hash.

The CANA authorization evaluator independently recomputes the mission and context
hashes and requires:

- provider `NONE`;
- Hermes `DISABLED`;
- approved Hermes pin `NONE`;
- external effects `NONE`;
- production access `NONE`;
- budget and spend exactly `$0`;
- an unexpired mission;
- exact capabilities and files;
- independent executor/verifier identities;
- an exact-byte rollback contract.

Authorization, lease, execution, verifier, TruthGraph, Winner Memory, and rollback
receipts use exact schemas and canonical hashes. They are deliberately
serialization-safe: independent processes revalidate exact schemas, hashes,
mission/source identity, expiry, executor/verifier separation, and causal receipt
bindings instead of relying on JavaScript object identity. Dispatch additionally
loads and revalidates the exact content-addressed authorization receipt referenced
by the durable `CANA_AUTHORIZED` event. Receipt mutation, a lifecycle-shaped
authorization without durable evidence, stale leases, forged execution or
verifier receipts, and forged rollback receipts are denied before execution,
promotion, memory, or rollback.

## Replaceable execution and verification

The deterministic mock adapter runs only in an isolated, clean Git worktree. It
verifies the exact source commit/tree, rejects symlinks and path escape, opens the
same validated target with no-follow semantics, checks the before hash, applies one
exact deterministic replacement, and proves the final Git diff contains one
authorized file. It performs no model call, network service, credential access,
deployment, production mutation, spend, or external effect.

The verifier receives immutable receipts and independently re-reads the sandbox. It
recomputes Git HEAD and tree, the exact changed-file set, source bytes, deterministic
operation, authorization, lease, execution hash, scope, before/after hashes and
byte lengths, success, rollback reconstructability, provider, budget, and
external-effect claims. It proves its own inspection left the implementation
unchanged. It can return `APPROVE`, `REJECT`, `INCONCLUSIVE`, or `BLOCKED`; only
CANA converts an admitted exact `APPROVE` receipt into promotion.

## Knowledge Foundry and Intelligence OS

The Foundry implements versioned records for Source Record, Insight Capsule,
Duplicate Relationship, Contradiction Record, Research Gap, Mechanism Candidate,
Codex Handoff Packet, Implementation Result, Mechanism State Transition, and Owner
Decision Request. Records carry stable IDs, source hashes, provenance,
tenant/workspace identity, packet hashes, truth classification, duplicate identity,
and contradiction preservation. Raw transcript hot-memory insertion and unsupported
`VALUE_PROVEN` claims are denied.

The Intelligence OS contracts expose read-only canonical identity, protected base,
health, mission list/details, lifecycle events, authorization/execution/evidence,
verification, promotion/rejection, rollback, TruthGraph/Winner Memory, queue,
leases, heartbeats, capability state, provider/Hermes state, owner decisions, and
blockers. Every fixture response is labeled
`MISSION_2_SHADOW_DATA_NOT_LIVE_PRODUCTION`.

## Executable evidence

- `evidence/LEGITIMATE_MINIMUM_ALIVE_LOOP_RECEIPT.json`
- `evidence/INVALID_MISSION_RECEIPTS.json`
- `evidence/TRANSCRIPT_SHADOW_MECHANISM_RECEIPT.json`
- `evidence/INTELLIGENCE_OS_READ_CONTRACT_RECEIPT.json`
- `evidence/ADVERSARIAL_REPORT.json`
- `evidence/EVIDENCE_MANIFEST.json`

`tools/mission-2/run-fixtures.mjs` deterministically reproduces these artifacts.
