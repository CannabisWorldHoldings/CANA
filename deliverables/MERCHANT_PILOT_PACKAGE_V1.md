# FIRST AUTHORIZED MERCHANT PILOT — PACKAGE V1

**STATUS: PREPARED, NOT SENT. NOT AUTHORIZED.**

Nothing in this package may be acted on without explicit owner authorization. No
merchant has been contacted. No payment has been collected. No advertising spend
has occurred. No public claim has been made. Section 16 is the only gate that
changes that, and it is unsigned.

Every constant below was read out of the running system, not chosen for this
document. Where the system cannot yet prove something, this package says so instead
of estimating it.

---

## 1. Merchant eligibility and truth audit

A merchant is eligible only when **all** of the following are observably true. Each
is a database field an operator can check, not a judgement.

| Requirement | Field | Why |
|---|---|---|
| Not demonstration data | `Retailer.isDemonstration = false` | A demonstration record can never carry a commercial result |
| Status is verified-current | `Retailer.dataStatus = VERIFIED_CURRENT` | The resolved status, not a boolean anyone can flip |
| Actually verified | `Retailer.verifiedAt` is not null | A record nobody verified cannot be asserted |
| Inside its freshness window | `Retailer.freshnessExpiresAt > now` | Staleness is computed, never self-declared |
| Menu is not wholly demonstration | not all `MenuEntry.isDemonstration` | A demo-only menu has nothing real to hand off to |
| A safe public destination exists | `safePublicWebsiteUrl(website)` resolves | Without one, no handoff can be verified |

**Three independent demonstration signals** are checked, not one: the boolean, the
`dataStatus` string, and an all-demonstration menu. Any single one disqualifies.

Run: `node skills-src/merchant-visibility-audit.mjs --db <path>` — `--db` is
mandatory and the harness refuses to run without it.

## 2. Visibility and menu-data baseline

Captured **before** any credit is issued, so change can be attributed to work rather
than to when we started looking.

- Visibility completeness score (0–100) and the pass/warn/fail counts behind it.
- The score means: *share of observable profile, menu, provenance and answerability
  fields that are present and sourced.* **It is not a ranking, a traffic estimate,
  or a performance score.** That sentence ships with the number, every time.
- Menu totals: entries, priced, in-stock, sourced, demonstration.
- The ranked list of highest-weight fixes, each citing the exact field it came from.

Baseline is stored with its timestamp. A later report that cannot cite a baseline
must say so rather than imply improvement.

## 3. Exact sponsored-credit authorization contract

Credits are **prepaid placement credits**, not currency, not revenue, and not a
promise of outcomes.

| Term | Value | Enforced by |
|---|---|---|
| Authorization reference | required, non-blank | `issue()` refuses `AUTHORIZATION_REQUIRED` |
| Expiry | required, must be in the future | refuses `EXPIRY_REQUIRED` / `EXPIRY_IN_PAST` |
| Max single entry | 1,000,000 | `MAX_ENTRY_AMOUNT` |
| Max merchant balance | 100,000,000 | `MAX_MERCHANT_BALANCE` |
| Balance | **derived** by summing the chain | never stored, cannot drift |
| Ledger | append-only, hash-chained | `verifyChain()` detects edits, reorders, truncation |

**Pilot credits are not revenue.** Until the owner authorizes real payment
collection, any issuance carries an authorization reference containing
`NOT_A_REAL_PAYMENT`, and no figure derived from it may be reported as income.

## 4. Credit issuance and expiration rules

1. Credits are issued only against a written authorization reference naming who
   approved them.
2. Every issuance carries an expiry. Pre-expired credits are refused.
3. Expiry is recorded on the entry; expiration is a ledger event, not a silent
   sweep.
4. Refunds are capped cumulatively at the original spend and must state a reason.
5. Spending more than the balance is refused (`INSUFFICIENT_CREDITS`).
6. The chain is verified before any merchant-facing report is produced. A broken
   chain blocks the report; it does not footnote it.

## 5. Sponsored-placement disclosure rules

Placements are limited to: `FEATURED_CARD`, `NEIGHBORHOOD_BANNER`, `DEAL_SPOTLIGHT`,
`BRAND_COLLECTION`. An unknown placement is refused by name.

- Every spend **must** carry a visible `disclosureLabel`. A spend without one is
  refused — disclosure is not a setting.
- The label is shown to the consumer on the placement itself, not in a footer.
- `affectsOrganicOrder` is recorded on every entry and is **always false**.

## 6. Organic-order non-interference proof

