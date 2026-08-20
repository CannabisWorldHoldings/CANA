#!/usr/bin/env python3
# tools/authority/gk_compat_bridge.py — PHASE E1 COMPAT PROOF (Python side).
#
# Runs a battery of containment attack vectors through the REAL governor-kernel decision function
# (packages/governor-kernel/standalone/runtime/rsi.py :: RSIGovernor.authorize_and_reserve) and emits,
# for each vector, the verdict: {"vector": name, "admitted": bool, "code": <GovernorDenied.code|None>}.
#
# The Node port (tools/authority/containment.mjs) runs the SAME vectors; gk-compat.test.mjs asserts
# the two verdict lists are identical (same accept/refuse, same CODE). This is the behavior-
# compatibility proof the owner mandated for the native port.
#
# Reads {"vectors":[...], "data_dir":...} on stdin; writes {"results":[...]} on stdout.

import json, sys, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]  # merge/
sys.path.insert(0, str(ROOT / "packages" / "governor-kernel" / "standalone"))

req = json.loads(sys.stdin.read())
data_dir = req["data_dir"]
os.environ["CANA_DATA"] = data_dir
os.environ["CANA_DB"] = str(pathlib.Path(data_dir) / "cana.db")

from runtime import db, rsi  # the REAL modules

db.DATA_DIR = pathlib.Path(data_dir)
db.DB_PATH = pathlib.Path(data_dir) / "cana.db"
db.EVIDENCE_DIR = db.DATA_DIR / "evidence"


def run_vector(v):
    """Set up a fresh DB per vector, seed auth+cap+budget from the vector, run one authorize."""
    # fresh data dir per vector for isolation
    vdir = pathlib.Path(data_dir) / v["name"]
    db.DATA_DIR = vdir
    db.DB_PATH = vdir / "cana.db"
    db.EVIDENCE_DIR = vdir / "evidence"
    db.init()
    con = db.connect()
    for name, lim in v.get("budgets", {}).items():
        con.execute("INSERT OR REPLACE INTO budgets(name,used,limit_) VALUES (?,?,?)", (name, 0, lim))
    con.commit()

    a = v["auth"]
    aid = rsi.issue_authorization(
        con, actor_id=a["actor_id"], tenant_id=a["tenant_id"], site_id=a["site_id"],
        allowed_actions=a["allowed_actions"], allowed_resources=a["allowed_resources"],
        financial_budget=a.get("financial_budget", 0.0), runtime_budget=a.get("runtime_budget", 1000.0),
        call_budget=a.get("call_budget", 1000), delegation_depth=a.get("delegation_depth", 2),
        ttl_seconds=a.get("ttl_seconds", 3600))
    c = v["cap"]
    cid = rsi.issue_capability(
        con, worker_id=c["worker_id"], authorization_id=aid,
        allowed_actions=c["allowed_actions"], allowed_resources=c["allowed_resources"],
        runtime_budget=c.get("runtime_budget", 100.0), call_budget=c.get("call_budget", 100),
        delegation_depth=c.get("delegation_depth", 0), ttl_seconds=c.get("ttl_seconds", 3600))
    con.commit()

    # optional pre-actions (revoke, prior identical contract for idempotency, etc.)
    for pre in v.get("pre", []):
        if pre["op"] == "revoke":
            rsi.revoke(con, pre["target_type"], aid if pre["target_id"] == "AUTH" else cid, pre.get("reason", ""))
            con.commit()
        elif pre["op"] == "authorize":
            # a prior successful authorize to arm idempotency; ignore its verdict
            _run_one(con, v, aid, cid, pre.get("contract", v["contract"]))

    return _run_one(con, v, aid, cid, v["contract"])


def _run_one(con, v, aid, cid, ct):
    G = rsi.RSIGovernor(con)
    contract = rsi.ActionContract(
        action_type=ct["action_type"], resource=ct["resource"],
        authorization_id=(aid if ct.get("authorization_id", "AUTH") == "AUTH" else ct.get("authorization_id")),
        worker_capability_id=(cid if ct.get("worker_capability_id", "CAP") == "CAP" else ct.get("worker_capability_id")),
        actor_id=ct.get("actor_id"), worker_id=ct.get("worker_id"),
        tenant_id=ct.get("tenant_id"), site_id=ct.get("site_id"),
        mission_id=ct.get("mission_id"), evidence_refs=ct.get("evidence_refs", []),
        rollback_contract=ct.get("rollback_contract", ""), budget=ct.get("budget"))
    contract.sign()
    try:
        res_ids = G.authorize_and_reserve(contract)
        con.commit()
        # FIX-2 (Court-07), exactly as the tournament-winning B bridge does (gk_bridge.py:129-137):
        # write the idempotency row ON ADMIT so replay is refused without waiting for a receipt. This
        # is the behavior the deployed winner exhibits (REPLAY_RESISTANCE=PROVEN), and it is the
        # semantics the Node port implements — so both engines arm idempotency identically here.
        if ct.get("mission_id"):
            key = f"{ct['action_type']}:{ct['resource']}:{ct['mission_id']}"
            try:
                con.execute("INSERT INTO idempotency(key,receipt_id,ts) VALUES (?,?,?)", (key, contract.id, db.now()))
                con.commit()
            except Exception:
                pass
        return {"admitted": True, "code": None}
    except rsi.GovernorDenied as e:
        con.rollback()
        return {"admitted": False, "code": e.code}


results = []
for v in req["vectors"]:
    try:
        r = run_vector(v)
    except Exception as e:  # noqa: BLE001
        r = {"admitted": False, "code": f"PY_ERROR:{type(e).__name__}:{e}"}
    r["vector"] = v["name"]
    results.append(r)

print(json.dumps({"results": results}))
