# INDEPENDENT VERIFICATION 07 — repaired merchant pilot + Context Compiler

Verifier: independent subagent, 14 named attacks, no access to my reasoning.
Targets: pilot @ `2f3d46d`, compiler @ `8ddbeeb`.
Repairs committed: `3536758`.

## What HELD (previous CRITICAL fixes are genuinely closed)

Confirmed reproducibly through the REAL paths (`--db`, `--state`), not fixtures:

- Empty / malformed evidence chains (`[]`, `[{}]`, `null`, `not json`) are refused;
  no fabricated `VALUE_PROVEN`.
- Future-dated facts → `FUTURE_DATED`, refused (exit 1).
- Undated facts → `UNDATED`, refused. Dated-but-windowless → refused.
- Stringified `valid_for_days` coerced; `'7d'`, `'Infinity'`, `'-1'`, `''` all → refused.
- Case/whitespace tampering on authority and truth-status enums held.
- Duplicate and replayed evidence deduped; foreign-merchant attribution rejected.

## What the verifier FOUND (5 defects, all repaired)

| ID | Severity | Defect | Status |
|----|----------|--------|--------|
| V2-P1 | MEDIUM (test integrity) | The ATTACK-7 ownership guard runs before evidence validation, and the P1 helper never set `merchantId` — so every P1 row was rejected as FOREIGN and the evidence validator was never reached. Proven by deleting the whole evidence-validation block and still seeing 46/46. | FIXED |
| V2-A | LOW-MED | Duplicate subject tag inflated the conflicting-claim count (2 facts → 3 claims, one listed twice). Introduced by the multi-subject `.filter` fix. | FIXED |
| V2-B | MEDIUM | `subject:Repo` vs `subject:repo ` treated as different subjects — a contradiction escaped by trivial case/whitespace variation. | FIXED |
| V2-C | MEDIUM | Contradiction summary said "prefer the stronger authority" without checking usability: a STALE `OWNER_EXPLICIT_DIRECTIVE` outranked fresh live evidence the compiler itself refuses to act on. | FIXED |
| V2-D | LOW | No ceiling on `valid_for_days`: `1e9` kept a 2,398-day-old fact CURRENT and actionable (~2.7M years of self-declared validity). | FIXED |

Two of the five were introduced BY the previous round of fixes. That is the
argument for re-verifying after every repair, not only after initial build.

## Falsification proof (each guard shown able to fail)

| Guard | Reverted → failures |
|-------|--------------------|
| Pilot evidence validation | 13 (verifier measured 0 before the fix) |
| V2-A per-fact dedupe | 2 |
| V2-B subject normalization | 4 |
| V2-C stale-authority warning | 1 |
| V2-D window ceiling | 4 |

## My own measurement errors during this cycle

- A V2-D sabotage silently no-op'd on an indentation mismatch and reported a
  false PASS. Re-run under an `assert` that the anchor matched — then 4 failures.
- My first ledger-chain recompute passed `prevHash` as a field instead of the
  second argument and ignored per-merchant chaining, producing a false
  "BROKEN at seq 0". Corrected recompute: chain intact.

Both are recorded because a verification report that hides the verifier's own
errors is worth less than one that does not.

## Database state

Logically unchanged: 5 demonstration retailers, 2 ledger rows, hash chain intact
per merchant, no test artifacts. The file hash differs from the verifier's
snapshot because SQLite rewrites page layout; content was compared logically.

The verifier flagged an apparent concurrent writer — that was my own API contract
fixture running against the same `dev.db`. Not tampering, but a real confound:
verifier runs and my own test runs must not share a database.

## Test state

- Web suite 264/264 (255 baseline + 9 new API v1 contract tests)
- Skills: demand-credits 40, signal-to-fix 42, governed-packet 26,
  merchant-pilot 46, context-compiler 54 (was 39)

## Promotion decision

Neither component is promoted on self-tests alone. Both are promoted to
`VERIFIED_BY_INDEPENDENT_ATTACK` on the basis that every confirmed finding is
repaired, each repair is falsification-proven, and each exploit is now a
permanent regression guard. Owner-only actions (real merchant outreach, payment
activation) remain blocked and unclaimed.
