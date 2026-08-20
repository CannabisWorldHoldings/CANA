"""Shadow → Diff → ChangeEvent → Interpret → 100X Foundry — executable pipeline.

Truth labels:
  • capture / normalize / diff / change_event : IMPLEMENTED + TESTED (deterministic, stdlib difflib)
  • interpret : IMPLEMENTED as RULE-BASED v0 (labels output HYPOTHESIS). LLM-enriched multi-
                perspective interpretation is PLANNED (needs model router + keys).
  • foundry   : IMPLEMENTED as TEMPLATE generator producing 7 scored candidates with all
                required fields. LLM-enriched generation is PLANNED.
Competitor inputs here are SYNTHETIC fixtures (we author them) — deterministic and respecting
the anti-copy law (we model the mechanism, never copy real competitor expression).
"""
from __future__ import annotations
import re, uuid, difflib, hashlib, shutil, pathlib, json
from . import db, rsi

# ── noise filters: things that change every load but mean nothing ──
_NOISE = [
    (re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\S*"), "<ts>"),
    (re.compile(r"\b\d{10,13}\b"), "<epoch>"),
    (re.compile(r'(csrf|nonce|session|token)=[A-Za-z0-9._\-]+', re.I), r"\1=<x>"),
    (re.compile(r'data-reactid="[^"]*"'), 'data-reactid="<x>"'),
    (re.compile(r'id="[A-Za-z]+-[0-9a-f]{6,}"'), 'id="<x>"'),
    (re.compile(r"\s+"), " "),
]

def normalize(html: str) -> str:
    s = html
    for pat, repl in _NOISE:
        s = pat.sub(repl, s)
    return s.strip()

def content_hash(html: str) -> str:
    return hashlib.sha256(html.encode()).hexdigest()

def capture(con, path: str, competitor: str, source_url: str, http_status: int = 200) -> dict:
    raw = pathlib.Path(path).read_text()
    h = content_hash(raw)
    artifact = db.EVIDENCE_DIR / f"{h}.html"
    db.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    if not artifact.exists():
        shutil.copyfile(path, artifact)
    sid = "snap_" + uuid.uuid4().hex[:12]
    with con:
        con.execute("INSERT INTO snapshots(id,captured_at,competitor,source_url,content_hash,artifact_path,http_status,capture_ok) VALUES (?,?,?,?,?,?,?,1)",
                    (sid, db.now(), competitor, source_url, h, str(artifact), http_status))
    return {"snapshot_id": sid, "content_hash": h, "artifact": str(artifact), "raw": raw}

_CLASS = [
    (re.compile(r"carousel|featured|sponsor|promoted|deal", re.I), "placement"),
    (re.compile(r"\$\d|price|percent|% off|discount", re.I), "pricing"),
    (re.compile(r"<nav|menu|navigation", re.I), "navigation"),
    (re.compile(r"schema\.org|application/ld\+json", re.I), "seo"),
    (re.compile(r"checkout|cart|signup|register", re.I), "checkout"),
]

def _classify(added_text: str) -> str:
    for pat, cls in _CLASS:
        if pat.search(added_text):
            return cls
    return "content"

def diff(before_html: str, after_html: str) -> dict:
    nb, na = normalize(before_html), normalize(after_html)
    if nb == na:
        return {"meaningful": False, "reason": "only-noise-changed", "added": [], "removed": []}
    b_lines = re.split(r"(?<=>)\s*", before_html)
    a_lines = re.split(r"(?<=>)\s*", after_html)
    sm = difflib.SequenceMatcher(a=[normalize(x) for x in b_lines], b=[normalize(x) for x in a_lines])
    added, removed = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("insert", "replace"):
            added += [a_lines[j].strip() for j in range(j1, j2) if a_lines[j].strip()]
        if tag in ("delete", "replace"):
            removed += [b_lines[i].strip() for i in range(i1, i2) if b_lines[i].strip()]
    added = [x for x in added if normalize(x)]
    removed = [x for x in removed if normalize(x)]
    return {"meaningful": bool(added or removed), "added": added, "removed": removed,
            "ratio": round(sm.ratio(), 3)}

def make_change_event(con, competitor, source_url, before_snap, after_snap, d: dict) -> dict:
    added_text = " ".join(d.get("added", []))
    cls = _classify(added_text)
    # confidence: single observation of a new element = low-to-moderate, honest
    conf = 0.55 if d.get("added") else 0.4
    cid = "chg_" + uuid.uuid4().hex[:12]
    row = {
        "id": cid, "observed_at": db.now(), "competitor": competitor, "source_url": source_url,
        "change_class": cls, "before_hash": before_snap["content_hash"], "after_hash": after_snap["content_hash"],
        "diff_summary": rsi.canonical({"added": d.get("added", []), "removed": d.get("removed", []), "ratio": d.get("ratio")}),
        "signal_class": "experiment", "confidence": conf, "evidence_label": "HYPOTHESIS",
        "copying_risk": "low", "compliance_risk": "low", "status": "captured",
    }
    with con:
        con.execute("""INSERT INTO change_events(id,observed_at,competitor,source_url,change_class,before_hash,after_hash,diff_summary,likely_objective,signal_class,confidence,evidence_label,copying_risk,compliance_risk,status)
                       VALUES (:id,:observed_at,:competitor,:source_url,:change_class,:before_hash,:after_hash,:diff_summary,NULL,:signal_class,:confidence,:evidence_label,:copying_risk,:compliance_risk,:status)""", row)
    return row

# ── rule-based interpreter v0 (HYPOTHESIS-labeled) ──
def interpret(con, change_event: dict) -> dict:
    d = json.loads(change_event["diff_summary"])
    added = " ".join(d.get("added", [])).lower()
    cls = change_event["change_class"]
    objective = {
        "placement": "Monetize attention by selling promoted placement above organic results (HYPOTHESIS)",
        "pricing": "Test price framing / discount mechanics to lift conversion (HYPOTHESIS)",
        "navigation": "Reduce discovery friction / steer traffic to high-value pages (HYPOTHESIS)",
        "seo": "Expand indexable surface / structured data for search visibility (HYPOTHESIS)",
        "checkout": "Reduce conversion-flow friction (HYPOTHESIS)",
        "content": "Content or messaging adjustment (HYPOTHESIS)",
    }.get(cls, "Unclear (HYPOTHESIS)")
    weaknesses = []
    if "carousel" in added or "featured" in added:
        weaknesses += ["Pushes organic results below the fold on mobile (trust cost)",
                       "No neighborhood relevance if shown market-wide",
                       "No measured-lift proof offered to paying merchants"]
    if "%" in added or "off" in added or "$" in added:
        weaknesses += ["Discount framing without scarcity honesty can erode trust"]
    if not weaknesses:
        weaknesses = ["Implementation depth unknown — needs another observation to confirm persistence"]
    # multi-perspective stub (deterministic); real disagreement analysis is PLANNED via model router
    perspectives = {
        "revenue": objective,
        "seo": "Check for new schema / internal links accompanying the change (HYPOTHESIS)",
        "cro": "Watch for bounce/scroll-depth impact of new above-fold element (HYPOTHESIS)",
        "design": "Assess clutter vs. clarity; does it fail a taste review? (HYPOTHESIS)",
    }
    with con:
        con.execute("UPDATE change_events SET likely_objective=?, status='interpreted' WHERE id=?",
                    (objective, change_event["id"]))
    return {"objective": objective, "weaknesses": weaknesses, "perspectives": perspectives,
            "evidence_label": "HYPOTHESIS"}

# ── 100X foundry: 7 templated, scored candidates ──
FOUNDRY_CLASSES = ["fast", "superior", "category_defining", "asymmetric", "monetization", "ecosystem", "preemptive"]

def foundry(con, change_event: dict, interp: dict) -> list[dict]:
    cls = change_event["change_class"]
    base_problem = interp["objective"]
    weights = {"revenue": 0.3, "evidence": 0.2, "differentiation": 0.2, "reversibility": 0.15, "cost": 0.15}
    out = []
    for k in FOUNDRY_CLASSES:
        # deterministic heuristic scores in [0,1]; real scoring evolves from closed experiments (PLANNED)
        s = {
            "fast": dict(revenue=.4, evidence=.7, differentiation=.3, reversibility=.9, cost=.9),
            "superior": dict(revenue=.7, evidence=.6, differentiation=.7, reversibility=.7, cost=.5),
            "category_defining": dict(revenue=.9, evidence=.4, differentiation=.95, reversibility=.5, cost=.2),
            "asymmetric": dict(revenue=.6, evidence=.5, differentiation=.9, reversibility=.7, cost=.5),
            "monetization": dict(revenue=.95, evidence=.5, differentiation=.6, reversibility=.6, cost=.5),
            "ecosystem": dict(revenue=.8, evidence=.4, differentiation=.85, reversibility=.5, cost=.3),
            "preemptive": dict(revenue=.7, evidence=.3, differentiation=.9, reversibility=.6, cost=.4),
        }[k]
        score = round(sum(weights[w] * s[w] for w in weights), 3)
        spec = {
            "class": k, "problem": base_problem, "change_class": cls,
            "winning_mechanism": f"Solve the underlying {cls} job better than the competitor's surface feature",
            "revenue_hypothesis": "REQUIRED — states mechanism + measurable proxy (populated by builder)",
            "primary_metric": {"placement": "deal CTR", "pricing": "conversion rate", "seo": "indexed-query growth"}.get(cls, "engagement"),
            "guardrails": ["bounce rate", "page speed"], "rollback_threshold": "primary metric regresses vs control",
            "taste_required": ">=7 on every canon axis", "compliance": "no regulated claims without human gate",
            "reversibility": s["reversibility"], "differentiators": ["neighborhood relevance", "measured-lift receipts", "faster mobile"],
            "evidence_label": "HYPOTHESIS",
        }
        cand_id = "cand_" + uuid.uuid4().hex[:12]
        with con:
            con.execute("INSERT INTO candidates(id,change_event_id,klass,spec,score,created_ts) VALUES (?,?,?,?,?,?)",
                        (cand_id, change_event["id"], k, rsi.canonical(spec), score, db.now()))
        out.append({"id": cand_id, "class": k, "score": score, "spec": spec})
    out.sort(key=lambda c: c["score"], reverse=True)
    with con:
        con.execute("UPDATE change_events SET status='proposed' WHERE id=?", (change_event["id"],))
    return out

# ── P1: corrected lesson taxonomy + promotion guard ──
EVIDENCE_CLASSES = {"OBSERVED", "MECHANICALLY_VERIFIED", "HYPOTHESIS", "SUPPORTED",
                    "EXPERIMENTALLY_VALIDATED", "REJECTED", "DISPROVEN"}
VALIDATED_CLASSES = {"SUPPORTED", "EXPERIMENTALLY_VALIDATED"}
GENERATION_SOURCES = {"interpretation", "foundry", "slice", "generation", "pipeline", "model"}

class LessonPromotionError(Exception):
    pass

def record_lesson(con, *, source_kind, source_ref, statement, pipeline_result, strategic_hypothesis,
                  business_outcome, verdict, evidence_class, experiment_ref=None):
    """The ONLY sanctioned way to write a lesson. Fail-closed guard:
      • 'PROVEN' is not a valid label anymore and is rejected outright.
      • Generated content (interpretation/foundry/slice/model) is CAPPED at HYPOTHESIS, must keep
        business_outcome=UNKNOWN, and verdict=GENERATED_NOT_VALIDATED.
      • SUPPORTED / EXPERIMENTALLY_VALIDATED require a real experiment_ref.
    """
    if "PROVEN" in {str(evidence_class).upper(), str(verdict).upper()}:
        raise LessonPromotionError("'PROVEN' is not a valid evidence class/verdict — use the V1.1 taxonomy")
    if evidence_class not in EVIDENCE_CLASSES:
        raise LessonPromotionError(f"invalid evidence_class '{evidence_class}'")
    is_generation = source_kind in GENERATION_SOURCES
    if is_generation:
        if evidence_class in VALIDATED_CLASSES:
            raise LessonPromotionError("generated content cannot be SUPPORTED/EXPERIMENTALLY_VALIDATED without a closed experiment")
        if str(business_outcome).upper() != "UNKNOWN":
            raise LessonPromotionError("generated content cannot assert a business_outcome (must be UNKNOWN)")
        if verdict != "GENERATED_NOT_VALIDATED":
            raise LessonPromotionError("generated content verdict must be GENERATED_NOT_VALIDATED")
    if evidence_class in VALIDATED_CLASSES and not experiment_ref:
        raise LessonPromotionError(f"'{evidence_class}' requires a closed experiment_ref")
    import uuid as _uuid
    lid = "les_" + _uuid.uuid4().hex[:12]
    with con:
        con.execute("""INSERT INTO lessons(id,recorded_at,source_kind,source_ref,statement,pipeline_result,
                       strategic_hypothesis,business_outcome,evidence_class,verdict,experiment_ref,never_repeat)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)""",
                    (lid, db.now(), source_kind, source_ref, statement, pipeline_result,
                     strategic_hypothesis, business_outcome, evidence_class, verdict, experiment_ref))
    return lid
