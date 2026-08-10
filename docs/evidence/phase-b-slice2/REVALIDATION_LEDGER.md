# Revalidation ledger

Freshness debt creates or reuses one tenant/claim work key, one `FRESHNESS_DEBT` Opportunity, one OBSERVE_ONLY mission, and one bounded `REVALIDATION` trigger. The trigger carries the claim, predicate, work key, required complete acquisition state, and `REFLECTION_ONLY` loop mode.

A continuation tick only appends eligibility/firing receipts. It cannot call the live adapter or mark a claim verified. The owner-run acquisition and separate Reality Court are the only current verifier path. Repeated court use of one acquisition is idempotent; a later acquisition may append a later court event.
