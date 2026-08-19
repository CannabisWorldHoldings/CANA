from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Protocol

@dataclass(frozen=True)
class ConnectorRequest:
    tenant_id: str
    business_id: str
    site_id: str
    action_contract_id: str
    action_type: str
    resource: str
    idempotency_key: str
    payload: dict[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class ConnectorResult:
    succeeded: bool
    external_state_before: dict[str, Any]
    external_state_after: dict[str, Any]
    result: dict[str, Any]
    reversible: bool
    error_code: str = ""

class Connector(Protocol):
    def execute(self, request: ConnectorRequest) -> ConnectorResult: ...
