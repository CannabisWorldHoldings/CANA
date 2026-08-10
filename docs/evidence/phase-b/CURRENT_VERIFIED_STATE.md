# Current verified state

As of 2026-08-10, the committed official source cohort is not current.

- Fixture capture time: `2026-08-10T03:49:50.514Z`
- Catalog-modified date used as observation time: `2026-06-05`
- Source policy TTL: 30 days
- Current Phase B public cohorts from this fixture: **0**
- Current claim behavior: authoritative claims are `MARK_STALE`; unsupported claims remain ineligible

The pure historical benchmark at `2026-06-06T00:00:00.000Z` admits four source-authoritative predicates for each supplied exact-identity fixture and admits zero unsupported claims or false automatic links. It does not bootstrap retailers from source rows. Disposable PostgreSQL QA with one pre-existing exact-license retailer produced one tenant compilation, eight UNKNOWN claims, four admissions, four denials, and one traceable operating-status projection. Reusing the same bytes for a second tenant created a separate compilation while leaving the global projection unchanged. Rechecking the policy-owned tenant at `2026-08-10T00:00:00.000Z` marked the retailer and projection stale/non-eligible.

No production database was read or changed. No deployment, provider call, paid call, spend, publication, or cognitive promotion occurred. Existing public data outside this new source cohort retains its own evidence state and is not claimed by this packet.
