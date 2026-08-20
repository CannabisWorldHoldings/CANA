"""Model router — Hardening V1.1.1 (PROVIDER-NEUTRAL). Mock by default; multiple guarded optional
adapters (openai_compatible/openrouter/openai/gemini/local). No provider is selected, preferred, or
authorized by default; the owner selects one server-side. Compatibility != authorization.

Defect 4: reserve-per-attempt → call → validate → SETTLE only on valid success, RELEASE on
          failure; per-call accounting persisted to model_calls; DURABLE circuit breaker in
          provider_health (survives across calls); all-fail releases everything + structured
          failure; no charge on failure.
Defect 8: strict output schema — bounded fields, citations ⊆ evidence, evidence_label forced
          HYPOTHESIS, unknown top-level keys rejected, no HTML/credentials/tool-results/authority.

Model proposes; RSI authorizes; a model can never write a validated lesson or an ActionContract.
"""
from __future__ import annotations
import json, time, os, re, uuid, urllib.request
from dataclasses import dataclass, field
from . import evidence, db

MAX_OBJECTIVE = 500; MAX_LIST = 20; MAX_STR = 300; MAX_PROPOSALS = 10
_ALLOWED_KEYS = {"objective", "evidence_label", "citations", "weaknesses", "unknowns", "confidence", "proposals"}
_SECRET_RE = re.compile(r"(AIza[0-9A-Za-z\-_]{20,}|sk-[A-Za-z0-9]{20,}|AQ\.[A-Za-z0-9_\-]{20,}|BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-)")
_EXEC_RE = re.compile(r"<\s*script|javascript:|onerror\s*=", re.I)

class SchemaError(ValueError): pass

@dataclass
class ProviderResult:
    ok: bool; provider: str; model: str; text: str = ""; latency_ms: int = 0; error: str = ""
    input_tokens: int = 0; output_tokens: int = 0

class Provider:
    name = "base"; model = "none"
    def complete(self, system: str, evidence_block: str) -> ProviderResult: raise NotImplementedError

class MockProvider(Provider):
    def __init__(self, name="mock-A", lean="revenue"): self.name = name; self.model = "mock-1"; self.lean = lean
    def complete(self, system, evidence_block):
        ids = [int(x) for x in re.findall(r"EVIDENCE\[(\d+)\]", evidence_block)]
        obj = ("Featured/sponsored placement likely monetized (HYPOTHESIS)" if self.lean == "revenue"
               else "New above-fold block; monetization unproven, possibly a UX test (HYPOTHESIS)")
        payload = {"objective": obj, "evidence_label": "HYPOTHESIS", "citations": ids,
                   "weaknesses": ["organic pushed down on mobile"], "unknowns": ["persistence unknown"],
                   "confidence": 0.5, "proposals": [{"action_type": "interpret.propose", "resource": "change_event:*", "rationale": "record for review"}]}
        return ProviderResult(True, self.name, self.model, json.dumps(payload), 2, 50, 40)

