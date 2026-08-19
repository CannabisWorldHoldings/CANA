from __future__ import annotations
from copy import deepcopy
from .base import ConnectorRequest, ConnectorResult

class InMemoryCMSConnector:
    """Safe fixture connector. It creates drafts only and rejects publication."""
    def __init__(self):
        self._state: dict[str, dict] = {}
        self._seen: set[str] = set()

    def execute(self, request: ConnectorRequest) -> ConnectorResult:
        before = deepcopy(self._state)
        if request.idempotency_key in self._seen:
            return ConnectorResult(False, before, deepcopy(self._state), {}, True, "IDEMPOTENCY_REPLAY")
        if request.action_type != "publish_cms_draft":
            return ConnectorResult(False, before, deepcopy(self._state), {}, True, "ACTION_NOT_SUPPORTED")
        if not request.resource.endswith("/drafts"):
            return ConnectorResult(False, before, deepcopy(self._state), {}, True, "RESOURCE_NOT_ALLOWED")
        draft_id = f"draft-{len(self._state)+1}"
        self._state[draft_id] = {
            "tenant_id": request.tenant_id,
            "site_id": request.site_id,
            "content": request.payload.get("content", ""),
            "status": "DRAFT",
        }
        self._seen.add(request.idempotency_key)
        return ConnectorResult(True, before, deepcopy(self._state), {"draft_id": draft_id}, True)
