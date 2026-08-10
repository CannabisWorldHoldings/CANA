# Temporal integrity

The acquisition request time, response `Date`, source revision, source field times, content identity, event time, court `as_of`, and freshness expiry remain separate values.

The court rejects future acquisition evidence, completion before fetch, revision/count disagreement, missing freshness policy, and `as_of` at or beyond expiry. Clock skew is not used to promote freshness. Source dates do not replace the local acquisition receipt, and the local clock does not invent a source modification time.
