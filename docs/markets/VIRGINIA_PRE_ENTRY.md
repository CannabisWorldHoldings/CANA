# OPERATION VIRGINIA PRE-ENTRY — Transfer Test #1

**Status:** SLICE 1 (this PR) — market registry, CCA registry parsers, court fixtures, watcher targets.
**Doctrine:** everything here is EXTRACTION and DATA-WITH-CITATIONS. Nothing in this slice
promotes claims to verified world state; nothing facilitates any transaction; the medical
directory content scope is strictly the informational presence permitted by 3VAC10-40-180.

## Why Virginia, why now (evidence, 2026-08-12)

- Adult-use framework enacted via HB 30 budget (2026-06-29). License applications open
  **2027-02-01**; initial licenses **2027-05-01**; earliest retail **2027-07-01**
  (cca.virginia.gov/retailmarijuanamarket).
- **Delivery Operator** is a dedicated third-party license class (VA Code § 4.1-805) —
  the only true third-party delivery class in the DMV region. Radius rules pending rulemaking.
- **No locality opt-out** (§ 4.1-629/630) — every Virginia locality is addressable.
- Medical market operational today: 5 HSA processors, 23 dispensaries, public CCA registries.
- Adult-use NOIRA expected fall 2026 — the rulemaking watch target in this PR is the
  public-comment tripwire.

## What this slice contains

| Path | Purpose |
|---|---|
| `apps/web/src/lib/markets/va/va-market-registry.mjs` | US-VA market descriptor as cited data: countdown, license classes, locality powers, admitted sources, watch targets, explicit UNKNOWNs |
| `apps/web/src/lib/markets/va/va-cca-registry-parser.mjs` | Dependency-free extraction of CCA dispensary blocks and processor accordion → extracted statements with provenance |
| `apps/web/tests/va-market-registry.test.mjs` | Countdown/citation/frozen-data laws |
| `apps/web/tests/va-cca-registry-parser.test.mjs` | Fixture courts: 23/23 dispensaries, 5/5 HSA processors, pinned counts (loud-change law), reject inspectability |
| `apps/web/tests/fixtures/va-cca/*.html` | Trimmed court fixtures with full-page sha256 provenance headers |

Extraction results at capture (2026-08-12): **23 dispensaries** (Beyond Hello ×6,
RISE ×6, Cannabist ×2, gLeaf ×3, Zen Leaf ×6), **5 processors** (HSA1 AYR-conditional,
HSA2 Jushi, HSA3 GTI, HSA4 AYR, HSA5 Verano) — matching CCA's published registry exactly.

## SLICE 2 — reality-lane wiring (next, requires local repo)

Wire the VA source adapter into the existing acquisition machinery as a sibling of the
D.C. ABCA path — reuse, do not fork:

1. Register `VA_MARKET.admittedSources` in the admitted source registry
   (see `src/lib/reality/source-portfolio-router.mjs` and the admitted-registry law
   from Phase B Slice 2).
2. Acquisition via `src/lib/reality/live-reality-acquisition.mjs` bounded-authority path
   (same laws: exact acquisition-tree provenance, content/acquisition identity separation).
3. Extracted statements from these parsers → claims via `market-claim-adapter.mjs`,
   default UNKNOWN, promoted only through `market-claim-court.mjs`.
4. Entity resolution through `src/lib/reality/entity-resolution.mjs`
   (CANA_LOCATION_ID canonical; CCA identifiers as provider aliases).
5. Continuation triggers from `VA_MARKET.watchTargets` (CONDITION_WATCH, OBSERVE_ONLY,
   bounded recurrence) — the NOIRA tripwire is priority one.

## SLICE 3 — surfaces (owner hostname decision required)

