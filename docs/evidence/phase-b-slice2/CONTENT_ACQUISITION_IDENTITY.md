# Content and acquisition identity

`MarketSourceContentArtifact` identifies canonical bytes by source and SHA-256. `MarketSourceAcquisitionEvent` identifies the act of observation, with attempt, event chain, time, revision, count, contract, versions, and terminal outcome.

Identical bytes reuse one content artifact but append a distinct acquisition receipt. No acquisition time is written into the immutable content object. An `UNCHANGED` event can support only an independent zero-change re-attestation of predicates already proven by the same exact artifact and policy.

Current-truth admission reloads the immutable `MarketSourceSnapshot` and requires its source, URL, SHA-256, byte count, record count, schema version, completeness, and ID to match the content artifact and acquisition lineage exactly. A syntactically valid or correctly referenced artifact cannot authorize truth when any underlying snapshot identity field differs.
