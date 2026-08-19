"""Hermes plugin adapter.

Production wiring injects an RSI API client. This module intentionally does not load
customer credentials or implement an authority bypass.
"""
import json

_executor = None

def configure(executor):
    global _executor
    _executor = executor

VALIDATE_SCHEMA = {
    "name":"rsi_validate_action_contract",
    "description":"Validate a signed RSI action contract without executing it.",
    "parameters":{"type":"object","properties":{"contract":{"type":"object"}},"required":["contract"]},
}
EXECUTE_SCHEMA = {
    "name":"rsi_execute_authorized_action",
    "description":"Submit signed RSI authorization, worker capability, and action contract to the RSI governor.",
    "parameters":{"type":"object","properties":{
        "authorization":{"type":"object"},"capability":{"type":"object"},
        "contract":{"type":"object"},"payload":{"type":"object"}},
        "required":["authorization","capability","contract","payload"]},
}

def _not_configured():
    return json.dumps({"status":"DENIED","reasons":["rsi_bridge_not_configured"]})

def validate_handler(args, **kwargs):
    if _executor is None: return _not_configured()
    return json.dumps({"status":"STAGED","message":"Use RSI governor API for typed validation."})

def execute_handler(args, **kwargs):
    if _executor is None: return _not_configured()
    return json.dumps({"status":"DENIED","reasons":["typed_deserialization_required"]})

def register(ctx):
    ctx.register_tool(name="rsi_validate_action_contract", toolset="rsi", schema=VALIDATE_SCHEMA, handler=validate_handler)
    ctx.register_tool(name="rsi_execute_authorized_action", toolset="rsi", schema=EXECUTE_SCHEMA, handler=execute_handler)
