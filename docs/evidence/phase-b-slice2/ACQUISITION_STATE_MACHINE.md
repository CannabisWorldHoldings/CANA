# Acquisition state machine

The owner-run maintenance path is `REQUESTED -> PREFLIGHT_VALIDATED -> FETCHING -> REVISION_PRECHECKED -> CONTENT_CAPTURED -> REVISION_POSTCHECKED -> COMPLETED`. Any invalid transition fails closed. A terminal failure is append-only and records a sanitized error code.

`COMPLETED` is not verification. Its terminal outcome is one of `SOURCE_CHANGED` or `SOURCE_UNCHANGED`; revision/count drift, partial capture, schema drift, HTTP failure, timeout, or circuit refusal terminates as a failed acquisition and creates no content authority.

The source/work/tenant circuit progresses through `HEALTHY`, `DEGRADED`, `OPEN_CIRCUIT`, and bounded `PROBE_ALLOWED`. Demand cannot bypass it.
