# Reality Cell 0001 Merchant Consent Requirements

Status: `AWAITING_MERCHANT_AUTHORIZATION`

A merchant authorization is admissible only when an authenticated authorized representative explicitly consents to all of the following:

1. The exact merchant legal entity, merchant ID, and tenant ID.
2. The exact Reality Cell experiment ID and preregistration digest.
3. The exact treatment candidate, action contract, and baseline digests.
4. The allowed private or public surface, effect set, start window, expiry, and maximum exposure.
5. The primary metric, guardrails, Goodhart failure mode, measurement plan, and claim ceiling.
6. The independent observer, rollback target, rollback trigger, and stop conditions.
7. The idempotency key and a clear revocation channel.

Consent must be explicit, time-bounded, challengeable, and preserved as canonical evidence. Silence, a database row, a public merchant website, prior outreach, or an employee email address does not count.

Until that evidence exists, CANA must fail closed with maximum exposure zero. It may prepare fixtures and isolated private previews, but it may not contact the merchant, expose customers, deploy, publish, mutate production, activate payments, or spend money.
