# PARALLEL FOUNDRY — worktree and file-ownership map

Starting commit for every lane: **`a8c82be`**. Authoritative branch:
`recover/competitive-ui-day-night` in `/agent/workspace/ui-recover`.

**Only the Chief Integrator merges.** A lane produces a candidate commit on its own
branch plus an evidence receipt; it never pushes to the authoritative branch.

## Lanes

| Lane | Worktree | Branch | Port | Database |
|---|---|---|---|---|
| Chief Integrator | `/agent/workspace/ui-recover` | `recover/competitive-ui-day-night` | 3000 | `apps/web/prisma/dev.db` |
| Durability | none (read-only + `/tmp`) | — | — | none |
| Host/DB decision | none (research only) | — | — | none |
| Migration | `/tmp/lanes/migration` | `lane/migration` | 3401 | `/tmp/lanes/migration/*.db` |
| Handoff verifier | own clone under `/tmp` | — | 3402 | `/tmp/verify-handoff/*.db` |
| cPanel release | `/tmp/lanes/cpanel` | `lane/cpanel` | 3403 | `/tmp/lanes/cpanel/*.db` |
| Security verifier | own clone under `/tmp` | — | 3404 | `/tmp/verify-sec/*.db` |
| Product | `/tmp/lanes/product` | `lane/product` | 3405 | `/tmp/lanes/product/*.db` |

## File ownership — exclusive write

**Migration lane owns:**
`apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/**`,
`apps/web/prisma/seed*.mjs`, `apps/web/src/lib/db-config.mjs`,
`apps/web/tests/migration-*.test.mjs`

**cPanel lane owns:**
`deploy/**`, `apps/web/src/app/api/release/**`, `apps/web/tests/release-*.test.mjs`
*(except `release-gate.test.mjs`, which the Chief Integrator owns)*

**Product lane owns:**
`apps/web/src/app/api/v1/neighborhoods/**`,
`apps/web/src/app/[domain]/saved/**`, `apps/web/tests/api-v1-neighborhoods.test.mjs`

**Chief Integrator owns everything else**, and specifically these
production-data-plane files, which NO lane may edit:
`apps/web/src/lib/handoff.mjs`,
`apps/web/src/app/[domain]/retailer/[id]/handoff/route.ts`,
`apps/web/src/lib/prisma.ts`, `apps/web/src/lib/page-challenge.mjs`,
`apps/web/src/lib/demand-credits.mjs`, `apps/web/src/lib/growth-os.mjs`,
`apps/web/tests/release-gate.test.mjs`

## Prohibited for every lane

- Editing a file owned by another lane.
- Touching `apps/web/prisma/dev.db` — the Chief Integrator's mutable database.
- Running a server on port 3000.
- `pkill` (it kills the shell). Find the PID with `ss -lptn 'sport = :PORT'`.
- Provisioning any real database, deploying publicly, contacting a merchant, or
  spending money. All owner-gated.

## Anchors at `a8c82be`

Bind every verdict to these. Report drift rather than assuming it is benign.

```
e38408b235ae44bc  apps/web/src/lib/db-config.mjs
# ^ NOT 55d5d69d. That was the pre-F3 hash from the previous verifier brief; the
#   synchronous persistence fix changed the file. Caught by generating anchors from
#   the working tree instead of copying them forward — a stale anchor would have had
#   every lane report false drift on its first check.
86b6a806ad99836b  apps/web/prisma/schema.prisma
17964150e2ea6c06  apps/web/src/app/[domain]/retailer/[id]/handoff/route.ts
295bcc216a5f44a2  apps/web/src/lib/handoff.mjs
edddcca79f0afba1  apps/web/src/lib/prisma.ts
```

## Integration requirements

A candidate merges only with: the exact commit, a changed-file manifest, focused
tests, a falsification proof, an independent verdict where the lane changes
behaviour, migration impact, a rollback plan, a secret scan, and a clean worktree.

After every merge: build → focused tests → full web and skill suites →
cross-component courts → database cleanliness → commit → checkpoint → durabilize.

## Sabotage protocol (all lanes)

Assert the anchor matched, preserve the pre-sabotage hash, run the intended failing
test, restore exact bytes, verify the restored hash, then run the full relevant
suite. A restore that silently no-ops has already cost this mission a near-miss.

---

# CYCLE CLOSED — all lanes integrated

Every lane merged into `recover/competitive-ui-day-night` with **zero conflicts** and
**zero file collisions**. That was the entire bet of this cycle and it is worth being
precise about why it worked, because the result is easy to mistake for luck.

| Lane | Candidate | Files | Merge |
|---|---|---|---|
| Product (neighborhoods) | `54317ea` | 2 | clean |
| cPanel release | `9c65c7a` | 19 | clean |
| Migration | `b0db9fd` | 9 | clean |
| Chief Integrator (F1 repair) | `cff0ded` | 5 | — |

Thirty files across schema, deployment and public API, four agents working
simultaneously, no coordination during execution. The map did that: exclusive
ownership declared BEFORE work started, prohibited files named explicitly, and a
standing rule that only the Chief Integrator merges.

## What the lanes could NOT do, and correctly did not

Each lane hit at least one thing outside its boundary and **reported it instead of
reaching for it**:

- The product lane's route was refused by release-gate G10. It did not edit the gate —
  that file belongs to the Chief Integrator. It reported the exact failure text.
- The cPanel lane needed the same registration for `/api/release`, and asked.
- The migration lane found `package.json` still running `db push` rather than
  `migrate deploy`, and did not change it.
- The cPanel lane needed `prisma/migrations/**` to exist for `migrate.sh`; it shipped
  a hard-stop instead of inventing one, and the builder now picks the directory up
  automatically because the migration lane created it in the same cycle.

Both new public routes are now registered. G10 refusing them is the gate working
exactly as designed: a new public surface cannot reach main until someone decides it
is governed.

## Two lanes found the same defect from opposite directions

The migration lane's portability audit and my own independent measurement both landed
on `String → VARCHAR(191)`. It reasoned forward from generated DDL; I measured a real
405-character evidence chain and its broken digest. Same conclusion, two methods, one
permanent guard in `tests/column-width-cutover-court.test.mjs`.

## Boundaries now RETIRED

The `/tmp/lanes/*` worktrees are merged and no longer authoritative. Any further work
on those paths happens in the main tree. A new parallel cycle needs a NEW map — reusing
this one would grant ownership that no longer means anything.
