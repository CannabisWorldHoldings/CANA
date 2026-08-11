# Acquisition write/read map

| Mechanism | Writes | Reads | Authority |
|---|---|---|---|
| Live adapter | none | fixed ABCA metadata/count/records | sensing only |
| Acquisition repository | content artifact, acquisition/capability/circuit events | prior source content and circuit head | no truth |
| Compiler | observations, resolutions, UNKNOWN claims | admitted `CHANGED` acquisition | no public truth |
| Verification Court | append-only verification event | exact artifact, acquisition, claim, evidence, identity, revocation | predicate-scoped eligibility |
| Compatibility projection | Retailer and GeoClaim truth envelope | latest admitted court cohort | public only for current complete cohort |
| ASK frontier | signal, Opportunity, bounded continuation | current public projection | demand chooses work; never truth |
