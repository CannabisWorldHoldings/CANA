# Evidence revocation policy

Revocation is an append-only `MarketEvidenceRevocationEvent` with target, cause, actor kind, effective time, lineage references, prior hash, and event hash. It can quarantine or revoke an acquisition, content artifact, snapshot, observation, parser version, or policy version.

Blast radius is derived through evidence joins to claims, verification events, public projections, and gaps. Affected claims receive new non-eligible `REFUTED` versions and DENY events; projections are demoted safely. Nothing is deleted and no replacement truth is fabricated. A later restore is another append-only event and still requires fresh court evidence.
