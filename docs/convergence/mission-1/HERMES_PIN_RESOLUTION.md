# Hermes Pin Resolution

Verdict: no inspected Hermes SHA is production-approved. `d9165d7…` is the candidate
evaluation input; `781968b…` is historical. The rollback behavior is to disable
Hermes and retain the last separately approved deployed runtime, not to silently
select an older unapproved SHA.

## Exact identity and ancestry

| Role under this design | Commit | Tree | Source / relationship |
|---|---|---|---|
| Historical input | `781968be5e1ec2c253b617409f8bfba652c10186` | `6759673ab41c40ec98bf9432dace682874b06190` | `NousResearch/hermes-agent`; 2026-07-23 15:34:06Z; unsigned commit |
| Candidate input | `d9165d7a678d4105f42921a7fc1886df3804531b` | `040ecbb5ae51003f633f50adc792df49eae9d740` | Same source; 2026-07-23 16:31:58Z; unsigned commit; linear descendant of `781…` |
| Governed fork overlay | `7f8428975490c65a808ef27a47d2d93f5058cccd` | `ad3b67a4d2f8c50be029af9a5e4e8d3c1fe09b5d` | `d916…` plus one CANA/RSI overlay commit |
| Current upstream observed | `d71033a4077a6dfdcdb42c9e9eeab4c41e4a7012` | `129a441930d11bc6bace9c72e81c960289008898` | Update input observed 2026-07-27; not selected |

`d916…` is 16 commits and 20 changed files ahead of `781…`. It includes a
credential-pool non-reentrant-lock deadlock fix plus context, kanban-isolation, and
update/autostash work. Newer ancestry is a reason to evaluate, not an approval rule.

## Pin-bound evidence

### `781968b…`

- The attached baseline and published component source declare this pin.
- The declaration explicitly says `production_approved: false`.
- The archive’s original receipt reports failure because two component test commands
  could not execute in that historical environment; its attack court passed 19/19.
- The baseline did not run an upstream Hermes suite.
- Upstream PR #70143 reported targeted and broader checks, but those claims are
  upstream historical evidence rather than a CANA promotion receipt.

Disposition: `HISTORICAL_REFERENCE`. It is not a safe automatic rollback target
because it predates known fixes and was never approved.

### `d9165d7…`

- Exact candidate tree: `040ecbb5ae51003f633f50adc792df49eae9d740`.
- Independent exact-SHA tests across the seven files changed in the
  `781…`→`d916…` range: 821 passed in 61.98 seconds.
- Draft PR #1 bounded adapter tests against this exact checkout: 10 passed.
- PR #1 local proof loaded skills through
  `agent.prompt_builder.build_skills_system_prompt`, emitted one receipt, lesson, and
  next mission, and used no provider, spend, or external side effect. Its business
  outcome remained `UNKNOWN`.
- Upstream PR #70154 contains contemporaneous upstream-authored test claims, but this
  artifact set does not treat that PR text as a CANA verification receipt.
- No CANA/RSI production promotion receipt, tenant-isolation court, governed
  capability court, browser/product inclusion proof, or rollback rehearsal exists.

Disposition: `BLOCKED` candidate. License observed: MIT. Commit signature state:
unsigned. Exact commands, test paths, environment, and local-proof truth fields are
recorded in `LOCAL_VERIFICATION_RECEIPTS.json`; all those source files, `LICENSE`,
`SECURITY.md`, and `pyproject.toml` are hash-bound in `INPUT_HASHES.json`.

Security state: MIT license observed; upstream security policy present; commit
unsigned; no CANA dependency/OSV receipt, secret scan of a proposed overlay,
tenant-isolation promotion court, or production capability inventory exists.

## Fork provenance defect

The governed fork head `7f84289…` is based on `d916…`, but its
`UPSTREAM_PIN.json` still declares `781…`. Therefore its effective source ancestry
and declared pin disagree. Mission 2 must never promote this overlay until the
immutable SHA and tree declaration matches the exact runtime ancestry and the
resulting overlay commit receives its own gates.

## Update Watch history

The fork’s `.github/workflows/upstream-candidate.yml` detected upstream movement but
did not produce an approvable candidate:

| Scheduled run | Resolved upstream | Result |
|---|---|---|
| 2026-07-24 | `a61183b…` | local merge succeeded; push rejected because the GitHub App lacked workflows permission |
| 2026-07-25 | `760112a…` | `.gitignore` conflict; failure issue creation was not permitted |
| 2026-07-26 | `37a2766…` | same conflict and unavailable issue escalation |
| 2026-07-27 | `d71033a…` | same conflict and unavailable issue escalation |

No `candidate/hermes-*` branch or candidate PR exists. The workflow creates candidate
text but runs no RSI bridge, authority, tenant-isolation, poisoning, dependency,
shadow/canary, cost, inclusion, or rollback gate. Update Watch is `BLOCKED` as an
approval mechanism.

## Roles

- **Approved:** none.
- **Candidate:** `d9165d7…` only, bound to tree `040ecbb…`.
- **Historical:** `781968b…`, bound to tree `6759673…`.
- **Rollback:** disable the Hermes execution slot and retain the last separately
  approved deployed baseline. Neither inspected SHA may be invented as approved.
- **Unselected update:** `d71033a…`; record and evaluate separately if requested.

## Mission 2 promotion court

Before a candidate can become approved, require one dated, durable receipt bound to
the exact upstream SHA/tree and overlay SHA/tree. It must cover upstream suites,
bridge contracts, authority denial, tenant isolation, capability non-escalation,
memory poisoning, dependency/secret/security scanning, deterministic mock execution,
cost limits, process cleanup, product artifact inclusion if intended, and rollback.
Any absent or unreproducible gate leaves Hermes disabled.