This is a structural guarantee, not a policy.

- The ordering key is `isDemonstration asc → verifiedAt desc → freshnessExpiresAt
  desc → id asc`. **No sponsorship field appears in any ordering key.**
- The public API does not even *select* sponsorship, so it cannot reach ordering.
- `sponsorship_affects_order: false` is stated in every API response.
- The ledger refuses any spend asserting influence over ordering.
- Falsification-proven: the contract test fails if sponsorship enters ordering.

**A merchant cannot buy rank here.** They can buy a disclosed, labelled placement.

## 7. Approved attribution action types

Exactly six, enforced by enum: `PROFILE_VIEW`, `MENU_VIEW`, `DIRECTIONS_CLICK`,
`PHONE_CLICK`, `WEBSITE_CLICK`, `HANDOFF`. Anything else is refused
`UNKNOWN_ACTION`.

For this pilot, only **`HANDOFF`** is value-eligible, because it is the only action
currently carrying page-bound evidence. The others may be recorded; they may not be
billed against or reported as value.

## 8. Evidence-grade requirements per action

| Grade | What it establishes | Value-eligible |
|---|---|---|
| `REQUEST_RECEIVED` | a request arrived | **No** |
| `APPLICATION_HANDOFF_VERIFIED` | our own route ran and verified a destination | **No** |
| `PAGE_INTERACTION_VERIFIED` | the submission followed a real render of that page | Yes |
| `MERCHANT_HANDOFF_VERIFIED` | …and went to the destination that render authorised | Yes |
| `COMMERCIAL_OUTCOME_UNVERIFIED` | an interaction happened; a sale is unknown | **No** |
| `VALUE_PROVEN` | reserved — requires merchant-confirmed outcome evidence | unreachable today |

The grade is **stored on the row**, not recomputed at report time, so a later change
cannot silently re-grade history that was already reported.

**None of these prove personhood.** A scripted browser can render a page and read
its HTML. The mechanism proves a causal link from render to submission — nothing more.

## 9. Merchant-facing report schema

```
truth_label                     LIVE_RECORD | DEMONSTRATION_ONLY (with every reason cited)
visibility.score                0..100, bounded
visibility.means                the "not a ranking / not traffic" sentence
priority_actions[]              rank, weight, finding, evidence_field, observed, action
attribution.rows_seen           every attribution row considered
attribution.counted             rows that reached a value figure
attribution.rejected_foreign_merchant
attribution.rejected_unverifiable_evidence
attribution.rejected_duplicate_evidence
attribution.rejected_unproven_interaction
proof_of_value                  null, OR { attributed_actions, credits_spent,
                                cost_per_attributed_action, relationship_owner }
proof_of_value_blockers[]       why it is null, in plain language
not_claimed[]                   ranking position, traffic, impressions, popularity,
                                leads, conversion lift, revenue, return on ad spend
                                (verbatim from the code — a court test fails if the
                                document and the code ever disagree)
disclaimer                      how every figure was derived
```

The rejection counts are shown to the merchant **openly**. A merchant is entitled to
know what was not counted and why.

## 10. Withheld-value explanations

When proof of value cannot be evidenced it is reported as **WITHHELD with reasons**,
never as `0`. A zero reads as "we measured and found nothing"; withheld reads as
"this cannot be claimed", which is the truth.

Blockers currently emitted verbatim:
- `demonstration data — <every reason cited>`
- `no attributed action carries verifiable evidence`
- `no placement spend is recorded, so cost per action cannot be derived`

Priority actions are shown **even when value is withheld**. Holding a merchant's own
findings hostage to spend would be a sales tactic, not a product.

## 11. Refund, rollback and dispute handling

1. **Merchant disputes a figure** → produce the evidence rows behind it: each
   attribution's grade, evidence digest and observation time. If a row cannot be
   evidenced on re-inspection, it is removed from the figure and the report reissued.
2. **Refund** → a `REFUND` ledger entry citing the original `seq` and a reason.
   Cumulative refunds cannot exceed the original spend.
3. **Rollback** → the ledger is append-only; a correction is a new entry, never an
   edit. History is not rewritten.
4. **Chain break** → reporting halts immediately. `verifyChain()` failure is a stop
   condition, not a warning.
5. **Known limit, disclosed to the merchant:** replay detects any partial tampering, but a wholesale re-signed chain by an actor with database write access cannot be detected without an external anchor. That anchor does not exist yet.

## 12. Pilot success and failure thresholds

Set **before** the pilot runs, so the result cannot be reinterpreted afterwards.

