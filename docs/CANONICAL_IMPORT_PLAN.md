# Canonical GitHub import plan

Canonical target: `CannabisWorldHoldings/CANA`.

Preparation is offline:

```text
./cana github prepare
./cana github prepare --runtime-receipt <passing-cpanel-simulation-receipt.json>
```

The report classifies local branches, scans every outgoing commit patch for credential signatures, inventories tracked files at least 10 MiB, validates protected-main requirements against `.github/workflows/cana-verify.yml`, and prepares exact remote, dry-run push, pull-request, protection, tag, release and rollback commands.

Even `git push --dry-run` is not executed because it contacts the owner-gated canonical repository. The preparer records every such command as `executed: false`.

The proposed workflow uses read-only token permissions, exact Node 24.14.1, immutable reviewed commit SHAs for `actions/checkout` and `actions/setup-node`, and these required checks:

- `candidate-unit`
- `clean-build`
- `focused-verifier`
- `full-verifier`
- `clean-clone-verifier`
- `release-verifier`
- `migration-validation`
- `maria-verifier`
- `cpanel-verifier`
- `durability-proof`
- `secret-scan`
- `github-import-offline`

The explicitly approved canonical refs are:

- `main`, initially fixed at the verified release commit;
- `codex/cana-bottleneck-clearance`, preserving the complete candidate lane;
- `integration/cana-technical-promotion-de4a497b`, preserving the
  history-preserving integration and repository-promotion receipts.

The authoritative recovery branch is not published by the canonical promotion
unless a later owner instruction names it explicitly.

`protected-main-policy.json` requires strict up-to-date checks, administrator enforcement, code-owner review, one approval, last-push approval, conversation resolution, linear history, and refusal of force pushes/deletions.

Runtime SHA equality is `UNPROVEN` unless a receipt is supplied. A receipt-backed PASS proves equality only to the executed local cPanel simulation in that receipt, not to a live cPanel account.

## Owner execution sequence

After explicit authorization:

1. Add the exact canonical remote and fetch it.
2. Review branch classification, secret scan and large-file inventory.
3. Execute prepared dry runs for only the explicitly approved refs.
4. Push only those refs without force or squash.
5. Apply protected-main and release-tag policy where the GitHub plan supports
   those controls.
6. Run the required checks and clone the default branch back from GitHub.
7. Create a signed release tag only when a signing key and tag protection are
   both available.
8. Compare any later GitHub release SHA to the actual cPanel `/api/release`
   SHA.

Rollback uses a merge revert for Git history, the prior immutable release activation for cPanel, and only a hash-verified database backup when a database restore is actually required and separately authorized.
