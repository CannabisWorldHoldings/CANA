"""RSI governance plane — Hardening V1.1.1.

Defect 1: GovernorDenied carries an exact CODE; every check maps to one.
Defect 2: authorizations & capabilities are signature-VERIFIED on every authorize; capability
          constraints must be a subset of the parent authorization.
Defect 3: contract signatures verify against the KEY THAT SIGNED THEM (rotation-safe).

Signing is DEV_TAMPER_EVIDENT (local HMAC). A production Signer (KMS/HSM + witness) plugs into
the same interface to reach PRODUCTION_IMMUTABLE.
"""
from __future__ import annotations
import os, json, hmac, hashlib, uuid
from dataclasses import dataclass, field
from . import db

AUTH_PV = "v1"; CAP_PV = "v1"; CONTRACT_PV = "v1"

def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)

def sha(obj) -> str:
    return hashlib.sha256(canonical(obj).encode()).hexdigest()

class Signer:
    key_id: str; algorithm: str; identity: str
    def sign(self, msg: str) -> str: raise NotImplementedError
    def verify(self, msg: str, sig: str, key_id: str) -> bool: raise NotImplementedError

class DevFileSigner(Signer):
    algorithm = "HMAC-SHA256"; identity = "dev-file-signer"; trust_label = "DEV_TAMPER_EVIDENT"
    def __init__(self):
        self.dir = db.DATA_DIR / "keys"; self.dir.mkdir(parents=True, exist_ok=True)
        cur = self.dir / "CURRENT"
        if not cur.exists(): self._new_key()
        self.key_id = cur.read_text().strip()
    def _new_key(self):
        kid = "k_" + uuid.uuid4().hex[:10]
        (self.dir / f"{kid}.key").write_bytes(os.urandom(32)); (self.dir / "CURRENT").write_text(kid)
        self.key_id = kid; return kid
    def rotate(self): return self._new_key()
    def _key(self, kid): return (self.dir / f"{kid}.key").read_bytes()
    def sign(self, msg): return hmac.new(self._key(self.key_id), msg.encode(), hashlib.sha256).hexdigest()
    def verify(self, msg, sig, key_id):
        p = self.dir / f"{key_id}.key"
        if not p.exists(): return False
        return hmac.compare_digest(hmac.new(p.read_bytes(), msg.encode(), hashlib.sha256).hexdigest(), sig)

_SIGNER: Signer | None = None
def signer() -> Signer:
    global _SIGNER
    if _SIGNER is None: _SIGNER = DevFileSigner()
    return _SIGNER

