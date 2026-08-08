# SiteMind-governed dynamic creative foundation

Status: local owner-review foundation. No merge, publication, deployment, provider spend, advertiser charge, or campaign spend is authorized.

## Architecture and authority

```text
CANA authority
  -> existing SiteMind evidence intake and context compiler
      -> existing SiteMind Context Compiler packet
          -> existing Hermes governed packet (GENERATE_CREATIVE_DRAFT only)
              -> canonical ad-creative provider registry and router
                  -> canonical ad-creative pipeline
                      -> visual verification court and bounded regeneration
                          -> OWNER_REVIEW_REQUIRED
                              -> no activation in this branch

Existing sponsorship truth + dynamic entitlement policy
  -> fail-closed placement eligibility
      -> deterministic approved ORDERWEEDDC house fallback

ORDERWEEDDC first-party events
  -> performance evidence interfaces
      -> future SiteMind learning after truthful attribution
```

No new brain, governor, TruthGraph, memory store, mission state, publisher, payment authority, or scheduler was added. SiteMind compiles context and preserves review evidence. Hermes admits one repository-fixed, synthetic, deterministic, zero-spend Level 1 draft authorization; the generic public grant constructor cannot mint creative authority. Image providers implement one replaceable contract. CANA remains the only authority boundary.

## Reused components

- `apps/web/src/lib/sitemind.mjs`: existing SiteMind boundary, extended with competitor evidence and campaign-context adapters.
- `skills-src/sitemind-context-compiler.mjs`: canonical evidence labeling and context seal, called by SiteMind.
- `skills-src/hermes-governed-packet.mjs`: canonical context-plus-authority packet, extended only with `GENERATE_CREATIVE_DRAFT`.
- `packages/ad-creative/src/pipeline.mjs`: existing analyze, brief, generate, inspect, verify pipeline.
- `packages/ad-creative/src/provider-contract.mjs`: existing provider contract, extended with registry and routing metadata.
- `apps/web/src/lib/sponsorship-entitlement.mjs`: existing paid-placement truth boundary remains unchanged.
- `apps/web/src/app/[domain]/page.tsx`: actual canonical homepage; the review placement is an environment, host, and query-gated addition.

## Data model and interfaces

| Schema or interface | Purpose | Authority |
|---|---|---|
| `cana.sitemind-creative-competitor-evidence/1.0.0` | Scheduled-watch or deep-crawl event with before/after content and screenshot hashes, explicit confidence, diffs, source, rights, uncertainty, deduplication key, and mechanism-only routing | Reference only |
| `cana.creative-evidence-import-manifest/1.0.0` | Offline admission gate rejecting traversal, non-canonical paths, duplicates, symlinks, hardlinks, AppleDouble, `__MACOSX`, and oversized files | No instruction or execution authority |
| `cana.owner-creative-preference/1.0.0` | Exact PR21 rejection, eight stable reason tags, preference pair, and no-merge/no-publication decision | Owner decision evidence |
| `cana.sitemind-creative-context/1.0.0` | Advertiser, entitlement, rights-cleared assets, objective, offer, audience, placement, brand rules, owner memory, first-party outcomes, competitor evidence, constraints, budgets, and prohibited elements | Context only |
| `cana.image-provider-routing/1.0.0` | Quality, cost, latency, policy eligibility, and historical-performance routing receipt | Selects but does not call or spend |
| `cana.fixed-offline-creative-authorization/1.0.0` | Exact-digest synthetic-advertiser, deterministic-provider, Level 1, zero-production and zero-spend fixture scope | Cannot be widened or minted through the generic grant API |
| `cana.deterministic-image-generation/1.0.0` | Prompt hash, provider, model, seed, configuration, source asset hashes, result hash, zero-call and zero-cost receipt | Fixture generation only |
| `cana.creative-sponsorship-entitlement/1.0.0` | Placement, share ceiling, targeting, refresh, active variants, reporting, and experimentation limits | Cannot change verification, licensing, availability, source confidence, or organic order |
| `cana.visual-verification-court/1.0.0` | Required visual, truth, policy, rights, owner-taste, coherence, performance, and landing-page judges | Cannot publish |
| `cana.creative-performance-event/1.0.0` | First-party impressions, qualified clicks, saves, searches, downstream actions, inquiries, directly attributed conversions, owner decisions, complaints, policy failures, and regressions | Learning evidence only |
| `cana.dynamic-creative-learning-receipt/1.0.0` | Evidence, attempted mechanisms, owner decision, experiment status, causal confidence, memory applied, next mutation, and unresolved questions | Stops before new authority |

