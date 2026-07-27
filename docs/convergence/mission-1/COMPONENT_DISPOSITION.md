# Component Disposition

The classifications below are exhaustive for the inspected convergence inputs.
They describe present evidence, not future approval.

| Component | Exact source | Classification | Decision |
|---|---|---|---|
| CANA durable authority and evidence semantics | `CANA@ed9b32b…` | `CANONICAL_ACTIVE` | Preserve without changing business truth |
| historical CANA mission snapshot | `deliverables/MISSION_STATE.json` | `HISTORICAL_REFERENCE` | Preserve byte-for-byte; derive a new Mission 2 state |
| Context Compiler | `skills-src/sitemind-context-compiler.mjs` | `CANONICAL_ACTIVE` | Reuse exact tested source |
| Signal-to-Fix | `skills-src/cana-signal-to-fix.mjs` | `CANONICAL_ACTIVE` | Reuse exact tested source |
| governed packet | `skills-src/hermes-governed-packet.mjs` | `CANONICAL_ACTIVE` | Reuse as the execution-boundary contract |
| compiler-to-packet binding | `skills-src/e2e-compiler-packet-binding.mjs` | `CANONICAL_ACTIVE` | Preserve as a load-bearing integration court |
| TruthGraph | no executable source located | `MISSING` | Keep out of the Minimum Alive Loop; do not replace in Mission 1 |
| Winner Memory gate | `cana-signal-to-fix.mjs::toWinnerMemory` | `PARTIAL_IMPLEMENTATION` | Gate exists; durable measured-outcome binding remains for Mission 2 |
| recovered Intelligence OS | `ORDERWEEDDCRSI@125c81b…/runtime/` | `REUSABLE_IMPORT` | Port only the exact symbol allowlist in `INTELLIGENCE_OS_RECOVERY_STATUS.md`; do not copy a module or merge the repository |
| OS mission queue as independent authority | `runtime/mission.py` used outside CANA grants | `DUPLICATE` | Reuse lease/idempotency mechanics only |
| OS RSI ledger as independent policy owner | `runtime/rsi.py` used outside CANA/RSI contract | `DUPLICATE` | Reuse receipt mechanics only |
| OS evidence envelope | allowlisted functions in `runtime/evidence.py` | `REUSABLE_IMPORT` | Storage adapter; CANA retains evidence meanings |
| OS provider router mechanics | allowlisted mock/validation symbols in `runtime/model_router.py` | `REUSABLE_IMPORT` | Live-provider symbols forbidden; none/mock only |
| OS deterministic pipeline | allowlisted capture/diff/change-event symbols in `runtime/pipeline.py` | `REUSABLE_IMPORT` | `interpret` and `foundry` remain forbidden competing policy |
| ORDERWEEDDC product intelligence | `site-intelligence.mjs`, `sitemind.mjs` at `487ece6…` | `CANONICAL_ACTIVE` | Preserve as current product-admin behavior |
| ORDERWEEDDC competitor scripts | `apps/web/scripts/{competitor-shadow,competitive-loop}.mjs` | `HISTORICAL_REFERENCE` | Read-only/dev tools, not the convergence loop |
| RSI/SiteMind baseline package | archive and `RSI@a6410cd…` | `PARTIAL_IMPLEMENTATION` | Contracts/tests are useful; protected-source claim was not established |
| `rsi-sitemind-core` | `12246cd…` | `REUSABLE_IMPORT` | Use schemas/validators where they strengthen exact boundaries |
| `rsi-hermes-bridge` | `d5cc516…` | `REUSABLE_IMPORT` | Candidate boundary scaffold, not execution approval |
| `rsi-evaluations` | `4cc2c2f…` | `REUSABLE_IMPORT` | Use attack fixtures for Mission 2 falsification |
| `rsi-domain-connectors` | `b0f6d06…` | `REUSABLE_IMPORT` | Use connector contract only |
| `rsi-skills` packaging scaffold | `1e7c9fb…` | `HISTORICAL_REFERENCE` | Canonical CANA skills are stronger current source |
| `rsi-deployment` scaffold | `c72d544…` | `HISTORICAL_REFERENCE` | Not proof of deployed runtime |
| Hermes `781968b…` | tree `6759673…` | `HISTORICAL_REFERENCE` | Baseline evaluation input; never production-approved |
| Hermes `d9165d7…` | tree `040ecbb…` | `BLOCKED` | Candidate evaluation input pending exact promotion courts |
| governed fork overlay `7f84289…` | tree `ad3b67a…` | `PARTIAL_IMPLEMENTATION` | Useful workflow/policy source; declared pin is stale |
| current upstream Hermes `d71033a…` | observed 2026-07-27 | `HISTORICAL_REFERENCE` | Unselected update input; newest is not automatically preferred |
| Hermes Update Watch approval path | four failed scheduled runs | `BLOCKED` | Cannot deliver candidate branch/issue; runs no promotion court |
| draft PR #1 whole overlay | `6a6c5af…` | `PARTIAL_IMPLEMENTATION` | Do not merge wholesale |
| PR #1 clean upstream loader and focused tests | named files under `CANA_HERMES/` | `REUSABLE_IMPORT` | Candidate technique for isolated Mission 2 evaluation |
| PR #1 parallel mission/memory/router/approval plane | `CANA_HERMES/` as a new runtime owner | `DUPLICATE` | Reject as authority architecture |
| PR #1 revenue/business directives | draft documentation | `BLOCKED` | Owner/business approval required; outside technical convergence |
| `CANA_LOOP_ENGINE/` | canonical repository legacy supervisor | `HISTORICAL_REFERENCE` | Engineering supervisor, not the product intelligence loop |
| `.cana-governor-v3/` | canonical repository legacy governor | `HISTORICAL_REFERENCE` | Do not import into the Minimum Alive Loop |
| `.opencode/agents/` | canonical repository agent prompts | `HISTORICAL_REFERENCE` | Role reference only |
| `packages/paid-governance/` | canonical business governance | `CANONICAL_ACTIVE` | Preserve domain semantics; do not fold into technical policy |
| any second governor, ledger, router, or loop engine | not permitted | `SUPERSEDED` | The convergence contract selects existing seams instead |

## Rejected changes

- Whole-repository merges from RSI, ORDERWEEDDCRSI, the Hermes fork, or draft PR #1.
- Treating a local proof, component test, deployment scaffold, or dashboard import as
  production inclusion.
- Selecting Hermes because it is newest.
- Treating OS persistence, the legacy loop, or PR #1 as a second authority plane.
- Inventing TruthGraph, a replacement Intelligence OS, or another loop/router/ledger.

## Accepted design inputs

Only the exact seams named in the table may advance to Mission 2. Every import must
retain source SHA/tree, add an inclusion entry, and pass the contract and
falsification gates in `MINIMUM_ALIVE_LOOP_SPEC.md`.
