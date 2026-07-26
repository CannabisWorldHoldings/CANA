# INDEPENDENT VERIFICATION 11 — is the handoff grade honest?

Verifier: independent subagent, 26 attacks, bound to HEAD `e9aeaad` with isolated
databases and dedicated server processes. Repairs committed: `4025f63`.

The central question put to it was not "does this pass" but **"is MERCHANT_HANDOFF_VERIFIED
an honest name for this evidence?"** — and it was told explicitly not to keep the
grade merely because that is what the code currently calls it.

## The verdict on the grade

**At the bound anchor: NO, it was dishonest.** The handoff minted an interaction
token and consumed it in the same server request; the client never held it. That
proves only that the server ran its own route. The verifier's harness produced
`MERCHANT_HANDOFF_VERIFIED / value_eligible: true` **with no page ever rendered**.

**At live HEAD: yes, and it proved it end to end.** I had found the same flaw
independently and shipped the page-bound challenge (`2a80d53`) while the audit was
running. The verifier re-derived the three-row story against an isolated database:

| Submission | Grade | Value-eligible |
|---|---|---|
| no challenge | `APPLICATION_HANDOFF_VERIFIED` | **false** |
| valid challenge from a real render | `MERCHANT_HANDOFF_VERIFIED` | true |
| replayed challenge | `APPLICATION_HANDOFF_VERIFIED` | **false** |

Its conclusion, which I accept as the correct scope: the grade now means *"this
submission followed a real render of this page, for this merchant and action, to the
destination that render authorised, exactly once"* — and explicitly **not**
personhood. A scripted browser that renders and submits reaches the same grade, and
the module says so.

## Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H26 | **MEDIUM-HIGH** (test-coverage) | The route wiring the challenge was tested only by source grep. Neutering the replay check, and separately self-minting the challenge, each produced **zero** test failures | FIXED |
| H22 | LOW (by design) | A ledger outage is swallowed so the consumer still gets their 303; attribution silently under-records | ACCEPTED, and now measured |
| H1 / H14 | — | Confirmed on the anchor, already superseded by the page-bound fix | CLOSED |

23 of 26 attacks blocked outright: forged Origin and Host, cross-tenant, cross-merchant,
destination substitution after render, expired and wrong-audience tokens, CSRF,
demonstration and stale merchants, 50-way concurrency, multi-process, restart.

## What closing H26 exposed

Writing the integration test the verifier asked for immediately found a **pre-existing
production defect** that a grep-only test could never see: **ten concurrent handoffs
returned ten 500s.** `recordVerifiedHandoff` writes inside a transaction and
concurrent writers lost the SQLite lock — on a route never previously exercised
concurrently.

Two real fixes followed. A bounded retry on **measured** contention codes — my first
guess of `SQLITE_BUSY`/`P2034` matched nothing; the actual codes are `P1008` and
`P2028` — and WAL journal mode. Together: 0/10 succeeding → typically 7–10/10.

The remaining limit is stated rather than asserted away: single-writer SQLite is not
the right database for this, and no retry logic makes it one. The test asserts the
**absolute** guarantee (one challenge can never fund two valued actions) plus a
realistic floor.

## The verifier's own errors, as it reported them

- Mis-attributed a file-hash drift to itself before realising HEAD had moved under it.
- Its first replay harness expected the window bucket to create a second row; tracing
  `attribute()` showed the fast path dedupes on the evidence digest alone. Right
  conclusion, incomplete reasoning until it checked.
- `node skills-src/*.mjs --selftest` only ran the first globbed file; corrected by
  iterating.
- Left one scratch file in the repo briefly, then removed it.

## Cleanliness

All ten target files byte-identical to their live-HEAD blobs. Every sabotage restored
from `git cat-file` and sha256-verified. Live database: 5/5 retailers
DEMONSTRATION_ONLY, zero attribution rows, zero leaked fixtures — its HTTP work ran
against isolated `/tmp` databases on separate ports.

## Test state after repairs

Web **489/489** · skills **258/258** · e2e binding **PROVEN**.
