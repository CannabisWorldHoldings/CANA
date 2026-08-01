# @orderweeddc/ad-creative

Provider-pluggable ad-creative engine for merchant marketing.

## Pipeline (order is law)

1. **Analyze** — the provider's vision model audits the business logo
   (palette, typography, iconography, tone, do-not-alter elements,
   minors-appeal risk). Generation before brand analysis is forbidden.
2. **Brief** — one deterministic brief per VERIFIED_CURRENT product:
   every advertisement features a different verified product. Compliance
   text (21+ marker, license line, "Sponsored" label) lives in a
   deterministic overlay, never in-image.
3. **Authorize** — the paid provider verifies an expiring Ed25519-signed,
   request-bound CANA paid-governance receipt. The receipt binds tenant,
   model, operation, and a total cost reservation. Missing, altered, expired,
   or underfunded receipts fail before network transport.
   The pre-transport estimate includes documented image output, text/image
   input, and a bounded text/reasoning output reserve. The signed reservation
   must cover that estimate. It remains an owner-authorized ceiling rather
   than a claim that Google enforces a billing cap; provider usage and invoice
   settlement are still required before any grant balance is updated.
4. **Generate** — via the pluggable provider. Default: configured Gemini
   `FAST_IMAGE_ITERATOR`; model IDs live in `model-registry.mjs`.
5. **Inspect** — a separately authorized vision provider re-analyzes the ACTUAL generated image
   (minors appeal, health-claim imagery, rendered text, brand match).
6. **Verify** — provider separation requires its own expiring,
   Ed25519-signed CANA independent-verification receipt. The same provider
   family cannot verify itself. The eight-check machine PASS is necessary but never
   sufficient: `assertPostable` additionally requires a named human
   approval. The pipeline has no posting capability at all.

## Credentials

Developer API credentials use server-side `GEMINI_API_KEY`; Vertex uses a
server-side access-token provider. The public website never receives either.
`CANA_PAID_GOVERNANCE_PUBLIC_KEY` verifies authorization receipts but cannot
issue them. Secrets are never placed in URLs, source, receipts, or logs.
Tests use generated one-run Ed25519 keys, mock providers, and injected fetch;
no test touches the network.

The Developer adapter uses the `/v1` GenerateContent contract with
`generationConfig.responseFormat.image`. Vertex uses its documented
`responseModalities: ["TEXT", "IMAGE"]` plus `imageConfig` contract. Supported
size identifiers are `512`, `1K`, `2K`, and `4K`. Provider responses are
streamed through bounded parsing before JSON decoding. Paid receipts are
attempt-scoped and intentionally consumed before transport; any retry requires
a new owner-authorized receipt.

## Run tests

```
npm test -w packages/ad-creative
```
