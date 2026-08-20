"""Secret protection (Defect 10). Scans tracked files for credential-shaped strings and refuses
startup if any are found. .env / keys / .canadata / *.db are gitignored and skipped.
Placeholders in .env.example (empty values) never match.
"""
from __future__ import annotations
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET_RE = re.compile(r"(AIza[0-9A-Za-z\-_]{20,}|sk-[A-Za-z0-9]{20,}|AQ\.[A-Za-z0-9_\-]{20,}"
                       r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9\-]{10,}|ghp_[A-Za-z0-9]{30,})")
SKIP_DIRS = {".git", ".canadata", "node_modules", "__pycache__", "keys", "proofs"}
SKIP_EXT = {".pyc", ".png", ".jpg", ".jpeg", ".gif", ".zip", ".db", ".sqlite", ".key"}

def scan_tracked(root: pathlib.Path = ROOT) -> list[dict]:
    findings = []
    for p in root.rglob("*"):
        if p.is_dir() or any(part in SKIP_DIRS for part in p.relative_to(root).parts): continue
        if p.suffix in SKIP_EXT or p.name in (".env",): continue
        try:
            text = p.read_text(errors="strict")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            m = SECRET_RE.search(line)
            if m:
                findings.append({"file": str(p.relative_to(root)), "line": i, "match_prefix": m.group()[:6] + "…"})
    return findings

def guard(root: pathlib.Path = ROOT) -> None:
    f = scan_tracked(root)
    if f:
        raise RuntimeError(f"REFUSING START: {len(f)} credential-shaped string(s) in tracked files: {f}")

if __name__ == "__main__":
    import sys, json
    f = scan_tracked()
    print(json.dumps({"clean": not f, "findings": f}, indent=2))
    sys.exit(1 if f else 0)