The review JSON files are retained evidence, not a parallel database. Production persistence must be connected to the existing SiteMind durability path in a later owner-authorized integration.

## Provider registry

`createProviderRegistry()` accepts only implementations created by the existing `createProvider()` contract. `routeImageProvider()` filters on capabilities, maximum cost, maximum latency, and policy eligibility, then scores quality, cost, latency, and historical performance. Those values are routing estimates, never execution or billing proof. The registry itself declares `NONE_REGISTRY_ONLY` execution authority.

The controlled slice registers only `deterministic-svg-fixture` / `orderweeddc-vector-fixture-v1`. A private module identity prevents a caller from impersonating that offline provider with self-declared metadata. Output hashes, generation and analysis receipts, cost, and network facts are recomputed from the returned bytes after every invocation. The interface can admit future providers without making a vendor part of CANA, SiteMind, memory, verification, spending, or publication authority.

## Sponsorship entitlements

| Tier | Placements | Impression-share ceiling | Refresh | Active variants | Reporting | Experiments |
|---|---:|---:|---:|---:|---|---:|
| `HOUSE` | Homepage billboard | 100% deterministic fallback inventory | 720h | 2 | First-party aggregate | 0 |
| `NEIGHBORHOOD` | Homepage billboard, neighborhood feature | 20% | 168h | 3 | Campaign and placement | 1 |
| `DISTRICT` | Homepage billboard, neighborhood feature, deal spotlight | 35% | 96h | 5 | Campaign, placement, audience | 2 |

Sponsorship, verification, licensing, availability, source confidence, and organic ordering remain independent. Every paid placement must carry a visible disclosure.

## Campaign state machine

```text
DRAFT -> GENERATED
GENERATED -> VISUAL_REVIEW_FAILED | POLICY_REVIEW_FAILED | OWNER_REVIEW_REQUIRED | REJECTED
VISUAL_REVIEW_FAILED | POLICY_REVIEW_FAILED -> GENERATED | REJECTED | ARCHIVED
OWNER_REVIEW_REQUIRED -> APPROVED | REJECTED | ARCHIVED
APPROVED -> SCHEDULED | REJECTED | ARCHIVED
SCHEDULED -> ACTIVE | PAUSED | EXPIRED | REJECTED
ACTIVE -> PAUSED | EXPIRED | REJECTED
PAUSED -> ACTIVE | EXPIRED | REJECTED | ARCHIVED
EXPIRED | REJECTED -> ARCHIVED
```

The current Level 0/1 foundation refuses every `ACTIVE` transition, including a caller that supplies strings claiming every gate passed. A later integration must connect a canonical CANA activation verifier; that authority does not exist here. This branch never executes an `ACTIVE` transition.

## Visual verification court

The court runs 23 independent deterministic judges:

1. genericness;
2. synthetic composition;
3. anatomy and object consistency;
4. package and logo correctness;
5. unauthorized or hallucinated text;
6. image-copy alignment;
7. local D.C. relevance;
8. premium editorial quality;
9. mobile crop integrity;
10. readability;
11. accessibility;
12. ad disclosure;
13. policy compliance;
14. truthful claims;
15. visual hierarchy;
16. CTA clarity;
17. brand consistency;
18. file-size and page-performance impact;
19. rights and provenance;
20. owner-taste alignment;
21. campaign coherence;
22. conversion mechanism;
23. landing-page continuity.

The deterministic court derives its findings from the actual desktop/mobile SVG bytes, hashes, responsive dimensions, embedded variant metadata, generation/analysis receipts, campaign genome, disclosure, rights state, copy, and performance budget. Every judge records concrete visible observations including the recognized motif, path/rectangle/circle counts, palette, minimum declared geometry opacity, responsive ratios, copy lengths, disclosure, and rights state; a blank, hidden, or effectively transparent SVG carrying expected metadata fails. It refuses an unsealed caller-supplied inspection. Owner taste is explicitly `PENDING_OWNER_DECISION`, so each candidate ends at `TECHNICAL_PASS_OWNER_REVIEW_REQUIRED`, never a final visual approval. Any technical failure blocks the candidate. Regeneration is bounded to five attempts; the slice demonstrates an artifact-mismatched generic first attempt and a coherent second attempt.

