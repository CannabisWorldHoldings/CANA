# Stage A mandatory-suite determinism ledger

Source base: `bf9127467e075d9e3348122cd8b5d849ff7674af`

This census covers the mandatory GitHub workflow, root verification runner,
container verifier, web test suite and the MariaDB, cPanel, migration,
durability, release, security and packaging paths those gates execute. Static
search is evidence for inspection, not evidence of a defect. A finding is
repaired only when a deterministic reproducer proves a flake.

## Proven repairs

| Finding | Classification | Evidence | Resolution |
| --- | --- | --- | --- |
| A 12-byte interaction nonce encoded as `4bcc9706226655410b89a675` contains the consecutive numeric substring `9706226655410`, which the privacy court classifies as phone-like. | `PROVEN_FLAKE` | The captured bytes reproduce the exact regex match at offset 4 without repeated random execution. Full verification previously failed 590/591 at `interaction-proof.test.mjs`. | Preserve all 96 random bits and encode each nibble bijectively with the digit-free alphabet `a` through `p`. No rejection loop or modulo selection is used. |
| `durability-proof` evaluates `CANA_RECEIPT_DIR` and `CANA_LOCAL_STATE_DIR` from `runner.temp` in job-level `env`. | `REAL_PRODUCT_DEFECT` | GitHub run `30331776601` failed before scheduling any job. The two references are the only `runner.*` expressions in a pre-runner workflow location. | Not modified on this branch. The exact one-commit repair remains preserved as `c377ca832799ec72c8b639d7d8fb0281459c6585`. |

No other `PROVEN_FLAKE` or `REAL_PRODUCT_DEFECT` was established by this
census.

## Interaction nonce contract

- Origin: `crypto.randomBytes(12)` in `issueInteractionToken`.
- Entropy: 96 bits.
- Previous representation: 24 lowercase hexadecimal characters.
- New representation: 24 letters from a 16-symbol alphabet, with one letter
  per hexadecimal nibble.
- Persistence: the nonce is stored as an unconstrained string and compared for
  equality to refuse replay.
- Parsing: no repository consumer parses the nonce as hexadecimal or converts
  it to a number.
- Verification: token verification authenticates the signed payload but does
  not impose a nonce alphabet. Previously issued signed tokens with hexadecimal
  nonces remain valid until their existing expiry.
- External contract: token version, signing input, expiry, tenant, merchant,
  action and replay semantics are preserved. The nonce is opaque outside its
  generator and verifier.
- Privacy purpose: both provenance exclusion and lexical PII exclusion. User
  identifiers are not accepted as signing inputs, and values in the signed
  claims are also checked for identifying lexical forms.
- Production randomness: remains Node's cryptographically secure
  `crypto.randomBytes`; the captured-byte seam uses `node:test` method mocking
  and is not request-, environment- or production-controlled.

## Bounded census

The static census recorded 693 pattern occurrences. Counts can overlap when one
line matches more than one category.

| Category | Occurrences | Classification | Repair decision |
| --- | ---: | --- | --- |
| `Date.now` and `new Date` | 338 | `DETERMINISTIC_SAFE` or `OUTSIDE_SCOPE` | Tests overwhelmingly use fixed or explicitly supplied times. Production clock use implements expiry, audit timestamps and UI freshness. No additional failure was reproduced, so no clock behavior changed. |
| `Math.random` | 0 | `DETERMINISTIC_SAFE` | No finding. |
| `randomBytes` | 22 | `DETERMINISTIC_SAFE`, `TEST_ONLY_NONDETERMINISM`, plus the repaired flake | Authentication salts, sessions, interaction secrets and production proof nonces require cryptographic entropy. Test-runner names, temporary artifacts and migration fixture identities are isolated or equality-insensitive. Only the interaction nonce had the captured semantic-regex collision. |
| `randomUUID` | 11 | `TEST_ONLY_NONDETERMINISM` or `DETERMINISTIC_SAFE` | Used for unique fixture rows, spill identities and receipt sessions. Full verification supplies deterministic crypto to the test process; assertions do not depend on lexical UUID content. No failure reproduced. |
| Temporary-path and runner-temp use | 38 | `DETERMINISTIC_SAFE`, except the preserved workflow defect | `mkdtemp` paths and random suffixes provide isolation and are not asserted lexically. The two invalid job-level runner references are handled only by preserved commit `c377ca8`. No machine-specific `/tmp` path was introduced. |
| Filesystem enumeration | 22 | `DETERMINISTIC_SAFE` or `OUTSIDE_SCOPE` | Selection paths sort where newest/ordered choice matters; other walks perform set, existence, count or recursive inclusion checks. No enumeration-order failure was reproduced, so speculative ordering edits were not made. |
| Database queries and SQL | 109 | `DETERMINISTIC_SAFE` or `OUTSIDE_SCOPE` | Ordered product surfaces use explicit ordering; courts that inspect unordered result sets compare by identity, count or set semantics. No row-order failure was reproduced. Prisma schema and query semantics were not changed. |
| Port use | 35 | `DETERMINISTIC_SAFE` | The general verifier owns port 3000 inside an unpublished container network namespace. cPanel subprocesses request port 0 and publish the assigned port through isolated files. No host-port race was reproduced. |
| Retry or attempt text | 83 | `DETERMINISTIC_SAFE` or `OUTSIDE_SCOPE` | Executed retry loops are bounded readiness, database-lock or cleanup checks. No test is rerun until passing, and no generic retry, skip or `continue-on-error` was added. |
| Locale and timezone references | 35 | `DETERMINISTIC_SAFE` or `OUTSIDE_SCOPE` | Verification exercises UTC and fixed ISO timestamps. Locale formatting in product UI was not connected to a mandatory failure and remains unchanged. |
| Shared mutable fixtures | reviewed mandatory harness | `DETERMINISTIC_SAFE` | Full web tests run with `--test-concurrency=1`, a container-local disposable database and isolated temporary directories. No shared-state flake was reproduced. |
| Wall-clock expiry assertions | reviewed interaction, structured-data, sponsorship and challenge courts | `DETERMINISTIC_SAFE` | Boundary tests pass explicit frozen clocks. Live production defaults remain live and unchanged. |
| Concealing retries | reviewed workflow and runner | `DETERMINISTIC_SAFE` | No automatic test retry, skipped flaky test, failure suppression or `continue-on-error` exists in the repaired path. |

## Explicit non-repairs

- The deterministic test entropy adapter remains verification-only and seeded by
  the exact commit. It does not replace application-server randomness.
- Page-challenge, password, session, receipt, durability and database-fixture
  randomness remains unchanged.
- Product clock, timezone, locale, query ordering and filesystem behavior remains
  unchanged where no deterministic failure was proven.
- The six inherited lint findings, nine development-toolchain audit findings and
  Dependabot findings are recorded maintenance debt and are not remediated here.
- Prisma schema, provider routing, Hermes, deployment, hosting, production
  configuration, business semantics and attribution grading are unchanged.
