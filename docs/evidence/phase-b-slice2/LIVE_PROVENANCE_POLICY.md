# Live provenance policy

Live provenance comes only from response bytes and headers observed during the bounded acquisition. Static fixture catalog dates are rejected by the live path. Missing `Last-Modified` remains `UNKNOWN`; it is never replaced with the fixture date or local clock.

Every admitted live capture binds fixed source URL, exact request contract digest, explicit source-revision state, pre/post record count, response metadata, content SHA-256, adapter/parser/policy/court versions, repository commit/tree, tenant, and acquisition time. When the source exposes a revision, pre/post disagreement quarantines the attempt. When it does not, both revisions and the digest-bound snapshot `source_modified_at` remain `UNKNOWN`/`null`; stable exact counts and a complete bounded response permit observation compilation but cannot revalidate or extend freshness.
