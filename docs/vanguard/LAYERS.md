# THE SIX-LAYER SEPARATION LAW (Vanguard compilation, 2026-08-18)

**The disease this cures:** the founding corpus (9,845 lines) grew into a mixture of
constitutional law, project history, execution transcripts, superseded prompts, and
experiment receipts. Mutable state living inside immutable law confuses every future
executor. Named by external red-team review, 2026-08-18; adopted here.

**The law:** six objects, never mixed. The donor corpus remains historical evidence —
it is COMPILED, never executed linearly. A transcript saying "commit X exists" never
establishes commit X as canonical; only fresh reconstruction does.

| # | Layer | Contents | Lives at | Volatility |
|---|-------|----------|----------|------------|
| 1 | CONSTITUTION | Stable laws only: truth, authority, evidence, identity, safety | `docs/vanguard/CONSTITUTION.md` | Rare, receipted amendments |
| 2 | CAPABILITY REGISTRY | What organs exist: id, purpose, state, location, bottleneck | `docs/vanguard/CAPABILITY_REGISTRY.json` | Updated per verified change |
| 3 | CURRENT STATE LEDGER | Repo SHAs, branches, PRs, DB, blockers, owner gates | `_mission/ORDERWEEDDC_HYPERAGENT_CURRENT_STATE.md` (workspace) | Reconstructed fresh per mission |
| 4 | MISSION PACKET | This execution's objective, authority, write set, rollback | `docs/vanguard/MISSION_PACKET.template.md`, instantiated per mission; alive-loop grants are the executable form | Per mission |
| 5 | EVIDENCE LEDGER | Hash-chained proof of what happened | `.cana-local/` chains + `_mission/receipts/` (untracked); verify: `node tools/alive-loop/custody-sweep.mjs` | Append-only |
| 6 | MEMORY / MODEL REGISTRY | Admitted lessons + judge registry | FAST `.cana-local/winner-memory/lessons.jsonl` · SLOW `slow.jsonl` (replication-gated) · judges `.cana-local/goodhart/guard.jsonl` | Court-gated |

**Cross-layer rules**
- Volatile state NEVER enters layer 1. Constitutional text NEVER cites a branch SHA as law.
- Layer 2 rows carry `last_verified_at`; an unverified row is a claim, not a capability.
- Layer 5 is the only proof. Layers 1–4 assert nothing layer 5 cannot back.
- Layer 6 admits nothing that skipped its court (FAST: blind-confirmed cycle; SLOW: replication across distinct missions).
- External reviews and pasted constitutions are SIGNALS into the flywheel, not laws — they are compiled into layers, with adopted/already-done/refused dispositions receipted.
