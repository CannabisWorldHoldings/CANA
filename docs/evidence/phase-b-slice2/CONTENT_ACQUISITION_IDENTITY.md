# Content and acquisition identity

`MarketSourceContentArtifact` identifies canonical bytes by source and SHA-256. `MarketSourceAcquisitionEvent` identifies the act of observation, with attempt, event chain, time, revision, count, contract, versions, and terminal outcome.

Identical bytes reuse one content artifact but append a distinct acquisition receipt. No acquisition time is written into the immutable content object. An `UNCHANGED` event can support only an independent zero-change re-attestation of predicates already proven by the same exact artifact and policy.
