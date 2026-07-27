# Canonical Component Map

This map assigns exactly one canonical owner to every named surface. “Owner” means
the component that may define the contract and accept durable state. An implementation
may live elsewhere without acquiring authority.

## Canonical owner IDs

- `OWNER_CONSTITUTION`: root human authority expressed by the binding directive
- `CANA_DURABLE_AUTHORITY`: canonical CANA mission, grants, evidence meanings, and release decisions
- `RSI_SITEMIND_INTELLIGENCE`: deterministic intelligence and policy beneath CANA
- `HERMES_EXECUTION_SLOT`: replaceable, exactly pinned execution adapter
- `ORDERWEEDDC_PRODUCT`: product state and measured business outcomes
- `INTELLIGENCE_OS_STORE`: selected durable technical state adapter from the recovered OS

## Exact ownership assignment

| Required surface | Exactly one canonical owner | Selected contract/source | Current classification | Mission 2 rule |
|---|---|---|---|---|
| authority | `OWNER_CONSTITUTION` | Mission 1 binding hierarchy | `CANONICAL_ACTIVE` | No machine component may reinterpret or expand it |
| mission state | `CANA_DURABLE_AUTHORITY` | new CANA-governed state derived from, not overwriting, `deliverables/MISSION_STATE.json` | `PARTIAL_IMPLEMENTATION` | CANA grants and closes every mission |
| policy | `RSI_SITEMIND_INTELLIGENCE` | deterministic policy contract under CANA grants | `PARTIAL_IMPLEMENTATION` | Policy proposes/decides within grant; CANA remains authority |
| Context Compiler | `RSI_SITEMIND_INTELLIGENCE` | `skills-src/sitemind-context-compiler.mjs` | `CANONICAL_ACTIVE` | Reuse exact tested boundary |
| TruthGraph | `RSI_SITEMIND_INTELLIGENCE` | no executable source located | `MISSING` | Explicit non-prerequisite; do not invent one |
| Winner Memory | `RSI_SITEMIND_INTELLIGENCE` | `skills-src/cana-signal-to-fix.mjs::toWinnerMemory`; OS persistence only as adapter | `PARTIAL_IMPLEMENTATION` | Persist only real measured improvement |
| Signal-to-Fix | `RSI_SITEMIND_INTELLIGENCE` | `skills-src/cana-signal-to-fix.mjs` | `CANONICAL_ACTIVE` | Reuse exact tested boundary |
| evidence | `CANA_DURABLE_AUTHORITY` | CANA evidence semantics and governed receipt contract | `CANONICAL_ACTIVE` | Adapters may store evidence but may not redefine it |
| provider routing | `RSI_SITEMIND_INTELLIGENCE` | one deterministic adapter using recovered `runtime/model_router.py` mechanics | `REUSABLE_IMPORT` | Default none/mock; routing grants no authority |
| capabilities | `CANA_DURABLE_AUTHORITY` | CANA capability grant schema enforced through one RSI adapter | `PARTIAL_IMPLEMENTATION` | Deny by default; workers cannot add capabilities |
| Hermes execution | `HERMES_EXECUTION_SLOT` | exact SHA/tree candidate only after promotion gates | `BLOCKED` | No approved pin exists; disabled is the safe state |
| update watching | `CANA_DURABLE_AUTHORITY` | release-engineering watcher contract; fork workflow is a subordinate mechanism | `BLOCKED` | Watcher may propose candidates, never approve them |
| Intelligence OS state | `INTELLIGENCE_OS_STORE` | selected seams from `ORDERWEEDDCRSI@125c81b…` | `REUSABLE_IMPORT` | Store mission lease/idempotency/receipts without owning policy |

## Authority chain

`OWNER_CONSTITUTION` → `CANA_DURABLE_AUTHORITY` →
`RSI_SITEMIND_INTELLIGENCE` → `HERMES_EXECUTION_SLOT` →
bounded specialist workers → `ORDERWEEDDC_PRODUCT`.

`INTELLIGENCE_OS_STORE` is a state adapter beneath CANA and RSI. It is not a new
level in the authority chain. ORDERWEEDDC records product state and measured outcome;
it does not decide whether evidence is admissible or a mission is authorized.

## Conflict rule

If a legacy loop, governor, queue, ledger, router, receipt store, or prompt claims
the same surface, it is subordinate to this table or is classified `DUPLICATE`.
No implementation becomes canonical merely because it is executable or newer.
