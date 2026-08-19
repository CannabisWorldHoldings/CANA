"""CANA OS runtime — executable core (RSI governance, shadow pipeline, missions, API).

Truth label: this package is IMPLEMENTED + TESTED + RUNNING in the local proof harness
(SQLite, stdlib only). Production targets (Postgres, live Hermes, hosted 24/7) are labeled
PLANNED/BLOCKED in CURRENT_STATE.md. No external dependencies — runs with python3 stdlib.
"""
__all__ = ["db", "rsi", "pipeline", "mission", "api"]
