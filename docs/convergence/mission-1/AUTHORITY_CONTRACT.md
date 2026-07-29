# CANA Convergence Authority Contract

Version: `mission-1/1.0.0`

Status: design contract; no runtime activated

## Binding hierarchy

1. `OWNER_CONSTITUTION` defines purpose, prohibited semantics, approvals, and
   irreversible-action authority.
2. `CANA_DURABLE_AUTHORITY` issues immutable mission and capability grants, preserves
   evidence meanings, and records durable release decisions.
3. `RSI_SITEMIND_INTELLIGENCE` compiles context, evaluates signals, applies
   deterministic policy, selects a permitted provider route, and decides whether a
   measured result is eligible for Winner Memory.
4. `HERMES_EXECUTION_SLOT` executes an exact governed packet with an exact approved
   source pin. It may not change policy, capabilities, evidence meaning, or mission.
5. Bounded specialist workers receive a strict subset of the Hermes grant.
6. `ORDERWEEDDC_PRODUCT` is the target product and measured-outcome surface.

The recovered Intelligence OS store is an adapter under levels 2 and 3. It is not a
seventh authority level.

## Required identifiers

Every proposed Mission 2 transition must bind:

- CANA commit and tree
- mission ID and monotonic version
- policy/schema version
- input and compiled-context digest
- capability grant digest
- selected provider mode and model, including `none` or `mock`
- Hermes commit and tree when Hermes is enabled
- target repository, commit, tree, and allowed paths
- idempotency key and lease
- output, evidence, and receipt digests
- measured-outcome source or the explicit value `UNKNOWN`

A missing identifier is a denial, not permission to infer a default.

## State and decision rules

- CANA is the only writer of authoritative mission lifecycle and capability grants.
- RSI/SiteMind may make deterministic decisions only inside the current CANA grant.
- Provider selection is a policy decision; provider execution is an executor action.
- Capabilities are deny-by-default, non-transitive, time-bounded, path-bounded, and
  non-self-amending.
- Hermes and specialist workers cannot create missions, add tools, increase spend,
  authorize external effects, approve an update, or admit Winner Memory.
- Intelligence OS persistence may enforce leases, idempotency, append-only receipts,
  and crash recovery. It cannot redefine evidence or policy.
- ORDERWEEDDC may expose product observations and accept an authorized change. It
  cannot mark the change causally successful without measured evidence.

## Evidence and learning

- CANA evidence-grade and business-truth meanings remain unchanged.
- Every claim distinguishes source inspection, local execution, isolated simulation,
  staging proof, and hosted production proof.
- A receipt records what ran; it is not approval by itself.
- Winner Memory admission requires a real predeclared outcome, a before/after
  comparison, an admissible observation window, and no unresolved contradiction.
- Local fixture, mock, shadow, or no-provider results remain `UNKNOWN` for business
  outcome and are ineligible for Winner Memory.
- A contradiction closes or blocks the affected claim. No component may overwrite
  contradictory evidence.

## Execution contract

The only permitted call direction is:

`CANA grant` → `RSI deterministic packet` → `Hermes execution adapter` →
`bounded worker` → `ORDERWEEDDC target` → `evidence` → `CANA receipt` →
`RSI Winner Memory gate`.

The reverse path carries observations and receipts, never authority. A worker cannot
call CANA to expand its own grant. Hermes cannot choose a different provider or
target. An OS retry must reuse the same idempotency key and must not duplicate an
external effect.

## Owner-gated actions

The following require explicit owner authorization and are out of Mission 1:

- approving a Hermes production pin
- supplying credentials or enabling a real provider
- enabling spend or external side effects
- deploying or including the convergence runtime in an artifact
- changing evidence, merchant-value, sponsorship, payment, or business meanings
- admitting a production lesson to Winner Memory
- provisioning infrastructure or changing protected branches

## Fail-closed conditions

Execution is denied when a pin/tree is unapproved or mismatched, the CANA grant is
missing/expired, a capability is absent, a target/path is outside scope, an evidence
digest changes, the mission lease is lost, the provider route is absent, an update
watch result is unreviewed, or a business outcome is simulated.

The safe Hermes state today is disabled because no production-approved pin exists.
