# Phase B Slice 1 contract

Phase B Slice 1 is an offline-first reality-compilation path. Its only admitted source is the committed capture of DCGIS ArcGIS Feature Layer 31, `Licensed Medical Cannabis Retailer`. It compiles positive observations about records present in that layer. It does not prove the completeness of all DC license categories, separately listed internet retailers, or businesses absent from the layer.

The runtime boundary is:

1. `capture-dc-abca-snapshot.mjs` is an explicit owner-run maintenance command. It refuses CI and requires `--allow-network` plus a new output directory.
2. `official-source-snapshot.mjs` validates committed bytes, field inventory, hashes, pagination, ordering, counts, and duplicate source identifiers without network access.
3. `compile-market-reality.mjs` is allowed only against an identity-verified disposable loopback PostgreSQL database. It reuses immutable source bytes but creates a distinct tenant compilation, deterministic resolutions, UNKNOWN claims, evidence links, and explicit contradiction records. It never creates a Retailer from an unmatched source row and cannot run the court.
4. `verify-market-reality.mjs` is a separate disposable-only command with an explicit `--as-of` clock. The independent court recomputes source and record hashes and admits only predicate-scoped, exact-identity, current evidence.
5. A complete admitted active cohort may update the legacy `Retailer` truth envelope and emit a traceable `GeoClaim` projection only for the reviewed public-projection tenant `orderweeddc.com`. Other tenants retain isolated claim histories and cannot mutate global public truth. Unsupported fields remain unknown.

The source is authoritative only for `license_number`, `license_status`, `regulated_address`, and `operating_status`. It is not evidence for hours, phone, website, menu, inventory, price, delivery coverage, sponsorship, consumer quality, demand, conversion, revenue, or ranking.

The committed fixture was captured on 2026-08-10, while its catalog says the source was modified on 2026-06-05. The compiler therefore uses 2026-06-05 as the observation clock. With the 30-day source policy, the capture is stale on 2026-08-10 and cannot create current public truth. Historical replay at 2026-06-06 is useful benchmark evidence, not a current-state claim.

All automatic identity links require one exact normalized ABCA license or one exact linked `dc_abca_license` alias. Names and addresses are evidence only. Missing, conflicting, unlinked, malformed, out-of-DC, or non-finite identity/location inputs remain review-required or unknown; no default coordinate is allowed.

Authority remains local and bounded: no production database, deployment, provider, paid call, spend, publishing, merchant/menu mutation, or cognitive promotion is authorized.
