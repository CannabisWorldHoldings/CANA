# Source lifecycle

Lifecycle state is derived from append-only evidence:

1. Registered: fixed contract exists.
2. Preflighted: owner opt-in, non-CI, no proxy/credential input, and public DNS are proven.
3. Observed: pre-count and either the source revision or explicit `UNKNOWN` are recorded.
4. Captured: bounded complete bytes are validated.
5. Stable: post-count equals the pre-read and any exposed source revision agrees; absent revisions remain `UNKNOWN`.
6. Classified: changed or unchanged against prior tenant/source content.
7. Adjudicated: a separate compiler/court operation evaluates allowed predicates.
8. Due: freshness debt may create OBSERVE_ONLY revalidation work.

Failures remain events. They do not delete prior truth or imply absence.
