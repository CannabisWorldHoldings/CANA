"""Mission queue — Hardening V1.1. Worker-bound leases with secret tokens, attempt tracking,
token-gated state changes, and idempotent side effects. Enables real crash recovery (P7).
"""
from __future__ import annotations
import uuid, json, hashlib, secrets, sqlite3
from . import db

class LeaseError(Exception): pass
class DuplicateCompletion(Exception): pass

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def create(con, kind: str, payload: dict, idempotency_key: str | None = None) -> dict:
    idempotency_key = idempotency_key or ("mk_" + uuid.uuid4().hex[:12])
    existing = con.execute("SELECT * FROM missions WHERE idempotency_key=?", (idempotency_key,)).fetchone()
    if existing:
        return dict(existing)
    mid = "msn_" + uuid.uuid4().hex[:12]
    con.execute("""INSERT INTO missions(id,kind,payload,state,idempotency_key,checkpoint,attempt_number,created_ts,updated_ts)
                   VALUES (?,?,?,?,?,?,0,?,?)""",
                (mid, kind, json.dumps(payload), "queued", idempotency_key, "{}", db.now(), db.now()))
    return {"id": mid, "kind": kind, "state": "queued", "idempotency_key": idempotency_key}

def lease(con, worker_id: str, lease_seconds: int = 120):
    """Atomically reclaim expired leases, then claim the oldest queued mission.
    Returns (mission_dict, lease_token) or (None, None). The token is shown ONCE."""
    now = db.now()
    con.execute("BEGIN IMMEDIATE")
    try:
        con.execute("UPDATE missions SET state='queued', leased_by=NULL, lease_token_hash=NULL "
                    "WHERE state='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?", (now,))
        row = con.execute("SELECT * FROM missions WHERE state='queued' ORDER BY created_ts ASC LIMIT 1").fetchone()
        if not row:
            con.execute("COMMIT"); return None, None
        token = secrets.token_hex(16)
        con.execute("""UPDATE missions SET state='leased', leased_by=?, lease_token_hash=?, lease_started_at=?,
                       lease_expires_at=?, attempt_number=attempt_number+1, last_heartbeat_at=?, updated_ts=?
                       WHERE id=? AND state='queued'""",
                    (worker_id, _hash(token), now, db.ts_offset(lease_seconds), now, now, row["id"]))
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK"); raise
    m = dict(con.execute("SELECT * FROM missions WHERE id=?", (row["id"],)).fetchone())
    return m, token

def _validate(con, mission_id, worker_id, token):
    m = con.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
    if not m:
        raise LeaseError("unknown mission")
    if m["state"] in ("done", "failed"):
        raise DuplicateCompletion(f"mission already terminal: {m['state']}")
    if m["leased_by"] != worker_id:
        raise LeaseError(f"wrong worker (leased_by={m['leased_by']}, got {worker_id})")
    if m["lease_expires_at"] and db.now() > m["lease_expires_at"]:
        raise LeaseError("lease expired")
    if m["lease_token_hash"] != _hash(token):
        raise LeaseError("invalid lease token (stale or reclaimed)")
    return m

def heartbeat_mission(con, mission_id, worker_id, token, extend_seconds: int | None = None):
    _validate(con, mission_id, worker_id, token)
    if extend_seconds:
        con.execute("UPDATE missions SET last_heartbeat_at=?, lease_expires_at=?, updated_ts=? WHERE id=?",
                    (db.now(), db.ts_offset(extend_seconds), db.now(), mission_id))
    else:
        con.execute("UPDATE missions SET last_heartbeat_at=?, updated_ts=? WHERE id=?", (db.now(), db.now(), mission_id))

def checkpoint(con, mission_id, worker_id, token, data: dict):
    _validate(con, mission_id, worker_id, token)
    con.execute("UPDATE missions SET checkpoint=?, last_heartbeat_at=?, updated_ts=? WHERE id=?",
                (json.dumps(data), db.now(), db.now(), mission_id))

def complete(con, mission_id, worker_id, token, state: str = "done"):
    _validate(con, mission_id, worker_id, token)
    con.execute("UPDATE missions SET state=?, updated_ts=? WHERE id=?", (state, db.now(), mission_id))

def fail(con, mission_id, worker_id, token, reason: str):
    _validate(con, mission_id, worker_id, token)
    con.execute("UPDATE missions SET state='failed', failure_reason=?, updated_ts=? WHERE id=?",
                (reason, db.now(), mission_id))

def record_side_effect(con, mission_id, kind, dedupe_key, payload=None) -> dict:
    """Idempotent, but ONLY the uniqueness violation is treated as a duplicate (Defect 5).
    Any other DB error propagates and must fail the mission — we never hide write failures as
    duplicates. NOTE: this proves exactly-once *recording inside SQLite*, not exactly-once
    external execution (that needs the outbox below)."""
    sid = "se_" + uuid.uuid4().hex[:10]
    body = json.dumps(payload) if payload is not None else None  # non-serializable payload raises here (propagates)
    try:
        con.execute("INSERT INTO side_effects(id,mission_id,kind,dedupe_key,payload,ts) VALUES (?,?,?,?,?,?)",
                    (sid, mission_id, kind, dedupe_key, body, db.now()))
        return {"created": True, "duplicate": False, "side_effect_id": sid}
    except sqlite3.IntegrityError:
        row = con.execute("SELECT id FROM side_effects WHERE dedupe_key=?", (dedupe_key,)).fetchone()
        return {"created": False, "duplicate": True, "existing_side_effect_id": row["id"] if row else None}

# ── Outbox for FUTURE exactly-once EXTERNAL effects (intent → dispatch → reconcile → receipt) ──
def outbox_intent(con, mission_id, intent, idempotency_key) -> dict:
    oid = "ob_" + uuid.uuid4().hex[:10]
    try:
        con.execute("""INSERT INTO outbox(id,mission_id,intent,idempotency_key,dispatch_state,reconciliation_state,created_ts,updated_ts)
                       VALUES (?,?,?,?,'pending','unreconciled',?,?)""", (oid, mission_id, intent, idempotency_key, db.now(), db.now()))
        return {"created": True, "outbox_id": oid, "duplicate": False}
    except sqlite3.IntegrityError:
        row = con.execute("SELECT id FROM outbox WHERE idempotency_key=?", (idempotency_key,)).fetchone()
        return {"created": False, "outbox_id": row["id"] if row else None, "duplicate": True}

def outbox_update(con, outbox_id, *, dispatch_state=None, provider_result=None, reconciliation_state=None, receipt_id=None):
    sets, args = [], []
    for col, val in (("dispatch_state", dispatch_state), ("provider_result", json.dumps(provider_result) if provider_result is not None else None),
                     ("reconciliation_state", reconciliation_state), ("receipt_id", receipt_id)):
        if val is not None:
            sets.append(f"{col}=?"); args.append(val)
    if not sets:
        return
    args += [db.now(), outbox_id]
    con.execute(f"UPDATE outbox SET {', '.join(sets)}, updated_ts=? WHERE id=?", args)

def get(con, mission_id):
    r = con.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone()
    return dict(r) if r else None

def heartbeat(con, worker: str, note: str = ""):
    con.execute("INSERT INTO heartbeats(worker,ts,note) VALUES (?,?,?)", (worker, db.now(), note))

def last_heartbeat(con, worker: str | None = None):
    q = "SELECT * FROM heartbeats"; args = ()
    if worker:
        q += " WHERE worker=?"; args = (worker,)
    q += " ORDER BY id DESC LIMIT 1"
    r = con.execute(q, args).fetchone()
    return dict(r) if r else None
