# Freshness policy map

| Predicate group | Source policy | Effective expiry |
|---|---|---|
| ABCA license/status/address/operating status | `dc-abca-freshness-v1`, maximum 30 days | `min(acquired_at + 30 days, license_expiration)` |
| Unsupported predicates | no authority | `UNKNOWN`, never eligible |

Eligibility exists only for `verified_at <= as_of < freshness_expires_at`. The exact expiry boundary is stale. A later identical acquisition can renew only predicates independently re-adjudicated against the same complete content and current acquisition event.

Freshness debt states are `CURRENT`, `APPROACHING_STALE`, `STALE`, and `FRESHNESS_UNKNOWN`. Priority changes work ordering, never truth.
