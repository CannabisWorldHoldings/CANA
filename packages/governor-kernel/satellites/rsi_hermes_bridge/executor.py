from __future__ import annotations
import datetime as dt
from dataclasses import asdict
from typing import Any

from rsi_sitemind_core.canonical import sha256_hex
from rsi_sitemind_core.models import ActionContract, AuthorizationGrant, ExecutionReceipt, WorkerCapability
from rsi_sitemind_core.governor import RSIGovernor
from rsi_sitemind_core.ledger import ReceiptLedger
from rsi_domain_connectors.base import Connector, ConnectorRequest

class GovernedExecutor:
    def __init__(self, governor: RSIGovernor, ledger: ReceiptLedger, connectors: dict[str, Connector]):
        self.governor=governor
        self.ledger=ledger
        self.connectors=connectors

    def execute(self, action: ActionContract, authorization: AuthorizationGrant,
                capability: WorkerCapability, payload: dict[str, Any], *,
                now: dt.datetime | None=None) -> dict[str, Any]:
        decision=self.governor.validate_action(
            action, authorization, capability, now=now,
            used_idempotency_keys=self.ledger.used_idempotency_keys,
        )
        if not decision.allowed:
            return {"status":"DENIED","reasons":list(decision.reasons)}
        connector=self.connectors.get(action.resource.split(":",1)[0])
        if connector is None:
            return {"status":"DENIED","reasons":["connector_unavailable"]}
        started=(now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
        result=connector.execute(ConnectorRequest(
            tenant_id=action.tenant_id, business_id=action.business_id, site_id=action.site_id,
            action_contract_id=action.action_contract_id, action_type=action.action_type,
            resource=action.resource, idempotency_key=action.idempotency_key, payload=payload,
        ))
        completed=dt.datetime.now(dt.timezone.utc)
        receipt=self.ledger.append(ExecutionReceipt(
            receipt_id=f"receipt-{action.action_contract_id}", tenant_id=action.tenant_id,
            business_id=action.business_id, site_id=action.site_id, mission_id=action.mission_id,
            action_contract_id=action.action_contract_id, idempotency_key=action.idempotency_key,
            status="SUCCEEDED" if result.succeeded else "FAILED",
            started_at=started.isoformat(), completed_at=completed.isoformat(),
            external_state_before_hash=sha256_hex(result.external_state_before),
            external_state_after_hash=sha256_hex(result.external_state_after),
            result_hash=sha256_hex(result.result), error_code=result.error_code,
        ))
        return {"status":receipt.status,"receipt":asdict(receipt),"result":result.result}
