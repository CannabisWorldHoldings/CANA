# CANA RSI marketing and creative implementation map

Audit base: canonical `main` merge `375fe9be06e48010b8ef5176b74e98fde980246a`.

This map applies the correction: `packages/ad-creative` and the existing CANA/RSI/SiteMind systems are reused. No `packages/creative-foundry`, second governor, second TruthGraph, second budget authority, or copied Hermes runtime is introduced.

Status meanings: `IMPLEMENTED_AND_TESTED`, `IMPLEMENTED_UNTESTED`, `PARTIAL`, `SPECIFICATION_ONLY`, `MISSING`, and `SUPERSEDED`.

| # | Capability | Status | Canonical implementation and exact provenance | Tests / activation | Missing production pieces |
|---|---|---|---|---|---|
| 1 | Marketing strategy | PARTIAL | `apps/web/src/lib/growth-os.mjs` (`8cefed387cf56064d7e01907098abe3f030eac8a`); SiteMind in `apps/web/src/lib/sitemind.mjs` (`b810b1e7201cdf85a07436c24fbee33a5883f0e7`) | Tested and active for site/growth data, not a creative director | Creative strategy compiler and governed provider call |
| 2 | Campaign generation | PARTIAL | `packages/ad-creative/src/creative-brief.mjs` and `pipeline.mjs` (`25d6569ec74177a844847585251cf249e085bdc2`) | Offline package tests; not imported by the web runtime | Campaign planner, persisted campaign registry, placement integration |
| 3 | Billboard generation | SPECIFICATION_ONLY | `docs/GEMINI_CREATIVE_API_PLAYBOOK.md` (`d2c741254b01037d264eafe730ecefede25ad3e1`) | No executable billboard asset class | Brief, placement court, derivatives |
| 4 | Advertisement generation | IMPLEMENTED_AND_TESTED | `packages/ad-creative/` (`25d6569ec74177a844847585251cf249e085bdc2`) | Offline tests; operator-side and inactive in production | Secure live credentials, independent verifier, publishing remains disabled |
| 5 | Product-image generation | PARTIAL | `packages/ad-creative/src/creative-brief.mjs`; `.cana-governor-v3/scripts/gemini_image_worker.py` (`d2c741254b01037d264eafe730ecefede25ad3e1`) | Brief tests; legacy worker is historical reference | Authorized product-source provenance and packaging fidelity court |
| 6 | Website-image generation | PARTIAL | Same worker/playbook at `d2c741254b01037d264eafe730ecefede25ad3e1` | Legacy worker only; not canonical runtime | Active governed mission and browser placement wiring |
| 7 | Social creative generation | SPECIFICATION_ONLY | `docs/GEMINI_CREATIVE_API_PLAYBOOK.md` (`d2c741254b01037d264eafe730ecefede25ad3e1`) | No executable asset-class workflow | Brief/schema/output placement |
| 8 | Marketing-copy generation | MISSING | No `GENERATE_MARKETING_COPY` capability in canonical history | None | Provider-neutral copy task, truth/claim court |
| 9 | Landing-page generation | SPECIFICATION_ONLY | `apps/web/src/app/lab/dir-a`, `dir-b`, `dir-c` and browser court (`416fec84747dc9365b91c78ed6fead28ffc1ef31`) | Three hand-built directions; no generator | Typed generation/integration/PR loop |
| 10 | Image editing | PARTIAL | Editing is described in `docs/GEMINI_CREATIVE_API_PLAYBOOK.md`; Gemini adapter now exposes reference-based `editImage` | Adapter tests use injected transport; no paid replay | Owner-authorized live edit benchmark |
| 11 | Responsive image variants | IMPLEMENTED_AND_TESTED | `packages/ad-creative/src/asset-processing.mjs` (this draft) | AVIF/WebP derivative test | Route-specific performance thresholds and live browser proof |
| 12 | Visual verification | PARTIAL | `packages/ad-creative/src/verification.mjs` (`25d6569ec74177a844847585251cf249e085bdc2`) | Eight checks tested; this draft prevents generator self-verification | A configured independent production visual provider |
| 13 | Visual tournament | SPECIFICATION_ONLY | Research/playbook only; no canonical `visual tournament` implementation | None | Candidate comparison, adjudication, benchmark corpus |
| 14 | Browser screenshot court | IMPLEMENTED_UNTESTED | `bp.mjs` (`416fec84747dc9365b91c78ed6fead28ffc1ef31`), `ap.mjs` (`fe63cbc73bc697e14ed0a05888dd42a0b461b96d`) | Operator scripts with historical receipts | Generated-asset placement integration and CI browser fixture |
| 15 | Brand/logo protection | PARTIAL | `bf.mjs` (`9a17a743ada55f363d04892d9f65034cb192057a`); exact assets in `apps/web/public/brand/`; this draft registers hashes and deterministic compositing | Brand Fidelity Court plus new hash/derivative tests | Typography/spacing policy registry and live candidate proof |
| 16 | Prompt/Visual Genome | MISSING | No canonical `prompt genome` or `visual genome` in history | None | Do not create until a proven learning need exists |
| 17 | Creative TruthGraph claims | PARTIAL | `tools/mission-2/` (`c34fcfdaa0962e42a6c6b17e3487ff9452ecdcb2`); `tools/growth-foundry/m001/claim-graph.mjs` (`9c2662852a0b15cb7c25c381e3060a99cd9063a7`) | Tested shadow mechanisms; provider/production disabled | Creative claim schema and trustworthy attribution binding |
| 18 | Winner Memory | PARTIAL | `skills-src/cana-signal-to-fix.mjs` (`e69a2e8d4cee73376b5256e0369f64b6cdd36e73`); Mission 2 durable shadow kernel | Tests require measured improvement and court receipt | Production creative-memory store and lifecycle approval |
| 19 | Failure Memory | PARTIAL | Mission 2 failure history (`c34fcfdaa0962e42a6c6b17e3487ff9452ecdcb2`) | Tested shadow failure history | Creative-specific defect taxonomy and replay |
| 20 | Experiment engine | IMPLEMENTED_AND_TESTED | `packages/paid-governance/` (`48031962e600eadcf170365e177ee14f09169913`) | Python tests; governance semantics, not web runtime | Creative mission adapter; no duplicate ledger |
| 21 | Outcome attribution | IMPLEMENTED_AND_TESTED | `apps/web/src/app/api/v1/attribution/route.ts` (`484056171397869a1537c977e240b86c16c06f71`, hardened through `84470ee0843751e652d9af0e33f02e32c43264f5`) | Tested and active | Candidate lineage key connection |
| 22 | Creative learning loop | PARTIAL | Attribution, Signal-to-Fix, TruthGraph and Winner Memory exist separately | Components tested independently | Governed end-to-end creative linkage; no promotion without verified outcome |
| 23 | Cost control | PARTIAL | `packages/paid-governance/` (`48031962e600eadcf170365e177ee14f09169913`); signed call-time receipt verification in `packages/ad-creative/src/paid-authorization.mjs`; documented token/image estimate in `packages/ad-creative/src/gemini-cost.mjs`; legacy daily cap in `.cana-governor-v3` | Governance tests plus request-bound signature, expiry, pre-transport input/output estimate and reserved-cost tests; no verified Gemini grant ledger | Paid-governance receipt issuance, provider-usage/billing-export reconciliation and owner-confirmed grant balance |
| 24 | Provider routing | PARTIAL | `packages/ad-creative/src/provider-contract.mjs` (`25d6569ec74177a844847585251cf249e085bdc2`); role registry in this draft | Contract/registry tests | A second independent visual provider and production credentials |
| 25 | Gemini connection | PARTIAL | Existing Developer API adapter at `packages/ad-creative/src/providers/gemini.mjs` (`25d6569ec74177a844847585251cf249e085bdc2`), secured/extended for Developer API and Vertex in this draft | Missing-key, key-leak, Vertex header, parsing tests | Grant eligibility, live auth, quota/region/model replay |
| 26 | Production publishing | MISSING | Pipeline law explicitly has no posting capability (`25d6569ec74177a844847585251cf249e085bdc2`) | Intentionally disabled | Human approval and expiring per-class production authority |
| 27 | Rollback | PARTIAL | Mission 2 rollback (`c34fcfdaa0962e42a6c6b17e3487ff9452ecdcb2`); draft candidate rollback receipt in this change | Generic rollback tested; creative receipt tested | Asset-registry restore UI and deployed rollback drill |

