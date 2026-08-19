"""Durable store — Hardening V1.1.1 (SQLite, stdlib). Production target: PostgreSQL.

Schema v3 adds: signing metadata + canonical payload version on authorizations & capabilities;
key-rotation-safe signing metadata on contracts; durable provider_health (circuit breaker);
and an outbox for future exactly-once EXTERNAL effects.
"""
from __future__ import annotations
import os, sqlite3, pathlib, time

SCHEMA_VERSION = 3
DATA_DIR = pathlib.Path(os.environ.get("CANA_DATA", pathlib.Path(__file__).resolve().parent.parent / ".canadata"))
DB_PATH = pathlib.Path(os.environ.get("CANA_DB", DATA_DIR / "cana.db"))
EVIDENCE_DIR = DATA_DIR / "evidence"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS policy_versions (
  version INTEGER PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0, hash TEXT NOT NULL, created_ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS authorizations (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL,
  allowed_actions TEXT NOT NULL DEFAULT '[]', allowed_resources TEXT NOT NULL DEFAULT '[]',
  financial_budget REAL NOT NULL DEFAULT 0, runtime_budget REAL NOT NULL DEFAULT 0,
  call_budget INTEGER NOT NULL DEFAULT 0, delegation_depth INTEGER NOT NULL DEFAULT 1,
  policy_version INTEGER NOT NULL, issued_at TEXT NOT NULL, not_before TEXT, expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  signature TEXT NOT NULL, signing_key_id TEXT NOT NULL, signature_algorithm TEXT NOT NULL,
  signer_identity TEXT NOT NULL, canonical_payload_version TEXT NOT NULL DEFAULT 'v1');

CREATE TABLE IF NOT EXISTS worker_capabilities (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, authorization_id TEXT NOT NULL,
  allowed_actions TEXT NOT NULL DEFAULT '[]', allowed_resources TEXT NOT NULL DEFAULT '[]',
  runtime_budget REAL NOT NULL DEFAULT 0, call_budget INTEGER NOT NULL DEFAULT 0,
  delegation_depth INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL, expires_at TEXT,
  signature TEXT NOT NULL, signing_key_id TEXT NOT NULL, signature_algorithm TEXT NOT NULL,
  signer_identity TEXT NOT NULL, canonical_payload_version TEXT NOT NULL DEFAULT 'v1');

CREATE TABLE IF NOT EXISTS revocations (
  id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, action_type TEXT NOT NULL, resource TEXT NOT NULL,
  mission_id TEXT, authorization_id TEXT, actor_id TEXT, worker_id TEXT, worker_capability_id TEXT,
  tenant_id TEXT, site_id TEXT, policy_version INTEGER,
  issued_at TEXT, not_before TEXT, expires_at TEXT,
  evidence_refs TEXT NOT NULL DEFAULT '[]', rollback_contract TEXT, parent_receipt TEXT,
  budget TEXT NOT NULL DEFAULT '{}', cost REAL NOT NULL DEFAULT 0,
  contract_signature TEXT, contract_key_id TEXT, contract_signature_algorithm TEXT,
  contract_signer_identity TEXT, contract_payload_version TEXT DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'proposed', ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, action_type TEXT NOT NULL,
  before_hash TEXT, after_hash TEXT, result_hash TEXT,
  prev_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, signature TEXT NOT NULL,
  key_id TEXT NOT NULL, signature_algorithm TEXT NOT NULL, signer_identity TEXT NOT NULL,
  parent_receipt TEXT, status TEXT NOT NULL, error_code TEXT, seq INTEGER, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ledger_checkpoints (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL, receipt_hash TEXT NOT NULL, signature TEXT NOT NULL,
  key_id TEXT NOT NULL, ts TEXT NOT NULL, note TEXT);

CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS budgets (name TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, limit_ REAL NOT NULL);

CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
  contract_id TEXT, mission_id TEXT, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, opened_at REAL, updated_ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY, mission_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, attempt INTEGER NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL, actual_cost REAL, latency_ms INTEGER,
  result_state TEXT NOT NULL, reservation_id TEXT, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, intent TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  dispatch_state TEXT NOT NULL DEFAULT 'pending', provider_result TEXT, reconciliation_state TEXT NOT NULL DEFAULT 'unreconciled',
  receipt_id TEXT, created_ts TEXT NOT NULL, updated_ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, competitor TEXT NOT NULL, source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL, artifact_path TEXT NOT NULL, http_status INTEGER, capture_ok INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS change_events (
  id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, competitor TEXT NOT NULL, source_url TEXT NOT NULL,
  change_class TEXT NOT NULL, before_hash TEXT, after_hash TEXT NOT NULL,
  diff_summary TEXT NOT NULL DEFAULT '{}', likely_objective TEXT,
  signal_class TEXT NOT NULL DEFAULT 'experiment', confidence REAL NOT NULL DEFAULT 0.5,
  evidence_label TEXT NOT NULL DEFAULT 'HYPOTHESIS', copying_risk TEXT NOT NULL DEFAULT 'low',
  compliance_risk TEXT NOT NULL DEFAULT 'low', status TEXT NOT NULL DEFAULT 'captured');

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, change_event_id TEXT NOT NULL, klass TEXT NOT NULL,
  spec TEXT NOT NULL, score REAL NOT NULL DEFAULT 0, created_ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'queued', idempotency_key TEXT UNIQUE, checkpoint TEXT NOT NULL DEFAULT '{}',
  leased_by TEXT, lease_token_hash TEXT, lease_started_at TEXT, lease_expires_at TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 0, last_heartbeat_at TEXT, failure_reason TEXT,
  created_ts TEXT NOT NULL, updated_ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS side_effects (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE, payload TEXT, ts TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT NOT NULL, ts TEXT NOT NULL, note TEXT);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
  statement TEXT NOT NULL, pipeline_result TEXT NOT NULL, strategic_hypothesis TEXT,
  business_outcome TEXT NOT NULL DEFAULT 'UNKNOWN', evidence_class TEXT NOT NULL,
  verdict TEXT NOT NULL, experiment_ref TEXT, never_repeat INTEGER NOT NULL DEFAULT 0);
"""

def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH), timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA busy_timeout=8000;")
    con.execute("PRAGMA foreign_keys=ON;")
    return con

def init() -> None:
    con = connect()
    try:
        con.executescript(SCHEMA)
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        for name, lim in (("model_usd", 25.0), ("github_mutations", 50), ("api_calls", 10000), ("ad_usd", 0.0)):
            con.execute("INSERT OR IGNORE INTO budgets(name, used, limit_) VALUES (?,0,?)", (name, lim))
        if con.execute("SELECT COUNT(*) FROM policy_versions").fetchone()[0] == 0:
            con.execute("INSERT INTO policy_versions(version,active,hash,created_ts) VALUES (1,1,?,?)", ("genesis-policy", now()))
    finally:
        con.close()

def active_policy_version(con) -> int:
    r = con.execute("SELECT version FROM policy_versions WHERE active=1 ORDER BY version DESC LIMIT 1").fetchone()
    return r["version"] if r else 1

def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def ts_offset(seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + seconds))

def reset() -> None:
    import shutil
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