**Success requires all of:**
- ≥ 1 attribution at `MERCHANT_HANDOFF_VERIFIED` with intact evidence.
- Every reported figure reproducible from ledger rows by an independent party.
- Chain verifies at the end.
- Zero demonstration data in any merchant-facing figure.
- Merchant confirms the priority actions were accurate and useful.

**Failure — and these are reported as failure, not reframed:**
- Any figure that cannot be reproduced from evidence.
- Any withheld figure presented as a zero, or any zero presented as a result.
- Any grade promoted without the evidence its definition requires.
- Chain verification failing at any point.

**Explicitly NOT a success criterion:** revenue, traffic, ranking, or lift. The
pilot tests whether the evidence machinery is trustworthy — not whether the product
sells.

## 13. Data retention and privacy boundaries

- **No IP address, no user agent, no fingerprinting, no durable user identifier.**
- Page identity: a truncated one-way hash of the path — which page, never which
  person.
- Destination: bound by hash inside the challenge; the full URL is verified
  server-side.
- Per-render session: random, not durable across renders, not linkable to a person.
- Challenge TTL: **15 minutes**. The challenge is never stored; only its nonce is
  retained, solely to refuse a second redemption, for the challenge lifetime.
- Attribution identity window: **5 minutes**.
- Rationale, stated to the merchant: attribution must prove an interaction followed
  a render, not who performed it. An identity we do not need is a liability we
  cannot justify to a consumer.

## 14. Operator runbook

1. Confirm eligibility (§1) on an **isolated database copy**. Never run a harness
   against the live database while a verification is in progress.
2. Capture and store the baseline (§2) with its timestamp.
3. Obtain written owner authorization (§16). **Stop here without it.**
4. Issue credits with an authorization reference. Until real payment is authorized,
   the reference must contain `NOT_A_REAL_PAYMENT`.
5. Spend on a disclosed placement with a visible label.
6. Let real consumer handoffs accumulate. Do not synthesise actions.
7. Verify the chain. A failure halts reporting.
8. Generate the report. Confirm every withheld figure states its reason.
9. Have an independent party reproduce every figure from the ledger (§15).
10. Present. Never present a figure you could not reproduce in step 9.

## 15. Independent verification checklist

The verifier must not be the implementer.

- [ ] Bind the report to commit SHA, target file hashes, schema hash and build id.
- [ ] Use an isolated disposable database; confirm the live seed is untouched at the end.
- [ ] Recompute the ledger hash chain independently.
- [ ] Recompute every evidence digest; confirm each re-hashes to its recorded value.
- [ ] Confirm no demonstration record reaches any merchant-facing figure.
- [ ] Confirm every counted action carries a value-eligible grade.
- [ ] Attempt to inflate the figure: replay, concurrency, forged and stolen challenges.
- [ ] Attempt the inverse: cause a legitimate action to be dropped.
- [ ] Neuter each guard in isolation and confirm the tests claiming to cover it flip.
- [ ] Confirm the report claims nothing in `not_claimed`.

## 16. Owner approval form — UNSIGNED

Each line is a separate authorization. Approving one does not approve another.

```
[ ] Contact this merchant                                    owner: ______  date: ______
[ ] Issue pilot credits (test, NOT_A_REAL_PAYMENT)           owner: ______  date: ______
[ ] Collect real payment                                     owner: ______  date: ______
[ ] Activate a disclosed sponsored placement                 owner: ______  date: ______
[ ] Spend real advertising money                             owner: ______  date: ______
[ ] Present the evidence report to the merchant              owner: ______  date: ______
[ ] Make any public claim about this pilot                   owner: ______  date: ______

Merchant:  ____________________   Retailer id: ____________________
Baseline captured at: ____________________
```

**No line above is signed. Nothing in this package is authorized.**

---

## Metric ladder — the distinction that must never collapse

| Metric | Established today? | Evidence required |
|---|---|---|
| Page impression | **No** — not instrumented | a render receipt |
| Interaction | **Yes** | page-bound challenge redeemed once |
| Application handoff | **Yes** | same-origin form + server-verified destination |
| Merchant handoff | **Yes** | challenge + the destination it authorised |
| Order intent | **No** | merchant-side signal we do not receive |
| Confirmed order | **No** | merchant order system integration |
| Commercial outcome | **No** | confirmed order plus value |
| Revenue | **No** | settled payment |

**A lower state is never silently promoted into a higher one.** Four of these eight
are not established, and this package says so rather than estimating them. Any
report claiming one of the four unestablished rows is, by definition, fabricated.
