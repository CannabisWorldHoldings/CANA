# CANA technical state

Updated: 2026-07-27  
Branch: `codex/cana-bottleneck-clearance`  
Stewardship start: `e2eced1d55afcd1327c731b9d8f2e5f2a7bd19d1`  
Authoritative base: `c953ebcd25c46ef33af0700d7913a899d839bce8`

Resolve the exact commit containing this state:

```text
git log -1 --format=%H -- docs/CANA_TECHNICAL_STATE.md
```

## Completed

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

- The MariaDB provider cutover remains a candidate artifact; hosted production
  migration, production load, and live rollback remain unexecuted.
- Candidate commits remain local-only until an authorized upload/download/hash
  round trip proves remote durability.
- Live cPanel behavior, canonical GitHub checks, production DNS, and runtime
  SHA equality remain unproven by local simulations.
- No finite business-approved evidence-chain byte maximum exists because link
  count is bounded while per-link bytes are not. The technical simulation does
  not redefine that business rule.

## Owner-gated

- Provision or contact a hosted database.
- Access, push, protect, merge, tag, or release
  `CannabisWorldHoldings/CANA`.
- Contact or change a real cPanel account, DNS, Passenger process, or
  production credential.
- Approve the provider flip, production migration window, deployment, or
  rollback.
- Change merchant-value, sponsorship, evidence-grade, ledger-authority, brand,
  payment, or owner-approval semantics.

## Rollback

- Revert the stewardship commits in reverse order:

  ```text
  git log --format=%H e2eced1d55afcd1327c731b9d8f2e5f2a7bd19d1..HEAD
  git revert <newest-stewardship-commit> <older-stewardship-commit>
  ```

- The collector rename rollback restores
  `apps/web/src/lib/site-intelligence.ts` and the former extensionless import.
  Reverting only the verifier warning gate is not recommended because it would
  again permit a broken-import warning to pass.
- MariaDB, cPanel, GitHub, and durability work in this lane remains local or
  simulated; no production rollback was triggered.
- The authoritative branch was not modified.
