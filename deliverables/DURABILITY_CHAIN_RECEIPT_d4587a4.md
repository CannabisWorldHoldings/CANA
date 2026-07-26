# DURABILITY CHAIN RECEIPT — d4587a4

Head `d4587a4` is recoverable from Google Drive. Proven by rebuilding the **entire
four-artifact chain from Drive bytes alone** and running tests from the result.

## The chain — restore in this order

| # | Artifact | Drive file ID | Prerequisite | Reaches |
|---|----------|---------------|--------------|---------|
| 1 | `CANA-DURABLE-20260726-v2.tar.gz` (FULL) | `13G2rMEZeqvGBxpPE7VXDVFp1mZJY6mja` | — | `54a0082` |
| 2 | `CANA-DELTA-54a0082-0ae1030.tar.gz` | `1DWrPNfkruAgORUKETGIShr4XHVuBZ2Kg` | `54a0082` | `0ae1030` |
| 3 | `CANA-DELTA-0ae1030-ed40c16.tar.gz` | `143TkE5N0LKKQ1DEjo3uf_W9SlZZZ9-1M` | `0ae1030` | `ed40c16` |
| 4 | `CANA-DELTA-ed40c16-d4587a4.tar.gz` | `1NzffI9LsJCJj9al6BkMEBc6OOjU1_6vJ` | `ed40c16` | `d4587a4` |

**Order matters and the artifacts enforce it themselves.** Each bundle declares its
prerequisite, so git refuses to apply one out of order rather than half-applying it.
An out-of-order restore fails loudly instead of producing a plausible wrong tree.

```
tar -xzf CANA-DURABLE-20260726-v2.tar.gz
git clone CANA-DURABLE-20260726-v2/cana-ui-recover-ALL.bundle repo && cd repo
git fetch ../CANA-DELTA-54a0082-0ae1030/cana-delta.bundle HEAD && git checkout FETCH_HEAD
git fetch ../CANA-DELTA-0ae1030-ed40c16/cana-delta.bundle HEAD && git checkout FETCH_HEAD
git fetch ../CANA-DELTA-ed40c16-d4587a4/cana-delta.bundle HEAD && git checkout FETCH_HEAD
```

## This artifact

| Field | Value |
|-------|-------|
| Size | 4,647 bytes (bundle 1,373 bytes) |
| SHA-256 | `574cb58df16db24b519734fc61e3333b76ff99b1693b60bd37ae70abb0c6e23c` |
| Target tree | `1daba531b57d6fead8160fc1b8ff710ec59f05ab` |

## Gates — all PASS

| Gate | Check | Result |
|------|-------|--------|
| 1 | Byte size local vs. Drive | 4,647 = 4,647 **MATCH** |
| 2 | SHA-256 recomputed locally on read-back bytes | **MATCH** |
| 3 | Inner file hashes after extracting the read-back | **4/4 OK** |
| 4 | Prerequisite declared in the Drive copy | `ed40c16…` **correct** |
| 5 | **Whole chain rebuilt from Drive only** | `54a0082 → 0ae1030 → ed40c16 → d4587a4`, tree `1daba531…` identical, **0 fsck errors** |
| 6 | Tests from the Drive-rebuilt tree | skills **258/258**, e2e **PROVEN**, growth-os **33/33**, structured-data-truth **26/26** |
| 7 | Patch replay (second path) | 1/1 commit replays to the **same** tree |

Gate 5 is the one that matters: nothing local was used. Gate 6 proves the
reconstruction is working software, not merely matching bytes.

## Secret scan

5 files scanned on the exact extracted archive. **0 findings.**

## Method note

`git bundle verify` is used only to READ a prerequisite, never as the integrity
gate — it requires an enclosing repository and reports false failures outside one.