class GovernorDenied(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code; self.detail = detail
        super().__init__(f"{code}: {detail}")

# ── matchers ──
def _action_ok(a, allowed): return "*" in allowed or a in allowed
def _resource_ok(r, allowed):
    for p in allowed:
        if p == "*" or p == r or (p.endswith("*") and r.startswith(p[:-1])): return True
    return False
def _covers(parent_patterns, child_pattern):
    for p in parent_patterns:
        if p == "*" or p == child_pattern: return True
        if p.endswith("*") and child_pattern.startswith(p[:-1]): return True
    return False

# ── canonical payloads (all authority-defining fields) ──
def _auth_payload(d: dict) -> dict:
    # Coerce numeric types so canonical form is identical whether values came from kwargs (int)
    # or from SQLite REAL columns (float). Without this, 600 vs 600.0 would break every signature.
    return {"v": AUTH_PV, "id": d["id"], "actor_id": d["actor_id"], "tenant_id": d["tenant_id"],
            "site_id": d["site_id"], "allowed_actions": list(d["allowed_actions"]), "allowed_resources": list(d["allowed_resources"]),
            "financial_budget": float(d["financial_budget"]), "runtime_budget": float(d["runtime_budget"]),
            "call_budget": int(d["call_budget"]), "delegation_depth": int(d["delegation_depth"]),
            "policy_version": int(d["policy_version"]), "issued_at": d["issued_at"],
            "not_before": d["not_before"], "expires_at": d["expires_at"]}

def _cap_payload(d: dict) -> dict:
    return {"v": CAP_PV, "id": d["id"], "worker_id": d["worker_id"], "authorization_id": d["authorization_id"],
            "allowed_actions": list(d["allowed_actions"]), "allowed_resources": list(d["allowed_resources"]),
            "runtime_budget": float(d["runtime_budget"]), "call_budget": int(d["call_budget"]),
            "delegation_depth": int(d["delegation_depth"]), "issued_at": d["issued_at"], "expires_at": d["expires_at"]}

def issue_authorization(con, *, actor_id, tenant_id, site_id, allowed_actions, allowed_resources,
                        financial_budget=0.0, runtime_budget=0.0, call_budget=0, delegation_depth=1, ttl_seconds=3600) -> str:
    s = signer(); aid = "auth_" + uuid.uuid4().hex[:12]
    d = dict(id=aid, actor_id=actor_id, tenant_id=tenant_id, site_id=site_id,
             allowed_actions=allowed_actions, allowed_resources=allowed_resources,
             financial_budget=financial_budget, runtime_budget=runtime_budget, call_budget=call_budget,
             delegation_depth=delegation_depth, policy_version=db.active_policy_version(con),
             issued_at=db.now(), not_before=db.now(), expires_at=db.ts_offset(ttl_seconds))
    sig = s.sign(canonical(_auth_payload(d)))
    con.execute("""INSERT INTO authorizations(id,actor_id,tenant_id,site_id,allowed_actions,allowed_resources,
        financial_budget,runtime_budget,call_budget,delegation_depth,policy_version,issued_at,not_before,expires_at,
        revoked,signature,signing_key_id,signature_algorithm,signer_identity,canonical_payload_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)""",
        (aid, actor_id, tenant_id, site_id, canonical(allowed_actions), canonical(allowed_resources),
         financial_budget, runtime_budget, call_budget, delegation_depth, d["policy_version"], d["issued_at"],
         d["not_before"], d["expires_at"], sig, s.key_id, s.algorithm, s.identity, AUTH_PV))
    return aid

def issue_capability(con, *, worker_id, authorization_id, allowed_actions, allowed_resources,
                     runtime_budget=0.0, call_budget=0, delegation_depth=0, ttl_seconds=3600) -> str:
    s = signer(); cid = "cap_" + uuid.uuid4().hex[:12]
    d = dict(id=cid, worker_id=worker_id, authorization_id=authorization_id, allowed_actions=allowed_actions,
             allowed_resources=allowed_resources, runtime_budget=runtime_budget, call_budget=call_budget,
             delegation_depth=delegation_depth, issued_at=db.now(), expires_at=db.ts_offset(ttl_seconds))
    sig = s.sign(canonical(_cap_payload(d)))
    con.execute("""INSERT INTO worker_capabilities(id,worker_id,authorization_id,allowed_actions,allowed_resources,
        runtime_budget,call_budget,delegation_depth,revoked,issued_at,expires_at,
        signature,signing_key_id,signature_algorithm,signer_identity,canonical_payload_version)
        VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)""",
        (cid, worker_id, authorization_id, canonical(allowed_actions), canonical(allowed_resources),
         runtime_budget, call_budget, delegation_depth, d["issued_at"], d["expires_at"],
         sig, s.key_id, s.algorithm, s.identity, CAP_PV))
    return cid

def revoke(con, target_type, target_id, reason=""):
    con.execute("INSERT INTO revocations(id,target_type,target_id,reason,ts) VALUES (?,?,?,?,?)",
                ("rev_" + uuid.uuid4().hex[:10], target_type, target_id, reason, db.now()))
    table = {"authorization": "authorizations", "capability": "worker_capabilities"}.get(target_type)
    if table: con.execute(f"UPDATE {table} SET revoked=1 WHERE id=?", (target_id,))

def _auth_row_payload(r):
    return _auth_payload({"id": r["id"], "actor_id": r["actor_id"], "tenant_id": r["tenant_id"], "site_id": r["site_id"],
        "allowed_actions": json.loads(r["allowed_actions"]), "allowed_resources": json.loads(r["allowed_resources"]),
        "financial_budget": r["financial_budget"], "runtime_budget": r["runtime_budget"], "call_budget": r["call_budget"],
        "delegation_depth": r["delegation_depth"], "policy_version": r["policy_version"], "issued_at": r["issued_at"],
        "not_before": r["not_before"], "expires_at": r["expires_at"]})

def _cap_row_payload(r):
    return _cap_payload({"id": r["id"], "worker_id": r["worker_id"], "authorization_id": r["authorization_id"],
        "allowed_actions": json.loads(r["allowed_actions"]), "allowed_resources": json.loads(r["allowed_resources"]),
        "runtime_budget": r["runtime_budget"], "call_budget": r["call_budget"], "delegation_depth": r["delegation_depth"],
        "issued_at": r["issued_at"], "expires_at": r["expires_at"]})


@dataclass
class ActionContract:
    action_type: str
    resource: str
    mission_id: str | None = None
    authorization_id: str | None = None
    actor_id: str | None = None
    worker_id: str | None = None
    worker_capability_id: str | None = None
    tenant_id: str | None = None
    site_id: str | None = None
    policy_version: int | None = None
    evidence_refs: list = field(default_factory=list)
    preconditions: list = field(default_factory=list)
    postconditions: list = field(default_factory=list)
    expected_result: str | None = None
    side_effects: list = field(default_factory=list)
    rollback_contract: str | None = None
    parent_receipt: str | None = None
    budget: dict = field(default_factory=dict)
    cost: float = 0.0
    not_before: str | None = None
    expires_at: str | None = None
    id: str = field(default_factory=lambda: "act_" + uuid.uuid4().hex[:12])
    contract_signature: str | None = None
    contract_key_id: str | None = None
    contract_signature_algorithm: str | None = None
    contract_signer_identity: str | None = None
    contract_payload_version: str = CONTRACT_PV

    CONSEQUENTIAL = {"github.branch", "github.commit", "github.pr", "site.publish", "site.draft",
                     "flag.set", "campaign.spend", "model.config", "db.write", "interpret.publish"}

    def is_consequential(self): return self.action_type in self.CONSEQUENTIAL
    def _core(self):
        return {"v": self.contract_payload_version, **{k: getattr(self, k) for k in
                ("action_type", "resource", "mission_id", "authorization_id", "actor_id", "worker_id",
                 "worker_capability_id", "tenant_id", "site_id", "policy_version", "evidence_refs",
                 "rollback_contract", "budget", "id")}}
    def sign(self):
        s = signer()
        self.contract_key_id = s.key_id; self.contract_signature_algorithm = s.algorithm
        self.contract_signer_identity = s.identity
        self.contract_signature = s.sign(canonical(self._core()))
        return self


class RSIGovernor:
    def __init__(self, con): self.con = con
    def _revoked(self, t, i):
        return self.con.execute("SELECT 1 FROM revocations WHERE target_type=? AND target_id=? LIMIT 1", (t, i)).fetchone() is not None

    def authorize_and_reserve(self, c: ActionContract) -> list[str]:
        now = db.now(); s = signer()
        self.con.execute("BEGIN IMMEDIATE")
        try:
            # (3) contract signature — verify against the key that SIGNED it (rotation-safe)
            if not c.contract_signature or not c.contract_key_id or \
               not s.verify(canonical(c._core()), c.contract_signature, c.contract_key_id):
                raise GovernorDenied("INVALID_CONTRACT_SIGNATURE", "contract signature invalid/absent")
            # policy
            apv = db.active_policy_version(self.con)
            if c.policy_version is not None and c.policy_version != apv:
                raise GovernorDenied("STALE_POLICY", f"{c.policy_version} != active {apv}")
            # authorization
            if not c.authorization_id: raise GovernorDenied("UNKNOWN_AUTHORIZATION", "missing authorization_id")
            auth = self.con.execute("SELECT * FROM authorizations WHERE id=?", (c.authorization_id,)).fetchone()
            if not auth: raise GovernorDenied("UNKNOWN_AUTHORIZATION", c.authorization_id)
            if not s.verify(canonical(_auth_row_payload(auth)), auth["signature"], auth["signing_key_id"]):
                raise GovernorDenied("INVALID_AUTHORIZATION_SIGNATURE", "authorization tampered")
            if auth["revoked"] or self._revoked("authorization", auth["id"]):
                raise GovernorDenied("AUTHORIZATION_REVOKED", auth["id"])
            if auth["not_before"] and now < auth["not_before"]:
                raise GovernorDenied("AUTHORIZATION_NOT_YET_VALID", auth["not_before"])
            if auth["expires_at"] and now > auth["expires_at"]:
                raise GovernorDenied("AUTHORIZATION_EXPIRED", auth["expires_at"])
            # capability
            if not c.worker_capability_id: raise GovernorDenied("UNKNOWN_CAPABILITY", "missing worker_capability_id")
            cap = self.con.execute("SELECT * FROM worker_capabilities WHERE id=?", (c.worker_capability_id,)).fetchone()
            if not cap: raise GovernorDenied("UNKNOWN_CAPABILITY", c.worker_capability_id)
            if not s.verify(canonical(_cap_row_payload(cap)), cap["signature"], cap["signing_key_id"]):
                raise GovernorDenied("INVALID_CAPABILITY_SIGNATURE", "capability tampered")
            if cap["revoked"] or self._revoked("capability", cap["id"]):
                raise GovernorDenied("CAPABILITY_REVOKED", cap["id"])
            if cap["authorization_id"] != auth["id"]:
                raise GovernorDenied("CAPABILITY_BINDING", "capability not bound to authorization")
            if cap["expires_at"] and now > cap["expires_at"]:
                raise GovernorDenied("CAPABILITY_EXPIRED", cap["expires_at"])
            # capability constraints ⊆ authorization
            aa, ar = json.loads(auth["allowed_actions"]), json.loads(auth["allowed_resources"])
            ca, cr = json.loads(cap["allowed_actions"]), json.loads(cap["allowed_resources"])
            if "*" not in aa and not set(ca).issubset(set(aa)):
                raise GovernorDenied("CAPABILITY_EXCEEDS_AUTHORIZATION", "actions exceed authorization")
            if "*" not in ar and not all(_covers(ar, p) for p in cr):
                raise GovernorDenied("CAPABILITY_EXCEEDS_AUTHORIZATION", "resources exceed authorization")
            if cap["call_budget"] > auth["call_budget"] or cap["runtime_budget"] > auth["runtime_budget"] \
               or cap["delegation_depth"] > auth["delegation_depth"]:
                raise GovernorDenied("CAPABILITY_EXCEEDS_AUTHORIZATION", "budgets/depth exceed authorization")
            # identity
            if c.actor_id and c.actor_id != auth["actor_id"]: raise GovernorDenied("IDENTITY_MISMATCH", "actor")
            if c.tenant_id and c.tenant_id != auth["tenant_id"]: raise GovernorDenied("CROSS_TENANT", c.tenant_id)
            if c.site_id and c.site_id != auth["site_id"]: raise GovernorDenied("CROSS_SITE", c.site_id)
            if c.worker_id and c.worker_id != cap["worker_id"]: raise GovernorDenied("IDENTITY_MISMATCH", "worker")
            # action + resource (must pass BOTH auth and cap)
            if not (_action_ok(c.action_type, aa) and _action_ok(c.action_type, ca)):
                raise GovernorDenied("ACTION_NOT_ALLOWED", c.action_type)
            if not (_resource_ok(c.resource, ar) and _resource_ok(c.resource, cr)):
                raise GovernorDenied("RESOURCE_NOT_ALLOWED", c.resource)
            # contract time window
            if c.not_before and now < c.not_before: raise GovernorDenied("CONTRACT_NOT_YET_VALID", c.not_before)
            if c.expires_at and now > c.expires_at: raise GovernorDenied("CONTRACT_EXPIRED", c.expires_at)
            # consequential requirements
            if c.is_consequential() and not (c.rollback_contract and c.rollback_contract.strip()):
                raise GovernorDenied("MISSING_ROLLBACK", c.action_type)
            if c.is_consequential() and not c.evidence_refs:
                raise GovernorDenied("MISSING_EVIDENCE", c.action_type)
            # idempotency
            if c.mission_id:
                key = f"{c.action_type}:{c.resource}:{c.mission_id}"
                if self.con.execute("SELECT 1 FROM idempotency WHERE key=?", (key,)).fetchone():
                    raise GovernorDenied("IDEMPOTENCY_REPLAY", key)
            # budget (atomic reservation)
            res_ids = []
            for name, amount in (c.budget or {}).items():
                b = self.con.execute("SELECT used, limit_ FROM budgets WHERE name=?", (name,)).fetchone()
                if b is None: raise GovernorDenied("UNKNOWN_BUDGET", name)
                reserved = self.con.execute("SELECT COALESCE(SUM(amount),0) s FROM budget_reservations WHERE name=? AND state='reserved'", (name,)).fetchone()["s"]
                if amount > b["limit_"] - b["used"] - reserved + 1e-9:
                    raise GovernorDenied("BUDGET_EXCEEDED", f"{name}: need {amount}, remaining {b['limit_'] - b['used'] - reserved}")
                rid = "res_" + uuid.uuid4().hex[:12]
                self.con.execute("INSERT INTO budget_reservations(id,name,amount,state,contract_id,mission_id,ts) VALUES (?,?,?,'reserved',?,?,?)",
                                 (rid, name, amount, c.id, c.mission_id, now)); res_ids.append(rid)
            self.con.execute("""INSERT OR REPLACE INTO contracts(id,action_type,resource,mission_id,authorization_id,actor_id,worker_id,worker_capability_id,tenant_id,site_id,policy_version,issued_at,not_before,expires_at,evidence_refs,rollback_contract,parent_receipt,budget,cost,contract_signature,contract_key_id,contract_signature_algorithm,contract_signer_identity,contract_payload_version,status,ts)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c.id, c.action_type, c.resource, c.mission_id, c.authorization_id, c.actor_id, c.worker_id,
                 c.worker_capability_id, c.tenant_id, c.site_id, c.policy_version, now, c.not_before, c.expires_at,
                 canonical(c.evidence_refs), c.rollback_contract, c.parent_receipt, canonical(c.budget), c.cost,
                 c.contract_signature, c.contract_key_id, c.contract_signature_algorithm, c.contract_signer_identity,
                 c.contract_payload_version, "authorized", now))
            self.con.execute("COMMIT"); return res_ids
        except Exception:
            self.con.execute("ROLLBACK"); raise

    def reserve_budget(self, name, amount, *, contract_id=None, mission_id=None):
        self.con.execute("BEGIN IMMEDIATE")
        try:
            b = self.con.execute("SELECT used, limit_ FROM budgets WHERE name=?", (name,)).fetchone()
            if b is None: self.con.execute("ROLLBACK"); raise GovernorDenied("UNKNOWN_BUDGET", name)
            reserved = self.con.execute("SELECT COALESCE(SUM(amount),0) s FROM budget_reservations WHERE name=? AND state='reserved'", (name,)).fetchone()["s"]
            if amount > b["limit_"] - b["used"] - reserved + 1e-9:
                self.con.execute("COMMIT"); return None
            rid = "res_" + uuid.uuid4().hex[:12]
            self.con.execute("INSERT INTO budget_reservations(id,name,amount,state,contract_id,mission_id,ts) VALUES (?,?,?,'reserved',?,?,?)",
                             (rid, name, amount, contract_id, mission_id, db.now()))
            self.con.execute("COMMIT"); return rid
        except GovernorDenied: raise
        except Exception:
            self.con.execute("ROLLBACK"); raise

    def settle_reservation(self, rid):
        self.con.execute("BEGIN IMMEDIATE")
        try:
            r = self.con.execute("SELECT * FROM budget_reservations WHERE id=? AND state='reserved'", (rid,)).fetchone()
            if r:
                self.con.execute("UPDATE budget_reservations SET state='settled' WHERE id=?", (rid,))
                self.con.execute("UPDATE budgets SET used = used + ? WHERE name=?", (r["amount"], r["name"]))
            self.con.execute("COMMIT")
        except Exception:
            self.con.execute("ROLLBACK"); raise

    def release_reservation(self, rid):
        self.con.execute("UPDATE budget_reservations SET state='released' WHERE id=? AND state='reserved'", (rid,))


class ReceiptLedger:
    GENESIS = "0" * 64
    def __init__(self, con): self.con = con
    def _last(self): return self.con.execute("SELECT receipt_hash, seq FROM receipts ORDER BY seq DESC LIMIT 1").fetchone()
    def append(self, contract, *, status, before=None, after=None, result=None, error_code=None, parent_receipt=None):
        s = signer(); last = self._last()
        prev = last["receipt_hash"] if last else self.GENESIS
        seq = (last["seq"] + 1) if last else 1
        body = {"id": "rcpt_" + uuid.uuid4().hex[:12], "contract_id": contract.id, "action_type": contract.action_type,
                "before_hash": sha(before) if before is not None else None, "after_hash": sha(after) if after is not None else None,
                "result_hash": sha(result) if result is not None else None, "status": status, "error_code": error_code,
                "seq": seq, "ts": db.now(), "parent_receipt": parent_receipt}
        rh = hashlib.sha256((canonical(body) + prev).encode()).hexdigest(); sig = s.sign(rh)
        self.con.execute("""INSERT INTO receipts(id,contract_id,action_type,before_hash,after_hash,result_hash,prev_hash,receipt_hash,signature,key_id,signature_algorithm,signer_identity,parent_receipt,status,error_code,seq,ts)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (body["id"], body["contract_id"], body["action_type"], body["before_hash"], body["after_hash"], body["result_hash"],
             prev, rh, sig, s.key_id, s.algorithm, s.identity, parent_receipt, status, error_code, seq, body["ts"]))
        if contract.mission_id:
            self.con.execute("INSERT OR IGNORE INTO idempotency(key,receipt_id,ts) VALUES (?,?,?)",
                             (f"{contract.action_type}:{contract.resource}:{contract.mission_id}", body["id"], body["ts"]))
        body.update(prev_hash=prev, receipt_hash=rh, signature=sig, key_id=s.key_id); return body
    def verify_chain(self):
        rows = self.con.execute("SELECT * FROM receipts ORDER BY seq ASC").fetchall(); prev = self.GENESIS; s = signer()
        for r in rows:
            body = {"id": r["id"], "contract_id": r["contract_id"], "action_type": r["action_type"],
                    "before_hash": r["before_hash"], "after_hash": r["after_hash"], "result_hash": r["result_hash"],
                    "status": r["status"], "error_code": r["error_code"], "seq": r["seq"], "ts": r["ts"], "parent_receipt": r["parent_receipt"]}
            if hashlib.sha256((canonical(body) + prev).encode()).hexdigest() != r["receipt_hash"]:
                return False, f"hash break at seq {r['seq']}"
            if not s.verify(r["receipt_hash"], r["signature"], r["key_id"]):
                return False, f"signature invalid at seq {r['seq']}"
            if r["prev_hash"] != prev: return False, f"chain link broken at seq {r['seq']}"
            prev = r["receipt_hash"]
        return True, f"ok ({len(rows)} receipts)"
    def checkpoint(self, note=""):
        last = self._last()
        if not last: return {"seq": 0, "note": "empty"}
        s = signer()
        cp = {"id": "cp_" + uuid.uuid4().hex[:10], "seq": last["seq"], "receipt_hash": last["receipt_hash"],
              "signature": s.sign(last["receipt_hash"]), "key_id": s.key_id, "ts": db.now(), "note": note}
        self.con.execute("INSERT INTO ledger_checkpoints(id,seq,receipt_hash,signature,key_id,ts,note) VALUES (?,?,?,?,?,?,?)",
                         (cp["id"], cp["seq"], cp["receipt_hash"], cp["signature"], cp["key_id"], cp["ts"], note))
        return cp


class PromotionCourt:
    ORDER = ["proposed", "validated", "shadow", "canary", "limited", "broad", "promoted"]
    TERMINAL = {"rejected", "rolled_back"}
    @classmethod
    def can_advance(cls, frm, to):
        if to in cls.TERMINAL: return True
        if frm not in cls.ORDER or to not in cls.ORDER: return False
        return cls.ORDER.index(to) == cls.ORDER.index(frm) + 1