Countdown hub + VA medical directory via tenant routing (`tenant-rewrite.mjs`, after
PR #40 lands). **Do not serve VA content on orderweeddc.com** — hostname decision is the
owner's (see Dominance Addendum §5, domain architecture).

## SLICE 2 (this branch) — claims, delivery model, watch evidence

| Path | Purpose |
|---|---|
| `apps/web/src/lib/markets/va/va-claims.mjs` | Extracted statements → market claims (UNKNOWN default, decision-ineligible); VA identity v1 (name+address; license = explicit UNKNOWN — CCA pages publish no license numbers); first-class delivery model with UNKNOWN_DELIVERY_ELIGIBILITY |
| `apps/web/src/lib/markets/va/va-watch-evidence.mjs` | OBSERVE_ONLY watch evidence: EVENT→SOURCE→HASH→CHANGE→IMPACT→DEADLINE→ACTION→AUTHORITY, hash-chained + tamper-evident, deadlines only as cited countdown facts |
| `apps/web/tests/va-claims.test.mjs`, `va-watch-evidence.test.mjs` | Courts: UNKNOWN-default law, identity stability, delivery honesty law (no evidence → UNKNOWN, verified geometry only → ELIGIBLE/NOT_ELIGIBLE, never proximity), chain linkage/tamper/time laws |

**Durability lane ownership:** the eleven exact Virginia paths were admitted to
`owned_create_paths` (no wildcards) with the scope digest updated in
`tools/durability/cli.mjs` — the same narrow pattern PR #40 used. No court was
weakened; the digest law verified locally before push.

## Transfer Test #1 — telemetry receipt v1 (hardened)

**TIME TO EXTRACTED COVERAGE ≠ TIME TO VERIFIED WORLD STATE.** They are different
metrics and only the first is achieved.

| Metric | Value |
|---|---|
| Time to extracted entity coverage | ~22 min (28/28: 23 dispensaries + 5 processors) — ACHIEVED 2026-08-12 |
| Time to verified world state | NOT ACHIEVED — requires acquisition run + verification court + entity resolution against the live lane (slice 2b) |
| NEW code (VA-specific) | 4 lib modules + 4 test files + 2 fixtures + this doc (~1,300 LOC incl. tests) |
| REUSED untouched | evidence doctrine, court/fixture pattern, canonical-JSON digest discipline, hash-chain receipt pattern (continuation kernel lineage), admitted-source + watch-target models, durability ownership mechanism |
| FORKED (duplicated instead of generalized) | claim formation (va-claims.mjs) — deliberate, see below |
| FAILED TO GENERALIZE (findings) | (1) `market-claim-adapter.mjs` validates lineage against the hardcoded ABCA live contract — it would reject VA claims today; (2) `live-abca-adapter.mjs` is ArcGIS/DNS-pin specific — VA's source is HTML pages needing its own bounded fetch contract; (3) `entity-resolution.mjs` is DC-license-format specific (`/^[A-Z]{4}-\d{6}$/`) — VA identity needed a new normalization version |
| MARKET CONTRACT CANDIDATES | source contract (id+digest+boundedness) as a parameter instead of a hardcoded import; identity normalization as a versioned per-market strategy; claim lineage validation keyed by market contract registry |
| New failure modes discovered | CCA processor accordion publishes no street addresses → identity law correctly refuses to fabricate processor claims (0 claims formed — honest) |
| Architectural changes required in core | none yet — slice 2 stayed in the VA namespace; core generalization is a separate courted lane |

## SLICE 2b (next) — live-lane wiring (core-lane ownership required)

1. Generalize `market-claim-adapter.mjs` lineage validation from the hardcoded ABCA
   contract to a market-contract registry (core file — separate courted change).
2. `live-va-cca-adapter.mjs`: bounded HTML acquisition with the same authority laws
   (fixed origin, pinned lookup, byte/time bounds, acquisition state machine).
3. Register `VA_CCA_SOURCE` in `reality-compiler.mjs` + append the frozen entry to
   `LIVE_SOURCE_REGISTRY` in `source-portfolio-router.mjs` (distinct independence group).
4. Verification court run → first VERIFIED VA world state → telemetry row filled.

