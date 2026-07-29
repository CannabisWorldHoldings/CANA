# M001 read-only synthetic shadow contract

Implementation status: `IMPLEMENTED_SHADOW_ONLY`

This contract admits only
`CANA-GF-M001-VERIFIED-LOCAL-ELIGIBILITY-AND-AVAILABILITY-GRAPH` version
`0.3.0-candidate` from Package 003 SHA-256
`173e97573e43f97a1efcfd59b8c33edfb44de4d7afc11735c688c240cbd392fc`.

The implementation is a deterministic in-memory fixture under
`tools/growth-foundry/m001/`. It may model separate platform, organization,
operator, location, listing, service, service-area, offer and product identities,
plus evidence sources, observations, claims, verification events, corrections
and labeled sponsorship records.

It must enforce the seven Package 003 claim classes without changing their
source-authority, freshness or expiry policies. Consequential stale, expired,
unsupported or conflicted claims may not render as affirmative current truth.
Their safe representation is `UNKNOWN` with `VERIFY DIRECTLY`.

Corrections create new claim versions and preserve prior evidence. Sponsorship
may not change verification, confidence, contradiction visibility, truth or
organic relevance. Every record is bound to `tenant_cana` and
`workspace_orderweeddc_growth_foundry`.

No live D.C. business record, route, database, migration, analytics event,
network, merchant interaction, publication, deployment, production mutation,
provider, Hermes runtime or spending is admitted.

The source repository remains
`CannabisWorldHoldings/CANA@c4d058f5602e6db2196cccba782e1daeaa3a3ce7`
with tree `e6d21f2b9303e33bd0c357c125269bf9619b63d0`. Final technical
promotion requires exact-head tests, a fresh non-editing verifier and
exact-byte rollback proof. It establishes no deployment, value or revenue.