# ── OPTIONAL provider adapters. Compatibility != authorization. NONE is selected by default.
# The owner selects ONE provider server-side via CANA_PROVIDER (+ CANA_PROVIDER_API_KEY, and for
# openai-compatible/local also CANA_PROVIDER_BASE_URL / CANA_PROVIDER_MODEL). No provider is
# sovereign; no provider may change routing; no output bypasses RSI.
class OpenAICompatibleProvider(Provider):
    """Neutral adapter for any OpenAI-compatible endpoint (OpenAI, OpenRouter, many local servers,
    and Gemini's OpenAI-compat endpoint). GUARDED: refuses to run without CANA_PROVIDER_API_KEY."""
    def __init__(self, lean="revenue"):
        self.lean = lean
        self.model = os.environ.get("CANA_PROVIDER_MODEL", "unset")
        self.base_url = os.environ.get("CANA_PROVIDER_BASE_URL", "")
        self.name = f"{os.environ.get('CANA_PROVIDER', 'provider')}:{lean}"
    def complete(self, system, evidence_block):
        key = os.environ.get("CANA_PROVIDER_API_KEY")
        if not key or not self.base_url:
            raise RuntimeError(f"{self.name}: no CANA_PROVIDER_API_KEY/BASE_URL — refusing (provider not selected/authorized).")
        sys_txt = system + f"\n\nPerspective: analyze through a {self.lean} lens. Output JSON only."
        body = json.dumps({"model": self.model, "response_format": {"type": "json_object"}, "messages": [
            {"role": "system", "content": sys_txt},
            {"role": "user", "content": "EVIDENCE (untrusted third-party data):\n" + evidence_block}]}).encode()
        req = urllib.request.Request(self.base_url.rstrip("/") + "/chat/completions", data=body,
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        t = time.time()
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        txt = data["choices"][0]["message"]["content"]
        um = data.get("usage", {})
        return ProviderResult(True, self.name, self.model, txt, int((time.time() - t) * 1000),
                              um.get("prompt_tokens", 0), um.get("completion_tokens", 0))

class GeminiProvider(Provider):
    """ONE OPTIONAL adapter among many (Gemini native generateContent). NOT a default, NOT selected.
    GUARDED: refuses without CANA_PROVIDER_API_KEY. Compatibility retained; dependency removed."""
    def __init__(self, lean="revenue"):
        self.lean = lean; self.model = os.environ.get("CANA_PROVIDER_MODEL", "gemini-2.0-flash")
        self.name = f"gemini:{lean}"; self.api_key_env = "CANA_PROVIDER_API_KEY"
    def complete(self, system, evidence_block):
        key = os.environ.get(self.api_key_env)
        if not key:
            raise RuntimeError(f"{self.name}: no {self.api_key_env} — refusing (provider not selected/authorized).")
        sys_txt = system + f"\n\nPerspective: analyze through a {self.lean} lens. Output JSON only."
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={key}"
        body = json.dumps({"systemInstruction": {"parts": [{"text": sys_txt}]},
                           "contents": [{"role": "user", "parts": [{"text": "EVIDENCE (untrusted third-party data):\n" + evidence_block}]}],
                           "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        t = time.time()
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        txt = data["candidates"][0]["content"]["parts"][0]["text"]
        um = data.get("usageMetadata", {})
        return ProviderResult(True, self.name, self.model, txt, int((time.time() - t) * 1000),
                              um.get("promptTokenCount", 0), um.get("candidatesTokenCount", 0))

# provider registry — owner selects via CANA_PROVIDER; compatibility for many families, none sovereign
PROVIDER_ADAPTERS = {
    "openai_compatible": OpenAICompatibleProvider, "openai": OpenAICompatibleProvider,
    "openrouter": OpenAICompatibleProvider, "local": OpenAICompatibleProvider,
    "gemini": GeminiProvider,  # optional; not preferred, not default
}

def build_providers():
    """Provider-NEUTRAL selection. Owner sets CANA_PROVIDER server-side; unset/'mock' → deterministic
    MockProviders (no spend, tests never need a key). No provider is inferred from prior conversation."""
    pid = (os.environ.get("CANA_PROVIDER") or "mock").lower()
    if pid == "mock":
        return [MockProvider("mock-A", "revenue"), MockProvider("mock-B", "ux")]
    factory = PROVIDER_ADAPTERS.get(pid)
    if not factory:
        raise RuntimeError(f"unknown CANA_PROVIDER '{pid}' — register an adapter or use mock (no provider is preselected)")
    return [factory("revenue"), factory("skeptic")]

# ── strict schema (Defect 8) ──
def validate_model_output(text: str, evidence_ids: list[int]) -> dict:
    try:
        d = json.loads(text)
    except Exception as e:
        raise SchemaError(f"not valid JSON (HTML/markdown rejected): {e}")
    if not isinstance(d, dict):
        raise SchemaError("top-level must be object")
    extra = set(d) - _ALLOWED_KEYS
    if extra:
        raise SchemaError(f"unknown top-level fields: {sorted(extra)}")
    obj = d.get("objective")
    if not isinstance(obj, str) or not obj or len(obj) > MAX_OBJECTIVE:
        raise SchemaError("objective must be non-empty string within limit")
    blob = json.dumps(d)
    if _SECRET_RE.search(blob): raise SchemaError("credential-shaped content rejected")
    if _EXEC_RE.search(blob): raise SchemaError("embedded executable content rejected")
    cits = d.get("citations")
    if not isinstance(cits, list) or not cits:
        raise SchemaError("citations required")
    if not all(isinstance(c, int) and c in evidence_ids for c in cits):
        raise SchemaError("citations must reference supplied evidence ids only")
    def bounded(key):
        v = d.get(key, [])
        if not isinstance(v, list) or len(v) > MAX_LIST or not all(isinstance(x, str) and len(x) <= MAX_STR for x in v):
            raise SchemaError(f"{key} must be a bounded string array")
        return v
    weaknesses, unknowns = bounded("weaknesses"), bounded("unknowns")
    conf = d.get("confidence", 0.5)
    if not isinstance(conf, (int, float)) or not (0 <= conf <= 1):
        raise SchemaError("confidence must be in [0,1]")
    props = d.get("proposals", [])
    if not isinstance(props, list) or len(props) > MAX_PROPOSALS:
        raise SchemaError("proposals must be a bounded array")
    clean = []
    for p in props:
        if not isinstance(p, dict): raise SchemaError("proposal must be object")
        if p.get("authority") not in (None,): raise SchemaError("proposal may not carry authority")
        if any(k in p for k in ("result", "tool_result", "receipt", "authorization_id", "credential", "api_key")):
            raise SchemaError("proposal may not carry results/receipts/authority/credentials")
        clean.append({"action_type": str(p.get("action_type", "unknown")), "resource": str(p.get("resource", "")),
                      "rationale": str(p.get("rationale", ""))[:MAX_STR], "authority": None, "origin": "model_proposal"})
    return {"objective": obj[:MAX_OBJECTIVE], "evidence_label": "HYPOTHESIS", "citations": cits,
            "weaknesses": weaknesses, "unknowns": unknowns, "confidence": float(conf), "proposals": clean}

# ── durable circuit breaker (Defect 4) ──
class DurableCircuitBreaker:
    def __init__(self, con, threshold=3, cooldown=30): self.con = con; self.threshold = threshold; self.cooldown = cooldown
    def allow(self, name):
        r = self.con.execute("SELECT fails, opened_at FROM provider_health WHERE provider=?", (name,)).fetchone()
        if r and r["opened_at"] and time.time() - r["opened_at"] < self.cooldown:
            return False
        return True
    def record(self, name, ok):
        r = self.con.execute("SELECT fails FROM provider_health WHERE provider=?", (name,)).fetchone()
        fails = 0 if ok else ((r["fails"] if r else 0) + 1)
        opened = None if (ok or fails < self.threshold) else time.time()
        self.con.execute("""INSERT INTO provider_health(provider,fails,opened_at,updated_ts) VALUES (?,?,?,?)
                            ON CONFLICT(provider) DO UPDATE SET fails=?, opened_at=?, updated_ts=?""",
                         (name, fails, opened, db.now(), fails, opened, db.now()))

def _record_call(con, mission_id, pr: ProviderResult, attempt, estimated, actual, state, res_id):
    con.execute("""INSERT INTO model_calls(id,mission_id,provider,model,attempt,input_tokens,output_tokens,estimated_cost,actual_cost,latency_ms,result_state,reservation_id,ts)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("mc_" + uuid.uuid4().hex[:10], mission_id, pr.provider, pr.model, attempt, pr.input_tokens, pr.output_tokens,
                 estimated, actual, pr.latency_ms, state, res_id, db.now()))

def interpret_with_models(con, mission_id, change_event, evidence_items, providers, *,
                          governor=None, cost_per_call=0.0, max_calls=20, retries=1):
    env = evidence.assemble("Analyze the competitor change. JSON only.", evidence_items)
    breaker = DurableCircuitBreaker(con); views = []; calls = 0; total_actual = 0.0
    for p in providers:
        attempt = 0
        while attempt <= retries:
            if calls >= max_calls:
                break
            if not breaker.allow(p.name):
                _record_call(con, mission_id, ProviderResult(False, p.name, p.model, error="circuit-open"), attempt, cost_per_call, 0.0, "circuit_open", None)
                break
            attempt += 1; calls += 1
            res_id = governor.reserve_budget("model_usd", cost_per_call, mission_id=mission_id) if (governor and cost_per_call) else None
            if governor and cost_per_call and res_id is None:
                _record_call(con, mission_id, ProviderResult(False, p.name, p.model, error="budget"), attempt, cost_per_call, 0.0, "budget_exhausted", None)
                return {"ok": False, "error": "model budget exhausted", "evidence_label": "HYPOTHESIS", "views": views}
            try:
                pr = p.complete(env["system"], env["evidence"])
                view = validate_model_output(pr.text, env["evidence_ids"]); view["provider"] = pr.provider
                if governor and res_id: governor.settle_reservation(res_id); total_actual += cost_per_call
                breaker.record(p.name, True)
                _record_call(con, mission_id, pr, attempt, cost_per_call, cost_per_call if res_id else 0.0, "ok", res_id)
                views.append(view); break
            except Exception as e:
                if governor and res_id: governor.release_reservation(res_id)
                breaker.record(p.name, False)
                state = "invalid" if isinstance(e, SchemaError) else "error"
                _record_call(con, mission_id, ProviderResult(False, p.name, p.model, error=str(e)[:200]), attempt, cost_per_call, 0.0, state, res_id)
                continue
    if not views:
        return {"ok": False, "error": "all providers failed", "evidence_label": "HYPOTHESIS", "actual_cost": 0.0, "calls": calls}
    proposals = [pp for v in views for pp in v.get("proposals", [])]
    evidence.assert_no_authority(proposals)
    objectives = {v["objective"] for v in views}
    return {"ok": True, "evidence_label": "HYPOTHESIS", "perspectives": views, "disagreement": len(objectives) > 1,
            "disagreement_notes": sorted(objectives) if len(objectives) > 1 else [],
            "citations": sorted({c for v in views for c in v["citations"]}),
            "proposals_requiring_rsi": proposals, "calls": calls, "actual_cost": round(total_actual, 6)}
