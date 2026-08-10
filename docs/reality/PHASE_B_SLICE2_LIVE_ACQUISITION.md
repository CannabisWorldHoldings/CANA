# Phase B Slice 2 live acquisition contract

## Scope

Slice 2 admits one operator-invoked, read-only acquisition from DCGIS ArcGIS layer 31 for the DC Alcoholic Beverage and Cannabis Administration licensed medical cannabis retailer listing. It adds no production scheduler, generic crawler, credential handling, payment, outreach, deployment, or automatic promotion.

## Fixed request and budgets

The adapter pins HTTPS hostname/path/layer/query, explicit fields, `OBJECTID` ordering, maximum 500 records, 2 MiB per response, 4 MiB per run, 10 second connect, 15 second body, and 30 second run budgets. It refuses CI, proxy variables, redirects, credentials, request overrides, non-public DNS/IP results, invalid content types, invalid JSON, schema drift, duplicates, partial transfer, revision drift, count drift, and time ambiguity.

## Provenance and truth

One stable capture creates or reuses immutable content bytes and appends an acquisition receipt. `SOURCE_CHANGED` can enter the tenant compiler; `SOURCE_UNCHANGED` cannot compile and may only enter independent zero-change revalidation. Acquisition never equals verification. Parser claims remain UNKNOWN until the court replays exact bytes, evidence linkage, identity, predicate authority, freshness, contradiction, and revocation state.

## Freshness, revocation, and demand

Current eligibility uses `verified_at <= as_of < min(acquired_at + 30 days, license_expiration)`. Freshness debt may schedule bounded OBSERVE_ONLY work, but a continuation tick does not fetch or verify. Evidence revocation is append-only and demotes only its derived blast radius.

ASK persists a privacy-safe, tenant-scoped Answerability Frontier. One subject must satisfy every required current predicate. Demand can deduplicate and prioritize verification work; it cannot create a claim, source authority, or economic value.

## Rollback

Application rollback stops use of the new maintenance command and projections; it never deletes evidence or runs inverse production DDL. Database rollback follows the owner-gated provider backup/restore process. No production migration or rollback is authorized by this contract.
