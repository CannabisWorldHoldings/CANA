"""Subprocess worker for the crash-recovery harness (P7). Two phases:
  hang    — lease a mission, do step 1 (idempotent side effect), checkpoint, then hang (simulate crash)
  recover — reclaim the expired mission, retry step 1 (must dedupe), do step 2, one receipt, complete
Run: python3 -m runtime.worker_proc <hang|recover> --auth <id> --cap <id>
"""
import sys, os, time, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from runtime import db, rsi, mission  # noqa

WORKER = "crash-worker"

def _opt(args, name):
    return args[args.index(name) + 1]

def main():
    args = sys.argv[1:]; mode = args[0]
    auth = _opt(args, "--auth"); cap = _opt(args, "--cap")
    db.init(); con = db.connect()
    if mode == "hang":
        m, token = mission.lease(con, WORKER, lease_seconds=2)
        mission.record_side_effect(con, m["id"], "step", f"{m['id']}:step1", {"step": 1})
        mission.checkpoint(con, m["id"], WORKER, token, {"step": 1})
        print(f"LEASED {m['id']} attempt={m['attempt_number']}", flush=True)
        time.sleep(120)  # hang until SIGKILL
    elif mode == "recover":
        m, token = mission.lease(con, WORKER, lease_seconds=60)
        _ = json.loads(mission.get(con, m["id"])["checkpoint"] or "{}")
        again = mission.record_side_effect(con, m["id"], "step", f"{m['id']}:step1", {"step": 1})["duplicate"]  # expect True (dedup)
        mission.record_side_effect(con, m["id"], "step", f"{m['id']}:step2", {"step": 2})
        c = rsi.ActionContract(action_type="db.write", resource=f"mission:{m['id']}", mission_id=m["id"],
            authorization_id=auth, actor_id="owner", worker_id=WORKER, worker_capability_id=cap,
            tenant_id="cana", site_id="orderweeddc", policy_version=db.active_policy_version(con),
            evidence_refs=["checkpoint"], rollback_contract="noop", budget={}).sign()
        rsi.RSIGovernor(con).authorize_and_reserve(c)
        rsi.ReceiptLedger(con).append(c, status="ok", result={"recovered": True})
        mission.complete(con, m["id"], WORKER, token, "done")
        print(f"RECOVERED {m['id']} step1_dedup={again} attempt={m['attempt_number']}", flush=True)
    con.close()

if __name__ == "__main__":
    main()
