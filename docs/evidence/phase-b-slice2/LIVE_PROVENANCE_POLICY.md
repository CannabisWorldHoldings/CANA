# Live provenance policy

Live provenance comes only from response bytes and headers observed during the bounded acquisition. Static fixture catalog dates are rejected by the live path. Missing `Last-Modified` remains `UNKNOWN`; it is never replaced with the fixture date or local clock.

Every admitted live capture binds fixed source URL, exact request contract digest, pre/post source revision, pre/post record count, response metadata, content SHA-256, adapter/parser/policy/court versions, repository commit/tree, tenant, and acquisition time. Revision or count drift quarantines the entire attempt.
