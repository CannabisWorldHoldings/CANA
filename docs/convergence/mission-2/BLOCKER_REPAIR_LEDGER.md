# Mission 2 blocker and repair ledger

Every entry is technical and remained inside the automatic-completion boundary.
No test, security, privacy, truth, freshness, or fail-closed rule was weakened.

| ID | Reproduction | Classification | Root cause | Narrow repair | Regression evidence |
|---|---|---|---|---|---|
| `M2-B001` | First Mission 2 unit run: 17 tests, 10 passed, 7 failed | deterministic implementation defect | first event dereferenced a null prior projection | require an existing projection before transition validation | durable reconstruction and illegal-transition courts pass |
| `M2-B002` | Second unit run: 17 tests, 12 passed, 5 failed | deterministic implementation defect | reconstructed missions did not copy tenant/workspace from the event envelope | bind tenant/workspace from the first event and reject later drift | cross-tenant and restart courts pass |
| `M2-B003` | Second unit run rejected an approved promotion payload | deterministic serialization defect | the approved branch serialized `failure: undefined` | omit the field unless a real failure exists | complete promoted lifecycle court passes |
| `M2-B004` | Initial promoted documentation bytes differed from the branch by one blank line | evidence/receipt mismatch | generator and applied Markdown spacing differed | make the generator include the canonical blank line and regenerate all evidence | branch file SHA-256 equals `approved_after_sha256` |
| `M2-B005` | Combined workflow/unit run while the workflow files were dirty: 26 tests, 25 passed, 1 failed | verification precondition, not candidate semantics | the offline GitHub preparer correctly refuses dirty source | commit the workflow change, then rerun from a clean tree | clean run passes 26/26 |
| `M2-B006` | deletion of the final event originally reconstructed a shorter apparently valid chain | real durability defect | hash chaining alone cannot distinguish an intentional prefix from truncated history | compare reconstructed event count and tail hash with the last atomic projection checkpoint | deletion now returns `EVENT_DELETION_DETECTED` |
| `M2-B007` | first ownership-regression run: 35 tests, 16 passed, 19 failed | deterministic ownership-policy defect | the authorization-effect value did not contain the validator's exact fail-closed `no production` phrase | make every denied authority explicit and recompute the sealed assignment digest | ownership regression run passes 35/35 |

Failed results were not retried until lucky. Inputs changed before every rerun, and
the final clean runs execute normally in fresh processes.

No owner decision was required. Hermes, provider, spend, production, hosting, DNS,
credentials, deployment, outreach, and public communication remained untouched.
