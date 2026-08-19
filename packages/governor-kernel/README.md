# governor-kernel — extracted RSI authorization kernel

Stdlib-first authorization, receipt-ledger, and promotion-court machinery extracted from the
owner's RSI archive set (`ALL_THE_RSI_AND_ORDERWEEDDC_REPOS`, 2026-08-18) into the canonical
CANA repository as a reusable package. Extraction preserves the source code byte-for-byte
except where noted; no behavioral changes were made.

## Layout

- `sitemind-core/` — `rsi_sitemind_core` package: `governor.py` (pure-function validator,
  25+ checks over signed ActionContract + AuthorizationGrant + WorkerCapability),
  `ledger.py` (hash-chained receipt ledger with replay verifier), `promotion.py`
  (no-skip PROPOSED→VALIDATED→SHADOW→CANARY→PROMOTED court), `models.py`, `crypto.py`,
  `canonical.py`, `onboarding.py`, `management.py`, `coevolution.py`, plus its 3 original
  test modules and `run_attack_court.py` (19 named adversarial attacks).
  Dependencies: `cryptography`, `jsonschema` (tests run on Python 3.9 despite the
  original `requires-python >=3.11` declaration — see receipts).
- `standalone/` — the ORDERWEEDDCRSI stdlib-only reimplementation: `runtime/rsi.py`
  (governor+ledger+promotion in one 368-line module, zero third-party deps),
  `model_router.py` (LLM-output validator rejecting HTML, credential-shaped strings,
  tool results, and authority-carrying keys), `secrets_guard.py`, `pipeline.py`
  (HTML normalize/diff/ChangeEvent), `db.py`, `mission.py`, `evidence.py`, `api.py`,
  `worker_proc.py`, plus its original 35-test suite.
- `satellites/` — thin support packages required only by the attack court
  (`rsi_domain_connectors` mock CMS connector, `rsi_hermes_bridge` governed executor).
- `receipts/` — real command output from the local runs in this environment, each bound
  to base commit `3a340f3a4c2ab28a5b85bb1a91845932b74c8b05`.

## Verified locally (receipts in ./receipts/)

- `sitemind-core`: `pytest tests/ -q` → **17 passed** (exit 0)
- `standalone`: `python3 -m unittest discover -s tests` → **35 tests, OK** (exit 0)
- attack court: `run_attack_court.py` → **19/19 passed** (exit 0)

## Provenance

- `rsi-sitemind-core` from `RSI-main` (upstream pin: `princeleuel1-ops/RSI` @
  `a6410cdca2450b8bf176009673928735e4b821e7`, recorded 2026-07-23).
- `runtime/` from `ORDERWEEDDCRSI--main` (same pin lineage; proofs directory in the
  archive showed 45/45 attack court and full unittest passes).
- Protected RSI source identity remains **NOT ESTABLISHED** per the archive's own
  `SOURCE_IDENTITY.md`; this package does not claim otherwise.

## Known limits (honest state)

- Signing trust is DEV_TAMPER_EVIDENT (local HMAC). The KMS `Signer` interface exists
  but is not wired. Do not treat receipt chains as forgery-proof against a privileged
  local process.
- All mutation connectors are mock/simulated. Nothing here can touch production, spend,
  or contact external systems.
- This package is not yet wired into CANA_LOOP_ENGINE or the alive-loop substrate;
  integration is a separate, owner-gated step.
