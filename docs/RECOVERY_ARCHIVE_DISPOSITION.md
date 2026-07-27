# Mac recovery archive disposition

Archive inspected:
`/Users/Apple/Downloads/CANA_MAC_LOCAL_RECOVERY_BUNDLE_2026-07-26.zip`

## Executed intake evidence

- Exact size: 6,186,053,094 bytes.
- Exact SHA-256:
  `0ec9c44f77aee4342c0a783bb321af84f560cb33cbfa0bb20862f9b30efbf16a`.
- Central directory: 7,590 entries, 6,265 files, zero absolute, traversal, or
  backslash paths.
- Full compressed-data CRC: PASS with `unzip -t`; no bulk extraction was used.
- Package reports: 8 admitted bundles PASS, 18 patch checks PASS, 5 target
  exports PASS, and zero final secret findings.
- The relevant `ORDERWEEDDCRSI-4a2b656cba-ALL-REFS.bundle` was selectively
  extracted, independently verified as a complete SHA-1 history, and cloned.

The complete central-directory inventory was generated as `inventory.json`,
`tree.txt`, and `summary.md` in a separate temporary evidence directory. The
archive atomizer's default `extractall` implementation was not used because it
would have expanded the full 6.2 GB package contrary to the selective-intake
boundary.

## Integrated

No archived source file or commit was copied verbatim into the candidate.
The only current launch defect exposed by comparison was already present in
the recovered/current TypeScript implementation: a database-backed
`site-intelligence.ts` shared a resolver stem with
`site-intelligence.mjs`. That implementation was preserved, renamed to
`site-intelligence.server.ts`, and protected with a verifier warning gate.

This is an integration of missing technical behavior, not a replay of an
older tree.

## Rejected because current work is stronger or identical

| Recovery item | Executed comparison | Disposition |
| --- | --- | --- |
| `28ffe9d` competitive UI | 10 of 16 resulting blobs are byte-identical in the current tree; the other six paths exist with later content. | Reject replay. It would overwrite the current verified UI direction with an older patch. |
| `25d6569` ad-creative provider | Exact commit is an ancestor of the candidate. | Reject duplicate. |
| `dfbc460` Namecheap production artifact fix | Exact commit is an ancestor of the candidate, and the current cPanel simulator executes its deployment surfaces. | Reject duplicate. |
| Historical CANA review and QA files | Bound to older commits and environments. | Retain as recovery evidence only; they cannot verify the current SHA. |
| `tools/finalize_internal.py` | One-off package finalizer for broad Mac recovery. | Reject transplant. Current durability build/verify/restore performs candidate-scoped secret scanning, reconstruction, fsck, tests, and prerequisite refusal. |

## Rejected as out of technical-launch scope

| Recovery item | Reason |
| --- | --- |
| `6a6c5af` CANA Hermes revenue foundation | Bundle integrity PASS, but it introduces revenue plans, merchant hypotheses, approval policy, and a parallel mission runtime. Those semantics require Chief Integrator or owner assignment. |
| `352ff70` Growing Mind ledger/auditor | Adds a doctrine ledger and another build court rather than resolving a launch surface. Its guard references are historical and not current-SHA proof. |
| Untracked signal-governor package | Parallel Python runtime plus product/governance policy; not a MariaDB, verification, durability, cPanel, GitHub, security, or rollback gap. |
| Untracked marketplace preview and UI test | Final UI and brand direction are explicitly outside this technical lane. |
| December deployment snapshots and FTP patches | Historical remote/site material with no current release identity; local package evidence cannot be converted into live deployment proof. |
| Curated screenshots and crawl assets | Product/design/research evidence, not a missing launch tool. |

## Explicit residual

The archive itself reports one unresolved historical target:
`mobile cart-pill overlap fix`. No uniquely identified patch or commit exists
in the package. Recovering or inventing a UI change from that label would cross
the final-UI boundary, so no change was made.
