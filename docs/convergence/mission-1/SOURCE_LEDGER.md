# CANA Convergence Mission 1 Source Ledger

Status: `COMPLETE_FOR_DESIGN`

Observed: 2026-07-27

Protected baseline inspected: `CannabisWorldHoldings/CANA@ed9b32b4434f2916f90b83f52f892789db9929c4`

Protected baseline tree: `fa1f6a9c55d604c8d7091a8115c1a4296be78378`

Mission 1 artifact revision: current `codex/cana-convergence-mission-1` HEAD,
resolved and printed by `tools/convergence-census/verify.mjs` after commit

The verifier requires `CANA_CENSUS_EXPECTED_REVISION` and
`CANA_CENSUS_EXPECTED_TREE` as out-of-band reviewed 40-hex identities. Do not derive
those values from the checkout being tested. This avoids a self-authenticating
same-branch rewrite.

This ledger is a census and candidate-branch design record. It does not claim that
these new documents exist at the protected baseline. It does not activate a runtime, merge
another repository, change production, or confer owner approval. Exact object and
file hashes are in `INPUT_HASHES.json`.

## Authority and source precedence

1. The Owner Constitution in the Mission 1 directive governs every source below.
2. Canonical CANA is the durable technical authority and mission-state home.
3. RSI/SiteMind owns intelligence and deterministic policy beneath CANA.
4. Hermes is a replaceable executor. A Git SHA is not an approval.
5. Specialist workers are bounded by grants and cannot expand their own authority.
6. ORDERWEEDDC is the product and outcome surface, not a second authority plane.

When two files appear authoritative, this order and `AUTHORITY_CONTRACT.md` decide
ownership. Executable source is not automatically canonical, and a dashboard label
is not runtime inclusion proof.

## Repository census

| ID | Repository / input | Exact ref | Tree | Census disposition |
|---|---|---|---|---|
| `canonical-cana` | `CannabisWorldHoldings/CANA` | `ed9b32b4434f2916f90b83f52f892789db9929c4` | `fa1f6a9c55d604c8d7091a8115c1a4296be78378` | Protected canonical baseline; clean clone and strict fsck passed |
| `rsi-baseline` | `princeleuel1-ops/RSI` | `a6410cdca2450b8bf176009673928735e4b821e7` | `8173517df10e61967c9cefc9aef4c3fe55d1b406` | Published copy of the attached additive baseline |
| `orderweeddcrsi-main` | `cannabisworldholdings-afk/ORDERWEEDDCRSI-` | `125c81b084c7a76aae0dc28781f106cba3204e7b` | `58e1f3b1e116519d2fb28d6613c509484eb03d0a` | Located executable Intelligence OS source |
| `orderweeddcrsi-pr-1` | draft PR #1 | `6a6c5affc7dae4fb04598dedae45bb19e25f26e3` | `017ac908ee8747f6d1c9ac139106f19b1a64337b` | Detached draft overlay; not merged or authoritative |
| `orderweeddc` | `princeleuel1-ops/orderweeddc` | `487ece684a226339ab1a7a48a08a268266672329` | `5e2c8e8e775fbad2839a1b24fdf227367cfa6b7f` | Product source and production-artifact inclusion authority |
| `rsi-sitemind-core` | component repository | `12246cdad148f934ebe0162ce76592e47937d559` | `efa0f6bcbe40f14023b39cc1a3529ed4b6896915` | Additive contracts and validator scaffold |
| `rsi-hermes-bridge` | component repository | `d5cc516e9c428c617ba3cfc302d4d3f1f6f8e71f` | `2510b96250ef61f812e5405aaeb0b9f0793d58ef` | Additive boundary scaffold; no approved execution pin |
| `rsi-hermes-runtime-overlay` | governed Hermes fork | `7f8428975490c65a808ef27a47d2d93f5058cccd` | `ad3b67a4d2f8c50be029af9a5e4e8d3c1fe09b5d` | Candidate overlay with a stale declared pin |
| `hermes-pin-781968b` | `NousResearch/hermes-agent` | `781968be5e1ec2c253b617409f8bfba652c10186` | `6759673ab41c40ec98bf9432dace682874b06190` | Historical evaluation input |
| `hermes-pin-d9165d7` | `NousResearch/hermes-agent` | `d9165d7a678d4105f42921a7fc1886df3804531b` | `040ecbb5ae51003f633f50adc792df49eae9d740` | Candidate evaluation input; not approved |
| `rsi-evaluations` | component repository | `4cc2c2fd6a5bc57859c9dbe54edb469eed6e6f51` | `4f8be076cad14b0570c7b8fc0402cd7d0f03d273` | Reusable attack fixtures |
| `rsi-domain-connectors` | component repository | `b0f6d06f5508ebf29e9116747d70af0d144025c4` | `c119126970a5719cfdfe54fb2b6fedbc6f6d3a6e` | Reusable connector contract |
| `rsi-skills` | component repository | `1e7c9fb0d093e2bc52a88633b53aba8a03e5d4df` | `bfd5ad9f6a654a97d07b2b17fb3420acb32eff56` | Historical skill-packaging scaffold |
| `rsi-deployment` | component repository | `c72d5443de1ce2921462fd6fdb5a4aa2a62bb1e6` | `8370b7d55b3962e3891d41e233a80187bb90e46d` | Historical deployment scaffold; not deployed |

