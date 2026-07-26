# INDEPENDENT VERIFICATION 12 — the production data plane

Verifier: independent subagent, 28 attacks, bound to HEAD `f22042b` with isolated
databases and its own HEAD-built server on a separate port. Repairs: `769c31e`.

## The two boldest claims — both UPHELD

**Write-independence.** It re-derived the headline itself and pushed past it:
100 → 100×303, 200 → 200×303, **400 → 400×303, zero 5xx**. Around 1,100 handoffs
produced **exactly one** value-eligible attribution. It held a write transaction open
mid-burst and killed the server with `kill -9` mid-burst; consumers still got 303s,
the ledger stayed gapless, and no duplicate or partial rows appeared. It also proved
resolution performs no write by instrumenting every mutating operation.

**DB_CLASSIFICATION.** Attacked from both sides — too harsh, or too generous — and
found `LOCAL_TEST_DATABASE_ONLY` defensible on the evidence.

## Three defects, all repaired

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F3 | MEDIUM | `synchronous` declared `persistent: true`; it is per-connection. Being mis-declared excluded it from the reapply list, so a second pool connection would silently run FULL | FIXED + guarded |
| F2 | MEDIUM (coverage) | Dropping the read-back mismatch term from `ok` left all 500 tests green | FIXED |
| F1 | reported MEDIUM/HIGH | Removing the potency range check "left the suite green" | **Methodology trap** — guarded |
| F4 | LOW | A failed LeadEvent write still permits a value-eligible row | ACCEPTED as by-design |

### F3 is the one worth dwelling on

I wrote a module whose entire thesis is *"a configuration that only exists in an
untracked file is not configuration"* — and then asserted a persistence property
without measuring it. The verifier measured it in one command. The fix is not just
the flag: a new court sets every pragma in one process, reads each back in **another**,
and requires the declared flag to match observed reality. A wrong persistence claim
can no longer be written.

### F2 — and my own failed first attempt at the fix

My first court ran initialization inside an open transaction, expecting SQLite to
accept the pragma and ignore it. It **throws** instead, so `failures` was populated
and `ok` was false for a reason unrelated to the mismatch check. The sabotage passed.
I nearly recorded a court that could not catch what it claimed to. The corrected
version drives a pragma that genuinely succeeds and still does not read back, so only
the read-back check can catch it.

### F1 was not a defect — it was a trap that deserved a guard anyway

The verifier removed the potency range check and saw a green suite. I reproduced it
and got **two failures**. The difference is `npm run build`: Next serves compiled
bytes, so editing a route and re-running tests without rebuilding exercises the old
code. That trap would silently hide any future route regression, so rather than
noting it, there is now a test asserting the **running build** enforces the boundary —
and when it fails it says *"rebuild before trusting any result here."*

## Falsifiability

Guards whose tests flip when neutered: read-only resolution (3), five-state collapse
(1), value-eligibility (5), replay (2), G10 route governance (1), persistence claims
(1), read-back verification (1), potency range (2). The two gaps the verifier named
are now closed.

## The verifier's own errors, as it reported them

- Its first write-instrumentation used a shared counter under concurrency and
  reported "4950 writes" from a read-only path; corrected with a serial probe to `[]`.
- Its `npm run build` overwrote the running server's `.next`; benign, and disclosed.
- Two attempts to hold a write lock failed before the third worked.

## Cleanliness

All seven target files match their HEAD blobs; every sabotage restored via
`git cat-file` and sha256-verified. Live database: 5 retailers, all
DEMONSTRATION_ONLY, ledger unchanged at 2 rows, zero leaked fixtures — its
experiments ran on `/tmp` databases and a separate port.

## Test state

Web **503/503** · skills **258/258** · e2e binding **PROVEN**.
