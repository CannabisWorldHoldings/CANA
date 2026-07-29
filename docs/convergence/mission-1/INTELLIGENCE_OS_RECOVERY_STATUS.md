# Intelligence OS Recovery Status

Verdict: `LOCATED_AND_EXECUTED_LOCALLY`.

The actual Intelligence OS source exists at
`cannabisworldholdings-afk/ORDERWEEDDCRSI-@125c81b084c7a76aae0dc28781f106cba3204e7b`.
It is not missing, does not need redesign in Mission 1, and is not in the current
ORDERWEEDDC production artifact.

## Exact source

| Surface | File | Role |
|---|---|---|
| persistent store | `runtime/db.py` | SQLite schema, transactions, durable records |
| mission state | `runtime/mission.py` | queue, lease, idempotency, transition mechanics |
| RSI/receipt core | `runtime/rsi.py` | policy-shaped orchestration and receipts |
| evidence | `runtime/evidence.py` | evidence envelope and integrity mechanics |
| provider routing | `runtime/model_router.py` | explicit route/provider selection mechanics |
| deterministic pipeline | `runtime/pipeline.py` | bounded local orchestration |
| verification | `tests/`, `scripts/`, `Makefile` | unit, vertical, attack, shadow, crash, restart courts |
| declared Hermes input | `vendor/HERMES_UPSTREAM_PIN.json` | historical/candidate metadata only |

Exact file sizes and SHA-256 values are bound in `INPUT_HASHES.json`.

## Independent execution

In an isolated worktree, `SYSTEM_MAKE_UNDER_TEST verify` passed:

- secret scan: clean
- unit tests: 35/35
- vertical slice: 11/11
- attack court: 45/45 with exact denial codes
- mock shadow: 23/23
- crash recovery: passed
- restart durability: passed

The run had no external side effects. Its signer mode was
`DEV_TAMPER_EVIDENT`; no real provider was selected. Therefore it proves local
mechanics, not production cryptographic identity, hosted durability, or business
outcome.

## Canonical disposition

Classification: `REUSABLE_IMPORT`.

Mission 2 may selectively reuse:

- mission lease and idempotency mechanics
- deterministic pipeline boundaries
- evidence envelope and receipt integrity
- explicit none/mock provider routing
- crash/restart fixtures
- lesson persistence only behind the canonical Winner Memory gate

Mission 2 must not wholesale copy `runtime/rsi.py` or let the OS own authority,
mission policy, evidence meaning, provider policy, capability grants, or Winner
Memory admission.

## SHA/tree-bound symbol boundary

This boundary applies only to
`ORDERWEEDDCRSI@125c81b084c7a76aae0dc28781f106cba3204e7b`, tree
`58e1f3b1e116519d2fb28d6613c509484eb03d0a`. “Allowlisted” permits a minimal,
behavior-preserving port behind the canonical contracts; it does not permit a
module copy.

| File | Allowlisted symbols | Explicitly forbidden in the Minimum Alive Loop |
|---|---|---|
| `runtime/mission.py` | `create`, `lease`, `heartbeat_mission`, `checkpoint`, `complete`, `fail`, `record_side_effect`, `get` | `outbox_intent`, `outbox_update`, worker heartbeat as an authority source |
| `runtime/rsi.py` | `canonical`, `sha`, `ReceiptLedger.append`, `ReceiptLedger.verify_chain`, `ReceiptLedger.checkpoint` | `issue_authorization`, `issue_capability`, `revoke`, `ActionContract`, `RSIGovernor`, `PromotionCourt`, `DevFileSigner` in production |
| `runtime/evidence.py` | `scan`, `make_item`, `assemble`, `extract_tool_requests`, `assert_no_authority` | none beyond the rule that CANA retains evidence meanings |
| `runtime/model_router.py` | `SchemaError`, `ProviderResult`, `Provider`, `MockProvider`, `validate_model_output`, `DurableCircuitBreaker` | `OpenAICompatibleProvider`, `GeminiProvider`, `PROVIDER_ADAPTERS`, `build_providers`, `_record_call`, `interpret_with_models` |
| `runtime/pipeline.py` | `normalize`, `content_hash`, `capture`, `diff`, `make_change_event`; `record_lesson` only after canonical Winner Memory admission | `interpret`, `foundry`, `LessonPromotionError` as a competing policy court |
| `runtime/db.py` | schema shapes for missions, receipts, side effects, and lessons; `connect`/`init` in an isolated fixture only | `reset` outside fixtures; a second production database or migration authority |

Private helpers may be reimplemented only when strictly required by one allowlisted
symbol and must remain private. Mission 2 must cite the original file hash from
`INPUT_HASHES.json` for every port. No live-provider class is in scope.

## Related but non-equivalent sources

### ORDERWEEDDC product intelligence

`princeleuel1-ops/orderweeddc@487ece6…` contains
`apps/web/src/lib/site-intelligence.mjs` and `sitemind.mjs`, imported by the product
admin surface. They are valid current product intelligence, not the recovered OS
worker or durable convergence state.

### Draft PR #1

PR #1 head `6a6c5af…` adds `CANA_HERMES/` and changes mission runtime. Its exact
upstream loader and isolated adapter tests are useful `REUSABLE_IMPORT` candidates.
The complete overlay is `PARTIAL_IMPLEMENTATION`; its parallel queue, approvals,
memory, router, receipts, and business directives must not become a second OS or
authority plane.

### Legacy controllers

`CANA_LOOP_ENGINE/` and `.cana-governor-v3/` are engineering supervisors.
ORDERWEEDDC competitor scripts are read-only/dev tools. None is the Intelligence OS.
They remain `HISTORICAL_REFERENCE`.

## Production inclusion proof

At ORDERWEEDDC commit `487ece6…`,
`deploy/namecheap/build-artifact.mjs` assembles the Next standalone application,
traced Node modules, static/public assets, named web scripts, Prisma, merchant data,
and deployment scripts. It does not include or import:

- `ORDERWEEDDCRSI/runtime/`
- Hermes
- CANA Loop Engine
- CANA Governor v3
- the convergence skills as a worker

Consequently:

- local OS execution: proven
- current product runtime inclusion: false
- hosted OS execution: unproven
- hosted OS persistence/backup/restore: unproven
- production provider routing: unproven
- real business outcome: unproven

Any future production claim requires an intentional, separately authorized builder
change plus exact artifact and hosted-runtime verification.
