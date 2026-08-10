# Verification-laundering court

The reproduced defect was concrete: `publicRetailerWhere` accepted a non-demonstration row with any past `verifiedAt`, even if `dataStatus` was `AWAITING_VERIFICATION` or `STALE` and freshness was missing or expired. SEO and ASK used the stricter policy, so customer surfaces disagreed about reality.

The repaired assertion policy uses one strict predicate before and after reads. A non-demonstration retailer is asserted as current only when it is `VERIFIED_CURRENT`, has a non-future `verifiedAt`, and has `freshnessExpiresAt > asOf`; the exact expiry boundary fails closed. Customer-facing retailer discovery, comparison, neighborhood, and product queries all reuse that predicate. Demonstration product/deal records remain available only through their separate explicit labeled catalog policy and cannot cross the retailer, API, structured-data, ASK, handoff, map, or field-assertion gates as verified truth.

Additional laundering courts prove:

- parser output remains UNKNOWN and cannot set decision eligibility;
- exact source authority for licensing cannot spread to hours, phone, website, menu, price, inventory, delivery, or quality;
- one approved field cannot make a whole retailer record truthful;
- stale, partial, tampered, contradictory, or unlinked evidence remains non-public;
- similar names and manufactured center coordinates cannot create identities;
- public map projections require eligible, verified/supported, fresh, allowlisted GeoClaims.

The fix preserves independently reviewed legacy records while they remain inside their own valid truth envelope. It does not require a MarketClaim for unrelated preexisting approvals.
