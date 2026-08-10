# Acquisition state machine

The owner-run changed path is `REQUESTED -> PREFLIGHT_VALIDATED -> FETCHING -> CAPTURED -> POSTFLIGHT_VALIDATED -> CHANGED -> PERSISTED -> COMPLETED`. The unchanged path replaces the last three states with `UNCHANGED -> REVALIDATION_PENDING -> COMPLETED`. Any invalid transition fails closed. A terminal failure is append-only and records a sanitized error code plus one typed terminal result.

`COMPLETED` is not verification. Its terminal result is `SUCCESS_CHANGED` or `SUCCESS_UNCHANGED`. Failed results are `SOURCE_OUTAGE`, `RATE_LIMITED`, `HTTP_FAILURE`, `TIMEOUT`, `SCHEMA_DRIFT`, `CAPABILITY_CHANGED`, `PARTIAL`, `REVISION_UNBOUND`, `CONTENT_TYPE_REFUSED`, `PAYLOAD_LIMIT_EXCEEDED`, `POLICY_REFUSED`, or `CANCELLED`.

Every terminal receipt carries `may_retry`, `may_fallback`, `may_compile`, `may_revalidate`, `may_create_negative_evidence`, and `may_mutate_truth`. All failures deny compilation, revalidation, negative evidence, fallback, and truth mutation. Changed success may compile and enter the separate court; unchanged success may enter only the separate revalidation court. Neither success may mutate truth directly.

The source-wide advisory lock permits one acquisition for the fixed source/work class at a time. Tenant-keyed circuit histories remain independent. Each attempt has exactly five fixed read requests, zero automatic retries, a 500-record ceiling, 2 MiB response ceiling, 4 MiB run ceiling, and 30-second run ceiling. HTTP 429 opens the tenant circuit immediately and honors a bounded `Retry-After`; other source failures open it after three attempts. Demand and continuation cannot invoke or bypass the owner maintenance path.