## Historical provenance, not implementation authority

The current historical heads inspected were recorded with reproducible repository and commit API identities in `docs/creative-system/PROVENANCE_RECEIPT.json`. They are external repositories by design and are not expected to exist in the CANA object database.

- `cannabisworldholdings-afk/ORDERWEEDDCRSI-` at `125c81b084c7a76aae0dc28781f106cba3204e7b`: reusable router mechanics only.
- `princeleuel-code/rsi-sitemind-core` at `9333c1d572a6be39df30e98ee07c451624190a8f`: signed grants and promotion-court lineage.
- `princeleuel-code/rsi-skills` at `e9aa9e8d64b28f4de5ae8831e682701e324db987`: proposal-only daily growth and candidate-learning skills.
- `princeleuel-code/rsi-evaluations` at `5dc9ea2dc83e27b29dc3156fb0eb9743b79863a7`: attack-court provenance.
- `princeleuel-code/rsi-hermes-runtime` at `d97d91c6542a071337a244262fc1f68426a03ab8`: provider-neutral image mechanics, but Hermes remains unapproved and blocked by canonical convergence policy.

No historical code was copied.

## Governed authority and activation

`OWNER -> CANA authority and paid-governance budgets -> RSI/SiteMind context -> Hermes only when separately authorized -> configured provider -> independent verification -> named human approval -> controlled deployment -> attribution -> TruthGraph hypothesis -> Winner/Failure Memory`.

Current activation is `DRAFT_ONLY`. Gemini is a provider only. Production publishing, spending without an approved budget, self-verification, and learning promotion without verified outcome and attribution are disabled.