All listed repositories were inspected from fresh local clones. Each listed ref
resolved to the recorded tree, its worktree was clean at intake, and
`git fsck --full --strict` exited zero.

## Attached baseline archive

Input: `RSI_HERMES_COEVOLUTION_BASELINE_2026-07-23 (1).zip`

- Bytes: `60,056`
- SHA-256: `d2eac504df659c35bfa344e1d8102600456bc63408608bb29fc8843faa717ce5`
- CRC: passed
- Coverage: 71 of 71 non-directory entries indexed and hashed
- Inventory: 27 code, 6 config, 6 data, 19 document, 12 other, 1 text
- Comparison: the six published component repositories are byte-for-byte equal to
  their corresponding archive directories
- Historical receipt limitation: the archive receipt did not run the full upstream
  Hermes suite and explicitly marks production approval false

The archive was fully inventoried because it is small source evidence. It was not
modified. No opaque or skipped source payload remains. Generated inventory and
verification scratch files stay under ignored `.cana-local/`.

## Executed evidence

| Surface | Exact source | Current independent result |
|---|---|---|
| Context Compiler | canonical CANA `skills-src/sitemind-context-compiler.mjs` | 54/54 passed |
| Signal-to-Fix | canonical CANA `skills-src/cana-signal-to-fix.mjs` | 42/42 passed |
| Governed packet | canonical CANA `skills-src/hermes-governed-packet.mjs` | 53/53 passed |
| Compiler-to-packet binding | canonical CANA exact baseline | passed |
| RSI/SiteMind contracts | `rsi-sitemind-core@12246cd…` | 17 passed |
| Domain connector | `rsi-domain-connectors@b0f6d06…` | 1 passed |
| Attack court | `rsi-evaluations@4cc2c2f…` | 19/19 passed |
| Intelligence OS verify | `ORDERWEEDDCRSI@125c81b…` | secret scan; 35 unit; 11 vertical; 45 attack; 23 shadow; crash and restart durability passed |
| PR #1 bounded adapter | PR head `6a6c5af…` against Hermes `d9165d7…` | 10 tests passed; local proof passed with zero provider, spend, or external effect |

These results establish local behavior only. They do not prove production inclusion,
hosted durability, owner approval, or a deployed self-improvement loop.
Exact commands, runtimes, source identities, failure limits, and result summaries are
in `LOCAL_VERIFICATION_RECEIPTS.json`. `ARTIFACT_MANIFEST.json` binds the complete
Mission 1 content set; the census verifier enforces its exact path allowlist and
recomputes it.

## Current source truths

- The actual executable Intelligence OS is the Python `runtime/` tree at
  `ORDERWEEDDCRSI@125c81b…`.
- ORDERWEEDDC's `site-intelligence.mjs` and `sitemind.mjs` are active product-admin
  intelligence modules, not the recovered OS worker.
- `deploy/namecheap/build-artifact.mjs` is the product artifact inclusion authority.
  It includes the Next standalone application and named assets; it does not include
  the Intelligence OS, Hermes, CANA Loop Engine, or legacy governor.
- Canonical `deliverables/MISSION_STATE.json` is a valuable historical state
  snapshot, but it is not current for convergence: several test counts and component
  statuses are stale. Mission 2 must create a new governed mission-state record
  rather than silently editing history.
- TruthGraph source was not located. Its status is `MISSING`, and it is not a
  prerequisite for the Minimum Alive Loop.

## Exclusions

No source repository was merged. No branch was pushed. No runtime, provider,
infrastructure, deployment, update watcher, or external side effect was activated.
No business truth, evidence-grade meaning, merchant-value rule, credential, or owner
approval was changed.
