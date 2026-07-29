# Duplicate Authority Report

Verdict: the inspected lineages contain multiple executable, authority-shaped
surfaces. None may run in parallel as an independent owner. The canonical owner for
each named surface is fixed in `CANONICAL_COMPONENT_MAP.md`.

## Collision matrix

| Authority-shaped surface | Competing implementations | Canonical decision |
|---|---|---|
| Root authority | Owner Constitution; legacy governor prompts; PR #1 approval documents | Only the Owner Constitution is root authority. All machine-readable copies are subordinate transcriptions. |
| Mission state | CANA mission snapshot; CANA Loop state; OS `runtime/mission.py`; PR #1 mission queue | CANA owns mission state. OS lease/idempotency mechanics may implement storage beneath a CANA grant. Other queues are `DUPLICATE`. |
| Policy | canonical governed-packet rules; RSI governor; OS `runtime/rsi.py`; PR #1 approvals | RSI/SiteMind owns deterministic policy beneath CANA. The governed packet is the selected boundary. Independent governor/approval planes are `DUPLICATE`. |
| Evidence | CANA evidence meanings; OS evidence envelope and ledger; PR #1 receipts | CANA owns meanings and admissibility. OS components may store signed/hash-chained envelopes without redefining grades or outcomes. |
| Provider routing | OS `model_router.py`; Hermes provider registry; PR #1 router state | RSI/SiteMind owns one subordinate routing contract. Hermes executes the selected route but does not choose policy. Other active routers are `DUPLICATE`. |
| Capabilities | CANA grant; RSI schema; Hermes tools; worker prompts | CANA owns the grant. RSI validates it. Hermes and workers receive a non-expandable subset. |
| Winner Memory | Signal-to-Fix gate; OS lessons; Hermes memories; PR #1 memory | RSI/SiteMind owns eligibility. OS may persist admitted lessons. Hermes memory is execution-local and cannot become winner truth. |
| Loop control | CANA Loop Engine; OS pipeline; RSI governor; PR #1 pilot; competitor scripts | Mission 2 composes one Minimum Alive Loop from selected seams. No inspected legacy loop is imported as the convergence controller. |
| Update approval | Hermes fork workflow; upstream branch; human merge | CANA release engineering owns candidate intake and records. A watcher can propose only; owner-governed promotion remains separate. |
| Product outcome | ORDERWEEDDC site modules; OS business records; PR #1 revenue artifacts | ORDERWEEDDC is the canonical product/outcome surface. Local simulations stay UNKNOWN and cannot become business proof. |

## Specific duplicate systems

### CANA Loop Engine

`CANA_LOOP_ENGINE/` is an engineering/Codex supervisor with its own state and
orchestration language. It is useful historical operating evidence but is not the
RSI/SiteMind product loop. Importing it would create a second mission controller.
Disposition: `HISTORICAL_REFERENCE`.

### CANA Governor v3 and agent prompts

`.cana-governor-v3/` and `.opencode/agents/` encode engineering roles, routing, and
operational control. They do not own product policy, evidence, or durable mission
state. Disposition: `HISTORICAL_REFERENCE`.

### RSI baseline governor and ledger

The additive baseline includes standalone governor and ledger implementations.
Their contracts and adversarial fixtures are useful, but activating them beside
CANA and the recovered OS would duplicate policy and evidence authority.
Disposition: reusable validation inputs; independent authority is `DUPLICATE`.

### Recovered Intelligence OS

`ORDERWEEDDCRSI@125c81b…` contains a working mission queue, receipt ledger, evidence
envelope, router, pipeline, and persistence. Its mechanics are the strongest located
technical implementation. It remains subordinate: CANA owns mission/evidence and
RSI owns policy/routing. Only named adapters are `REUSABLE_IMPORT`; the OS as a
governor is `DUPLICATE`.

### Draft PR #1

PR #1 adds a parallel `CANA_HERMES/` plane with approvals, mission queue, memory,
router state, receipts, and runtime. Its exact-upstream loader and isolated tests are
useful. Its complete authority architecture is `DUPLICATE`, and its business/revenue
directives are `BLOCKED`.

### Hermes internal state

Hermes has tool, provider, memory, and update mechanisms. These are executor
facilities, not CANA authority. Mission 2 must expose only granted capabilities,
receive an already-selected route, and return receipts. Execution-local memory
cannot directly enter Winner Memory.

## Non-duplication invariant

For each required surface, exactly one entry in
`RUNTIME_INCLUSION_MANIFEST.json.canonical_owners` names the owner. An adapter may
implement a contract but cannot open a second write path. A Mission 2 test must
demonstrate that an ungranted or conflicting write fails closed before any runtime
activation is considered.
