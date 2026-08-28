# Reality Cell 0001 readiness boundary

Reality Cell 0001 is prepared for a single licensed merchant information and
product-discovery intervention. It has not been authorized or run. No merchant,
tenant, traffic, demand, conversion, revenue, exposure, or economic result in
the fixture court is real.

## Canonical owners

| Capability | Canonical owner extended |
| --- | --- |
| Immutable preregistration, Goodhart contract, causal settlement | `apps/web/src/lib/cana-intelligence/experiment.mjs` |
| Stable assignment and assignment/exposure/outcome receipts | `apps/web/src/lib/cana-intelligence/assignment.mjs` |
| Owner and merchant authority lineage | `apps/web/src/lib/cana-intelligence/authority.mjs` and the existing `assertAdmin` bridge |
| Private preview, browser/reality courts, rollback, promotion and one-time execution claim | existing Experience Fabric via `full-fabric-adapter.mjs` and `canonical-host.mjs` |
| Rendered browser evidence | Site Cortex via `site-cortex.mjs` |
| Economic settlement and inspectable ValueReceipt | `economics.mjs` |
| Independent lesson admission and future challenger boundary | `memory.mjs` and `rsi.mjs` |
| Durable evidence | existing `CanaEvidenceReceipt` and `CanaIntelligenceRecord` PostgreSQL tables |

No second auth path, truth store, Experience system, causal authority, memory,
route, or database table was created.

## Execution boundary

The real path requires all of the following exact bindings:

1. a principal receipt issued by `canonical-owner-session` from
   `canonical-assertAdmin`;
2. a `VERIFIED_REAL` merchant authorization issued by the canonical merchant
   role gate for the exact merchant, tenant, preregistration digest, treatment
   candidate digest, allowed effects, expiration, and rollback digest;
3. a browser observation receipt with candidate, commit, tree, browser version,
   viewport, screenshot and DOM digests, capture time, console result, and
   accessibility result;
4. private-preview, browser-court, reality-court, rollback, and promotion
   receipts bound to that same candidate digest; and
5. an atomic one-time promotion claim before narrow execution.

Until those receipts exist, the state is
`AWAITING_OWNER_AND_MERCHANT_AUTHORIZATION` and real execution is refused.

## Fixture court

Run the fixture-only court with an exact commit and tree:

```sh
node apps/web/scripts/reality-cell-0001-dry-run.mjs \
  --commit <40-hex-commit> \
  --tree <40-hex-tree>
node apps/web/scripts/reality-cell-0001-browser-court.mjs \
  --commit <40-hex-commit> \
  --tree <40-hex-tree> \
  --out <external-receipt-directory>
node --test apps/web/tests/reality-cell-0001.test.mjs
```

The dry run creates only `FIXTURE` receipts. Its synthetic causal and economic
patterns cannot enter verified-real memory, merchant economics, production
analytics, or an RSI claim. The adversarial court contains the 22 attacks in
the readiness directive and requires each to fail closed.
