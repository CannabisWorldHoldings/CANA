# INDEPENDENT VERIFICATION 08 — head candidates, 31 attacks

Verifier: independent subagent, no access to the implementer's reasoning.
Bound to exact bytes at HEAD `ac95c83`, with an isolated database.
Repairs committed: `4d68ca6`.

## Hash binding (verified identical at start AND end)

| Target | sha256 prefix |
|--------|---------------|
| `skills-src/orderweeddc-merchant-pilot.mjs` | `add2bc5625560d0e` |
| `skills-src/sitemind-context-compiler.mjs` | `5f58f9cfdc74b0d3` |
| `skills-src/hermes-governed-packet.mjs` | `d1d56f31d3d9962e` |
| `skills-src/merchant-visibility-audit.mjs` | `5b3180c8e8410dd2` |
| `apps/web/src/app/api/v1/retailers/route.ts` | `bf565278d91feac4` |

## Result: 28 of 31 attacks BLOCKED, 3 CONFIRMED

**No CRITICAL or HIGH live bypass.** Every money- and truth-integrity guard
reproduced as genuinely load-bearing — the verifier neutered each one and
confirmed the tests flip:

| Guard neutered | Tests that failed |
|----------------|-------------------|
| Pilot evidence validation | 14 |
| Pilot duplicate guard | 3 |
| Pilot ownership guard | 5 |
| Pilot demonstration guard | 3 |
| Compiler future-date guard | 2 |
| Compiler multi-subject contradiction | 1 |
| Packet LAW 2b | 6 |
| API truth boundary | demonstration record leaks; contract test fails |
| Audit truthLabel dataStatus path | exactly 5 |

The earlier P1 wrong-rejection masking bug is confirmed **fixed**: ownership no
longer pre-empts evidence rejection, and the counters are disaggregated.

## The 3 CONFIRMED findings — all in sealPacket, all repaired

| ID | Severity | Defect |
|----|----------|--------|
| #18 | MEDIUM | Omitting `intent.subjects` disabled LAW 2b contradiction blocking entirely, while the sealed body still recorded `contradictions_checked_against_intent: true` |
| #17 | LOW | `OWNER_ONLY` was exact-match, so `activate_payment` and ` ACTIVATE_PAYMENT ` slipped past. Not a live bypass — the real `makeGrant` refuses them and the verifier hand-forged a grant |
| #15 | LOW | The context digest was checked only for presence, so an arbitrary 64-hex value, a digest copied from another packet, or content edited after sealing all bound into the receipt |

**#18 is the one that mattered.** A guard the caller can switch off by withholding
metadata is not a guard — and a receipt asserting a check it never performed is a
false attestation, which is worse than performing no check. The fix is fail-closed:
a context carrying contradictions requires the intent to declare its subjects.

Fixing #15 immediately exposed the same forgery **inside my own test helper** —
the `ctx` fixture hardcoded a digest of the literal string `"ctx"`, covering
nothing. Fixtures are now self-consistent the way a real compiled packet is.

Falsification-proven with asserted anchors: reverting #18 fails 7 tests, #17
fails 4, #15 fails 4.

## The verifier's own errors, as it reported them

- Briefly treated the working `dev.db` changing hash as possible tampering. Root
  cause: the anchor it was given was the **isolated** `verifier.db`, while the live
  `dev.db` is a separate, git-untracked file being written by the running server.
  Resolved by forensics — mtime advanced under read-only load, and `verifier.db`
  stayed pristine at `73f1c970…`.
- A SQLite query used double-quoted literals (parsed as identifiers) and errored
  once; re-run with parameter binding, read-only.
- An adversarial-DB builder used `.mjs` with `require`; renamed to `.cjs`.

Worth noting: the isolation rule I codified after verification 07 is what let this
verifier resolve that DB question in minutes instead of chasing a phantom attacker.

## Cleanliness

`git status --short` empty, including untracked. All 5 target hashes match their
anchors. Isolated `verifier.db` unchanged. Every sabotage asserted its anchor
before being trusted, and was restored.

## Test state after repairs

- Web suite **327/327**
- Skills **258/258** — packet 53 (was 36), compiler 54, pilot 46, audit 23,
  demand-credits 40, signal-to-fix 42
- End-to-end compiler↔packet binding **PROVEN** under the stricter rules
