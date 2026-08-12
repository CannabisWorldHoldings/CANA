# TRI-MARKET DURABLE REALITY — one store, three markets

## Architecture (inspection-driven, not assumed)
The Prisma persistence layer was READ and found already market-neutral: every
model keys by sourceKey+tenant; content-hash unique constraints give idempotent
reuse; the advisory lock is per source. **One store already existed.** What was
NOT neutral was the DC orchestrator (hardcoded ABCA contract/capture/authority,
ArcGIS-shaped capture fields). Decision (evidence-threshold law): the DC
orchestrator stays UNTOUCHED (its ArcGIS revision-bound laws are n=1 of their
class; its unchanged courts are the DC-unchanged proof). A lane-parametric
orchestrator (`acquire-market-reality.mjs`) serves the HTML lane class (VA+MD)
through the SAME acquisition state machine and the SAME store interface.
Two orchestrators over one store is the honest current state; convergence is a
future fork-threshold decision, not an aesthetic one.

## Canonical durable acquisition binding (all laws held)
marketId · sourceKey · authority (operator env grant) · source locator ·
acquiredAt · contentDigest · contractDigest · executionVersionTuple ·
repoCommit/repoTree · raw artifact (full page text stored) · receipt ·
verification: UNKNOWN (ACQUISITION ≠ VERIFICATION).

## Courted laws (5 new courts, 69/69 total green)
- REHEARSAL: VA+MD acquisitions → durable rows → claims → verification →
  market-separated VERIFIED world state, rebuilt FROM the stored raw artifact.
- IDEMPOTENCY: exact re-run ⇒ SOURCE_UNCHANGED, artifact reused (created:0),
  dedup linkage to the same immutable content; revision_bound stays false —
  a content hash is never promoted into a fake revision.
- SUPERSESSION+ISOLATION: MD layout change ⇒ new artifact; old preserved
  immutably; latest pointer moves; VA byte-identically unaffected.
- IDENTITY EVOLUTION: name-unpublished MD locations gain identity by APPENDED
  resolution rows; original evidence never rewritten.
- HOSTILE COURT: unadmitted source refused; per-market operator grants do not
  cross (MD grant cannot authorize VA); store rows digest-bound per market.
- FAILURE RECOVERY: FAILED terminal + circuit degradation, zero partial truth;
  next clean run recovers to HEALTHY.

## First live tri-market runbook (operator-only; no unauthorized writes)
Prereq: P1 cutover complete (canonical PostgreSQL, per ADR-0001 — no interim
datastore), clean HEAD at the release commit.
1. D.C. (revision-bound lane): `CANA_LIVE_ABCA_ACQUISITION grant per existing
   doctrine` → `node apps/web/scripts/acquire-live-market-reality.mjs --tenant orderweeddc.com --as-of <ISO>`
2. Virginia: `CANA_LIVE_VA_CCA_ACQUISITION=OPERATOR_APPROVED node apps/web/scripts/acquire-va-market-reality.mjs --tenant orderweeddc.com --as-of <ISO>`
3. Maryland: `CANA_LIVE_MD_MCA_ACQUISITION=OPERATOR_APPROVED node apps/web/scripts/acquire-md-market-reality.mjs --tenant orderweeddc.com --as-of <ISO>`
Each: bounded, immutable receipts, UNKNOWN until the court runs. Mid-write DB
failure ⇒ transaction rollback (Serializable), FAILED terminal appended on
retry path, circuit degrades; recovery = re-run after cause cleared (idempotent
by content). Wire VA/MD scripts to `acquireMarketReality(prismaStore, …)` at
live-run time (store interface proven identical).

## Live-readiness ladder (states not collapsed)
| Market | State |
|---|---|
| D.C. | LIVE_ACQUISITION_READY (own orchestrator+store proven in CI; production run awaits P1 cutover + grant) |
| Virginia | PERSISTENCE_READY (court-proven through durable store; live run awaits cutover + grant) |
| Maryland | PERSISTENCE_READY (same) |
None are LIVE_ACQUIRED / VERIFIED_DURABLE / PRODUCTION_PROJECTED yet — those
require the owner's P1 cutover and operator grants.

## Compiler metrics — the durable axis added
| Axis | VA | MD | Durable lane |
|---|---|---|---|
| Extraction | ~22 min | ~4 min | — |
| Court-proven VERIFIED | same-day | ~7 min | — |
| Durable persistence court | — | — | ~11 min for BOTH markets at once |
| New LOC | — | — | orchestrator 310 + lanes 120 + court test 300 |
| Market-specific LOC added | 0 | 0 | zero — lanes reuse existing contracts |
| Migrations required | 0 | 0 | 0 (existing Prisma models carry all markets) |
| Human interventions | 0 | 0 | 0 (one porter retry — tooling, not law) |
| Replay/idempotency failures | — | — | 0 |

## Claim ladder (accurate, not inflated)
PROVEN: three regulator sources on one courted reality machine; durable
persistence semantics for multi-market carried by one store (offline, fixture-
backed, reference-store court). NOT PROVEN: live persistent operation,
continuous freshness, customer value, merchant value, revenue, nationwide
generalization.
