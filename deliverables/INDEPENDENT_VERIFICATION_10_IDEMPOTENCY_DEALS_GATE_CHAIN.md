# INDEPENDENT VERIFICATION 10 — idempotency, deals, release gate, recovery chain

Verifier: independent subagent, 27 attacks, bound to pinned HEAD `f69544b` blobs
with isolated databases. Repairs committed: `6b3c35a`.

## Result: 25 blocked, 2 confirmed, 0 live bypasses

It independently re-derived the headline concurrency claim rather than taking it on
trust — 50, 100 and 200 simultaneous requests each produced **exactly one committed
row**, zero throws, chain valid — and then proved the constraint is load-bearing by
**dropping the unique index** and watching the race return.

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| III1 | **HIGH** (test-coverage) | G10's walker matched only `route.ts`; Next permits `tsx`, `ts`, `jsx`, `js`, so three of four valid Route Handler extensions escaped the gate | FIXED |
| I7 | MEDIUM (latent) | SQLite unique indexes ignore NULLs, so two `eventIdentity=NULL` attribution rows both insert and dedupe silently fails | FIXED |

### III1 — a gate narrower than the framework it governs

I measured rather than assumed: in this app a `route.js` and a `route.tsx` both 404
today, so it was **never a live leak**. But G10's entire stated purpose is that a new
route cannot escape it, and it would stop governing the moment someone added a
handler in a permitted extension.

Proven both ways with a `route.js` present: the hardened walker names it and fails;
the **old walker reports zero failures**. Five extensions (js/jsx/tsx/mjs/cjs) are now
caught and named.

### I7 — a guarantee with a single point of discipline

Not reachable via HTTP: `eventIdentityOf()` always returns a 64-hex digest, verified
again here against hostile inputs including null and empty merchant ids. But the
whole guarantee then rested on one call site staying correct forever. `append()` now
fails closed on any ATTRIBUTION lacking a well-formed identity.

## Recorded, not "fixed" — because the verifier is right and it isn't a defect

**I3 / I4.** The 5-minute identity window means a patient attacker could sustain
~288 counted requests per day per action kind, and two genuinely distinct consumers
acting in one window collapse to a single row. Both follow from binding no consumer
identity. The verifier noted that commit `84470ee` addresses precisely this by
grading such rows `REQUEST_RECEIVED` — carrying **no merchant value at all**. The
window governs REPLAY, not personhood, and the receipt now says so explicitly.

**A12-equivalent.** A hand-inserted, self-consistent ledger row is still counted.
The verifier confirmed the code does not overclaim: replay detects any partial
tampering but cannot detect a wholesale re-signed chain by an actor with table write
access, which `demand-credits.mjs` already documents as needing an external anchor.

## Recovery chain independently walked

The verifier followed the documented restore order using the Drive read-backs and
reached `d4587a4` with tree `1daba531…` and 0 fsck errors. Applying the artifacts
**out of order** produced `Repository lacks these prerequisite commits` with HEAD
unmoved — the failure is loud, not a plausible wrong tree.

## Concurrency between two agents, handled correctly on both sides

HEAD advanced twice under the verifier while it worked. It re-bound to
`git cat-file blob` for both the pinned and current revisions, confirmed my diff was
purely additive to the identity/append/constraint path, validated its ledger attacks
against **both**, and never reverted my work.

## Its own errors, as reported

- Initially trusted a pre-existing build as HEAD, then discovered the repo had moved;
  corrected by re-binding to git blobs.
- Its first `/tmp` database copy predated my schema push and threw `P2022`; refreshed
  from the live schema.
- One early collision reading misattributed a pre-existing duplicate row; re-run in
  isolation, which cleanly proved the `k1`/`e1` domain separation is unforgeable.

## Test state after repairs

Web **418/418** · skills **258/258** · e2e binding **PROVEN** · database: 5
demonstration retailers, 2 ledger rows, **zero NULL-identity attribution rows**.
