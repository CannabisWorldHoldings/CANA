# MISSION PACKET — template (layer 4 of six; see LAYERS.md)

Instantiate per mission. The executable form of this packet is an alive-loop
mission grant (`tools/alive-loop/adapter.mjs` — fail-closed validation); this
document is its human-readable twin. Volatile state belongs in the Current
State Ledger, never here and never in the constitution.

```yaml
mission_id:            # unique, stable
objective:             # one sentence — what reality should change
success_criteria:      # predeclared, measurable; the metric the courts check
non_goals:             # what this mission explicitly does not touch
constraints:           # laws that bind harder than usual here
authority_grant:       # capabilities requested (never owner-only)
write_set:             # exact paths/resources this mission may mutate (default deny)
dependencies:          # capabilities/states this mission assumes (registry ids)
budget:                # cost 0 for first-court missions; time/attempt caps
expected_outputs:      # artifacts + receipts this mission must produce
evaluation_plan:       # which courts run; which sealed judge confirms (metric id)
forecast:              # falsifiable prediction + probability, registered pre-outcome
rollback:              # exact reversal path
owner_gates_touched:   # NONE, or the list awaiting explicit authorization
```

Rules: a mission without predeclared success criteria is not a mission; a
mission whose judge was not sealed before candidate selection cannot claim a
confirmed improvement; a mission that finds nothing closes STEADY_STATE and
claims nothing.