## Controlled rotation and rollback

Rotation requires `ACTIVE`, disclosure, approved and available desktop/mobile assets, an eligible placement, geographic eligibility, a valid increasing current schedule, remaining frequency allowance, and positive deterministic weight. Invalid dates and assetless candidates fail closed. The current Level 0/1 resolver never selects a sponsored candidate even if a caller fabricates an otherwise structurally eligible `ACTIVE` record: this branch has no canonical CANA activation verifier. With every generated campaign held at `OWNER_REVIEW_REQUIRED`, the resolver selects `owd-source-before-hype`, the owner-approved primary house seed. It never alters organic ordering.

`Source Before Hype` is the approved primary genome, evaluation fixture, future seed, and first fallback. `Block by Block` is the approved secondary seed. `Tonight's Shortlist` remains a rejected primary direction and is never rotation-eligible.

## Safe autonomy and future model adaptation

The vertical slice is `LEVEL_1_SHADOW_GENERATION_AND_SCORING`. Levels 0 and 1 cannot publish, rotate, or spend. Level 2 still requires explicit owner approval. Levels 3 and 4 are interfaces only and are not enabled.

The tuning-readiness interface reports no fine-tuned model and no authorization. It remains blocked until rights-cleared data, preference pairs, stable reason labels, first-party performance, duplicate and contamination checks, splits, anti-regression benchmarks, rollback, and material lift over retrieval/prompting/routing are all proven.

## Safety boundaries

- No production, cPanel, `prod.db`, deployment, merge, live ad, provider spend, advertiser charge, or campaign spend access.
- PR21 implementation paths are rejected by an ancestry audit; no branch-wide cherry-pick or rebase was used.
- Imported PR21 packet files are enumerated without following links; imported scripts and text are never executed or treated as instructions.
- Competitor evidence produces mechanism hypotheses only. Conversion and revenue remain unknown unless directly supported.
- A conversion event is accepted only with directly attributed ORDERWEEDDC first-party evidence.
- Generated image text is prohibited; disclosure and customer copy are deterministic HTML.
- Normal homepage requests have no review placement. Rendering requires `CANA_DYNAMIC_CREATIVE_REVIEW_MODE=LOCAL_ONLY`, a `.localhost` host, and an allowlisted query value derived from the canonical creative genomes.
- The execution boundary recomputes both the SiteMind context seal and Hermes packet seal, checks capability, budget, issuer, binding, and expiry, and refuses forged Hermes-shaped objects before provider selection. A grant and sealed packet must also have been admitted and sealed by the current Hermes runtime instance. Creative draft admission requires the exact runtime-held digest of the committed offline fixture authorization and validates synthetic identity, rights-cleared fixture assets, Level 1 scope, deterministic provider, no production authority, and no spend authority. A serialized receipt is evidence, not reusable execution authority.

## Known limitations

- This slice uses a synthetic advertiser and deterministic vector fixtures, not merchant-authorized photography or a live image model.
- No first-party experiment was run; CTR, conversion, revenue, and causal lift are unknown.
- The event schema and retained review evidence do not create a new persistent Competitor Event Ledger. Production persistence must reuse SiteMind's existing durability system.
- Provider quality and historical-performance scores are fixture metadata, not live benchmarks.
- The visual court combines artifact-derived deterministic inspection with real-browser accessibility and responsive checks; human owner taste remains unresolved and is recorded as pending.
- The review placement is deliberately local-only. No scheduling worker, billing integration, or production campaign inventory is active.
- Fine-tuning is neither performed nor claimed.

## Clean ancestry

The branch root and merge-base are fixed to `79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc`. The transfer audit refuses PR21 customer replacement paths and admits only new mechanisms, retained rejected evidence, and explicitly approved owner seeds. The final commit, tree, clean replay, reviewer verdicts, and PR state are reported at handoff without mutating the self-contained packet after its commit is sealed.
