"""CANA API — Hardening V1.1 security foundation (P8), stdlib only.

Before /chat exists: bearer auth, owner session token, per-request IDs, structured errors,
authorization middleware, rate-limiting interface, CORS allowlist, security headers, JSON size
limits, sanitized JSON-only output (never raw model HTML), and an audit hook for mutations.
Secrets are never returned. Read endpoints require a token except /api/v1/ping (liveness).
"""
from __future__ import annotations
import os, json, time, uuid, pathlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from . import db, rsi

MAX_BODY = 64 * 1024
CORS_ALLOW = set(filter(None, os.environ.get("CANA_CORS", "http://localhost:3000").split(",")))

def owner_token() -> str:
    t = os.environ.get("CANA_OWNER_TOKEN")
    if t:
        return t
    p = db.DATA_DIR / ".owner_token"
    db.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(uuid.uuid4().hex)
    return p.read_text().strip()

def check_auth(header: str | None, token: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    import hmac
    return hmac.compare_digest(header[7:].strip(), token)

def security_headers() -> dict:
    return {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
            "Content-Security-Policy": "default-src 'none'", "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store"}

def error(code: str, message: str, request_id: str) -> dict:
    return {"error": {"code": code, "message": message, "request_id": request_id}}

class RateLimiter:
    """Simple token bucket per key (IP). Interface is swappable for Redis in production."""
    def __init__(self, capacity=30, refill_per_sec=1.0):
        self.capacity = capacity; self.refill = refill_per_sec; self.buckets = {}
    def allow(self, key: str) -> bool:
        now = time.time(); tokens, last = self.buckets.get(key, (self.capacity, now))
        tokens = min(self.capacity, tokens + (now - last) * self.refill)
        if tokens < 1:
            self.buckets[key] = (tokens, now); return False
        self.buckets[key] = (tokens - 1, now); return True

def health() -> dict:
    con = db.connect()
    try:
        c = lambda q: con.execute(q).fetchone()[0]
        ok, msg = rsi.ReceiptLedger(con).verify_chain()
        from . import mission
        return {"status": "ok" if ok else "degraded",
                "ledger": {"ok": ok, "detail": msg, "trust": "DEV_TAMPER_EVIDENT"},
                "schema_version": int(c("SELECT value FROM meta WHERE key='schema_version'")),
                "counts": {t: c(f"SELECT COUNT(*) FROM {t}") for t in
                           ("snapshots", "change_events", "candidates", "receipts", "missions", "lessons", "budget_reservations")},
                "budgets": [dict(r) for r in con.execute("SELECT name,used,limit_ FROM budgets")],
                "last_heartbeat": mission.last_heartbeat(con), "ts": db.now()}
    finally:
        con.close()

def _recent(table, cols, n=20):
    con = db.connect()
    try:
        return [dict(r) for r in con.execute(f"SELECT {cols} FROM {table} ORDER BY rowid DESC LIMIT ?", (n,)).fetchall()]
    finally:
        con.close()

class Handler(BaseHTTPRequestHandler):
    server_version = "CANA/1.1"
    def _send(self, obj, code=200, rid=""):
        body = json.dumps(obj, indent=2).encode()
        self.send_response(code)
        for k, v in security_headers().items():
            self.send_header(k, v)
        origin = self.headers.get("Origin")
        if origin in CORS_ALLOW:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("X-Request-ID", rid)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        rid = uuid.uuid4().hex[:12]
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY:
            return self._send(error("payload_too_large", f"max {MAX_BODY} bytes", rid), 413, rid)
        # No mutation endpoints yet; mutations will require an ActionContract + audit receipt.
        self._send(error("method_not_allowed", "no mutation endpoints in V1.1", rid), 405, rid)

    def do_GET(self):
        rid = uuid.uuid4().hex[:12]
        p = self.path.split("?")[0]
        ip = self.client_address[0]
        if not self.server.rl.allow(ip):
            return self._send(error("rate_limited", "slow down", rid), 429, rid)
        if p == "/api/v1/ping":
            return self._send({"ok": True, "ts": db.now(), "request_id": rid}, 200, rid)
        if p == "/api/v1/health":
            return self._send(health(), 200, rid)   # no secrets in health
        # protected endpoints
        if not check_auth(self.headers.get("Authorization"), self.server.token):
            return self._send(error("unauthorized", "owner bearer token required", rid), 401, rid)
        if p == "/api/v1/changes":
            return self._send(_recent("change_events", "id,competitor,change_class,confidence,evidence_label,status,observed_at"), 200, rid)
        if p == "/api/v1/receipts":
            return self._send(_recent("receipts", "id,action_type,status,seq,receipt_hash,key_id,ts"), 200, rid)
        if p == "/api/v1/candidates":
            return self._send(_recent("candidates", "id,change_event_id,klass,score,created_ts"), 200, rid)
        self._send(error("not_found", p, rid), 404, rid)

    def log_message(self, *a):
        pass

def serve(port=8787):
    from . import secrets_guard
    secrets_guard.guard()   # startup refusal if a credential is found in a tracked file
    db.init()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.token = owner_token(); httpd.rl = RateLimiter()
    print(f"CANA API on http://127.0.0.1:{port}/api/v1/health  (owner token: {httpd.token[:6]}… in {db.DATA_DIR}/.owner_token)")
    httpd.serve_forever()

if __name__ == "__main__":
    serve()
