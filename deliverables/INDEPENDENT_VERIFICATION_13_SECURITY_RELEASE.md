# INDEPENDENT VERIFICATION 13 — security and release readiness

Verifier: independent subagent, own clone, own port (3404), own databases. Bound to
commit `0808871`. It reported HEAD drifting twice beneath it and stayed bound rather
than chasing — correct discipline.

## 18 of 19 vectors BLOCKED

The ones worth naming, because each was measured rather than reasoned about:

- **No secret reaches a client bundle.** It built with a sentinel value for
  `CANA_INTERACTION_SECRET` and grepped all of `.next`, static *and* server. Absent.
  This is the vector that would have been catastrophic: a client that can mint an
  interaction challenge can manufacture merchant value.
- **Missing env degrades HONESTLY.** With no interaction secret, attribution grades
  `REQUEST_RECEIVED` with `value_eligible: false`, the ledger row records
  `valueEligible=0`, and growth-os excludes it. The system loses capability without
  gaining a false claim — which is the behaviour the whole evidence design is for.
- **No demonstration record reaches any public payload**, enforced at query level.
- **Host authority tricks** (`.evil.com`, trailing dot, `localhost`, `127.0.0.1`) all
  refused 421.
- **G10 route governance is genuinely falsifiable**: route groups, `_private`
  folders, deep nesting and every extension were all caught as ungoverned.
- **No per-request `new PrismaClient()`** — connection exhaustion is structurally
  prevented by the singleton.

## The one finding, F1, and why it mattered

At `0808871` nothing at runtime could attest the deployed SHA. `receipt.json` carried
it, but no code read it, `/api/health` had no field for it, and the bare `deploy.sh`
verified no checksum — so the safe path was operator-optional. Next serves compiled
bytes, so an artifact altered after build would still present the original receipt.

Closed on the line that followed: the cPanel lane's endpoint reads the receipt, and
the Chief Integrator's fallback resolves a build-time variable. Both report UNKNOWN
loudly rather than fabricating.

## The most useful output: what CANNOT be claimed today

A release receipt asserting any of these right now would be **fabricated**:

| Field | Status |
|---|---|
| Git commit, tree hash, lock hash | **PRODUCIBLE** |
| Build identifier, bundler, tarball sha256 | **PRODUCIBLE** |
| Test receipt | **PRODUCIBLE** |
| Schema *template* fingerprint | **PRODUCIBLE** |
| **Migration hashes** | **MISSING** — no `prisma/migrations` exists; the project has only ever used `db push` |
| **Database provider and version** | **MISSING** — nothing is provisioned |
| **Production schema fingerprint** | **MISSING** — no production database exists |
| **Backup receipt** | **MISSING** — only an isolated-fixture proof |
| **Rollback receipt** against a real database | **MISSING** |
| **Environment manifest hash** | **MISSING** — env is entered by hand in cPanel |

Five of eleven fields cannot exist. That is the honest state of release readiness,
and it is the reason no staging receipt may say production is live.

## Verdict

Not safely stage-able to **production** today — and the blockers are *provisioning
and attestation*, not application-security defects. The application plane is sound.
Staging to a non-production environment is safe now.

## Its own errors, as reported

- A shell `grep && echo || echo` chain whose exit status reflected the trailing
  `echo`, printing a false "LEAK ABOVE". Re-checked precisely: no leak. Its own
  false positive, disclosed.
- One cross-suite flake (`interaction-proof` reported 1 failure alongside two other
  suites; 26/26 in isolation).
- Two DB-integration suites error in its setup because they target a co-running
  server on port 3000, which it deliberately did not run. Environmental; it validated
  the equivalent behaviour directly at runtime instead.

## Cleanliness

Its clone `git diff HEAD` empty; sabotage restored from `git cat-file` and
sha256-verified. Authoritative `dev.db` still 5 DEMONSTRATION_ONLY retailers, zero of
its fixtures. Its server on 3404 shut down by PID; the 3000 listener untouched.
