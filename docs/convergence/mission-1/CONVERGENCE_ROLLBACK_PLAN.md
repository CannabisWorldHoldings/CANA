# Convergence Rollback Plan

Mission 1 changes documentation and evidence tooling only. It activates no runtime
and changes no production artifact. The protected baseline remains
`ed9b32b4434f2916f90b83f52f892789db9929c4` with tree
`fa1f6a9c55d604c8d7091a8115c1a4296be78378`.

## Mission 1 rollback

Before integration, review the Mission 1 commit and record its full SHA. On an
integration branch, reverse it without rewriting history:

```sh
git switch <integration-branch>
git revert --no-edit <mission-1-commit>
git fsck --full --strict
git status --short
```

If the branch has not been integrated, simply stop using
`codex/cana-convergence-mission-1`; do not delete historical evidence or rewrite the
canonical baseline. The attached archive and source clones are inputs, not changed
artifacts.

## Mission 2 runtime rollback requirements

| Failure | Required rollback |
|---|---|
| composition adapter fails | deactivate only the new adapter; restore prior artifact pointer |
| mission-state migration fails | stop writers, restore pre-migration backup, verify digest and row counts before reopening |
| receipt/digest mismatch | quarantine new receipts; retain original and contradictory bytes |
| provider or capability violation | disable route and Hermes slot; revoke the specific grant |
| Hermes candidate failure | disable Hermes; retain the last separately approved deployed baseline |
| update watcher failure | leave production pin unchanged; record the failed candidate/ref |
| product regression | restore exact prior ORDERWEEDDC release; preserve convergence receipts for analysis |
| Winner Memory contamination | block reads of the new entry, preserve it as rejected evidence, and restore the prior admitted set |

Rollback must never:

- promote `781968b…` or `d9165d7…` by inference
- erase a failed receipt or contradiction
- overwrite `deliverables/MISSION_STATE.json`
- switch providers silently
- weaken capability or evidence rules
- revert unrelated product, business, or brand history

## Pre-activation proof required in Mission 2

Before any runtime inclusion, capture:

1. exact old and new commit/tree and artifact hashes
2. database/schema and durable-state backups
3. an immutable runtime-inclusion manifest
4. isolated activation, restart, and rollback receipts
5. evidence that the old artifact can be reactivated
6. evidence that rollback leaves one authority writer and no orphan worker

The safe current state is no convergence runtime and no approved Hermes pin.
