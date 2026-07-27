# Canonical GitHub import plan

Canonical target: `CannabisWorldHoldings/CANA`.

Preparation is offline:

```text
./cana github prepare
./cana github prepare --runtime-receipt <passing-cpanel-simulation-receipt.json>
```

The report classifies local branches, scans every outgoing commit patch for credential signatures, inventories tracked files at least 10 MiB, validates protected-main requirements against `.github/workflows/cana-verify.yml`, and prepares exact remote, dry-run push, pull-request, protection, tag, release and rollback commands.

Even `git push --dry-run` is not executed because it contacts the owner-gated canonical repository. The preparer records every such command as `executed: false`.

The proposed workflow uses read-only token permissions, exact Node 24.14.1, current `actions/checkout@v6` and `actions/setup-node@v6`, and these required checks:

- `candidate-unit`
- `focused-verifier`
- `maria-verifier`
- `cpanel-verifier`
- `github-import-offline`

`protected-main-policy.json` requires strict up-to-date checks, administrator enforcement, code-owner review, one approval, last-push approval, conversation resolution, linear history, and refusal of force pushes/deletions.

Runtime SHA equality is `UNPROVEN` unless a receipt is supplied. A receipt-backed PASS proves equality only to the executed local cPanel simulation in that receipt, not to a live cPanel account.

## Owner execution sequence

After explicit authorization:

1. Add the exact canonical remote and fetch it.
2. Review branch classification, secret scan and large-file inventory.
3. Execute the prepared authoritative and candidate push dry runs.
4. Push only the approved refs.
5. Apply protected-main policy and required checks.
6. Open the integration pull request using the supplied template.
7. Merge only after all receipt-bound checks pass at the merge SHA.
8. Create a signed tag and GitHub release.
9. Compare the GitHub release SHA to the actual cPanel `/api/release` SHA.

Rollback uses a merge revert for Git history, the prior immutable release activation for cPanel, and only a hash-verified database backup when a database restore is actually required and separately authorized.
