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

## Transfer Test #1 — telemetry receipt v0

| Metric | Value |
|---|---|
| Slice 1 started | 2026-08-12T12:08Z |
| Slice 1 tests green | 2026-08-12T12:30Z (16/16) |
| Time to extracted entity coverage | ~22 min (28/28 entities: 23 dispensaries + 5 processors) |
| Reused capability | evidence doctrine, court/fixture pattern, statement→claim shape, admitted-source law, watch-trigger model (definitions) |
| VA-specific new code | 2 lib modules, 2 test files, 2 fixtures (~600 LOC incl. tests) |
| Not yet measured | time-to-verified coverage (slice 2), indexation (slice 3), first merchant |

D.C. baseline for comparison: reconstruct from PR #29/#35/#37 evidence ledgers.
Update this table in each subsequent slice — the learning curve IS the product.
