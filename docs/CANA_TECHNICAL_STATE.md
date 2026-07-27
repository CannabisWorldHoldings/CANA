# CANA technical state

Updated: 2026-07-27

Canonical repository: `https://github.com/CannabisWorldHoldings/CANA`

Canonical default branch: `main`

Canonical release commit:
`ed9b32b4434f2916f90b83f52f892789db9929c4`

Canonical release tree:
`fa1f6a9c55d604c8d7091a8115c1a4296be78378`

Receipt branch: `integration/cana-technical-promotion-de4a497b`

Authoritative base: `c953ebcd25c46ef33af0700d7913a899d839bce8`

Resolve the exact commit containing this state:

```text
git log -1 --format=%H -- docs/CANA_TECHNICAL_STATE.md
```

## Completed

- Promoted the exact verified release to the empty private canonical GitHub
  repository without squashing, force-pushing, or rewriting history.
- Created canonical `main` at the exact verified release and preserved the
  candidate and integration traceability branches.
- Cloned `main` back from GitHub and reproduced the exact commit, tree, 183
  commits, 40-commit candidate range, merge parents, clean Git state, and zero
  fsck errors.
- Re-ran clean build, focused, full, clean-clone, release, and full-history
  secret verification from the GitHub-only clone.
- Applied every repository-level protection available on the current plan and
  recorded plan-blocked branch, tag, and secret-scanning controls.
- Preserved the existing MariaDB 11.4 simulation, deterministic verifier,
  durability CLI, cPanel simulation, and offline GitHub import package.
- Verified the Mac recovery ZIP by exact SHA-256, full CRC, central-directory
  inventory, path-safety inspection, and selective bundle reconstruction.
- Compared the recovery package's target commits, patches, tools, tests, and
  documentation against the current tree. Detailed dispositions are in
  `docs/RECOVERY_ARCHIVE_DISPOSITION.md`.
- Removed the `collectSiteIntelligenceSnapshot` resolver collision by naming
  the database-backed module `site-intelligence.server.ts`.
- Made every standard verifier profile fail when a zero-exit Next build still
  reports compiled warnings, attempted imports, or missing modules.

## Verified

- Canonical GitHub repository identity: `CannabisWorldHoldings/CANA`, private,
  default branch `main`.
- Canonical `main`: `ed9b32b4434f2916f90b83f52f892789db9929c4`,
  tree `fa1f6a9c55d604c8d7091a8115c1a4296be78378`.
- Remote-only clone verification: focused, full, clean-clone, and release PASS;
  zero real secret findings; clean source and ignored-artifact state after
  cleanup.
- GitHub Actions: selected `actions/checkout` and `actions/setup-node` only,
  SHA pinning required, read-only workflow token, and no pull-request approval
  authority.
- Recovery ZIP: 6,186,053,094 bytes, 7,590 entries, SHA-256
  `0ec9c44f77aee4342c0a783bb321af84f560cb33cbfa0bb20862f9b30efbf16a`;
  `unzip -t` PASS; zero unsafe central-directory paths.
- Current Git object database: `git fsck --full --strict` exits zero. Reported
  dangling objects are retained evidence, not corruption.
- Pre-fix full verifier at `e2eced1`: PASS with the import warning captured in
  its output, proving the old gate was bypassable.
- Post-fix focused verifier at `d9c23bf`: PASS; clean build-diagnostic marker
  present; import warning absent; isolated build and cleanup PASS.
- Targeted module-boundary and verifier-policy tests: 13/13 PASS after their
  pre-fix failure cases were recorded.

For current-commit evidence, run the repository surfaces rather than reusing a
receipt from another SHA:

```text
./cana verify focused
./cana verify full
./cana verify clean-clone
./cana verify release
./cana verify maria
./cana verify cpanel
./cana durability build
./cana durability verify
./cana github prepare
```

## Remaining

- Native branch protection, repository rulesets, required status contexts, and
  release-tag protection are unavailable for this private repository on its
  current GitHub plan. The API returned an upgrade-required `403`.
- GitHub secret scanning and push protection are unavailable for this
  repository; the API returned `422`. Local and CI outgoing-history scans
  remain required.
- No signing key is configured, so no release tag or GitHub Release was
  created.
- The MariaDB provider cutover remains a candidate artifact; hosted production
  migration, production load, and live rollback remain unexecuted.
- The standalone durability archive upload/readback path remains unexecuted.
  Canonical Git history durability is independently proven by the fresh GitHub
  clone, but that does not substitute for the durability CLI's archive
  read-back court.
- Live cPanel behavior, production DNS, and runtime SHA equality remain
  unproven by local simulations.
- No finite business-approved evidence-chain byte maximum exists because link
  count is bounded while per-link bytes are not. The technical simulation does
  not redefine that business rule.

## Owner-gated

- Provision or contact a hosted database.
- Upgrade the GitHub plan and activate the prepared branch/tag rules.
- Supply an approved signing key and authorize any release tag or GitHub
  Release.
- Contact or change a real cPanel account, DNS, Passenger process, or
  production credential.
- Approve the provider flip, production migration window, deployment, or
  rollback.
- Change merchant-value, sponsorship, evidence-grade, ledger-authority, brand,
  payment, or owner-approval semantics.

## Rollback

- Preserve the published history. Roll back repository-promotion metadata with
  ordinary revert commits; never force-push canonical refs:

  ```text
  git switch integration/cana-technical-promotion-de4a497b
  git revert <repository-promotion-metadata-commit>
  git push canonical integration/cana-technical-promotion-de4a497b
  ```

- If the verified release itself must be rolled back, create and verify normal
  revert commits from the documented four-command integration rollback, then
  fast-forward `main`. Deleting canonical refs is destructive and requires a
  separate explicit owner instruction.
- No production, cPanel, database, or outreach rollback was triggered.
