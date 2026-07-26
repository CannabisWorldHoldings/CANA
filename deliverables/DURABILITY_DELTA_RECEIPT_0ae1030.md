# DURABILITY DELTA RECEIPT — 54a0082 → 0ae1030

Current head `0ae1030` is now recoverable from Google Drive. Proven by read-back
and by chaining, not by a successful upload.

## Basis correction — worth recording

The directive named `f4af31e` as the delta basis. **`f4af31e` is the commit that
recorded the v2 upload**, so it came *after* the package it describes and is not
inside it. A bundle built on `f4af31e` would declare a prerequisite absent from the
last durable artifact — a chain that looks correct and silently cannot be replayed.

Verified with `git merge-base --is-ancestor`: `54a0082` is an ancestor of
`f4af31e`. The true undurable range is **3 commits from `54a0082`**, the actual
head of the v2 package.

## Drive artifact

| Field | Value |
|-------|-------|
| File ID | `1DWrPNfkruAgORUKETGIShr4XHVuBZ2Kg` |
| Name | `CANA-DELTA-54a0082-0ae1030.tar.gz` |
| Size | 36,897 bytes |
| SHA-256 | `4ce289ddaa83558fb065291dc01a7d58ee36800c25e09acf7704e6da9c3818d1` |
| Folder | `CANA-DURABILITY/2026-07-26` |
| Type | **INCREMENTAL** — prerequisite `54a0082` |

The bundle is 17,643 bytes against 4.3 MB for a full bundle, so it is a genuine
delta rather than a re-upload. It is useless alone **and says so**: git refuses to
apply it to a repo lacking `54a0082` rather than half-applying it.

## Read-back verification — 6 gates, all PASS

| Gate | Check | Result |
|------|-------|--------|
| 1 | Byte size local vs. Drive | 36,897 = 36,897 **MATCH** |
| 2 | SHA-256 recomputed locally on read-back bytes | identical **MATCH** |
| 3 | All 6 inner hashes after extracting the read-back | **6/6 OK** |
| 4 | Prerequisite declared in the Drive copy | `54a0082…` **correct** |
| 5 | **Chained onto the v2 Drive read-back** | HEAD `0ae1030`, tree `f6cafa55817328128461272a0be6b4b53bf5b7dd` identical, 0 fsck errors |
| 6 | Tests from code assembled **entirely out of Drive** | skills **258/258**, e2e **PROVEN**, structured-data-truth **25/25**, growth-os **26/26**, api-v1-attribution **12/12** |

Gate 5 is what makes this meaningful: both artifacts came out of Drive, and
together they reconstruct the exact working tree. Gate 6 proves the reconstruction
is working software, not just matching bytes.

Second recovery path also proven: the 3-patch series replays from `54a0082` to the
**same** tree `f6cafa55…`.

`git bundle verify` was used only to READ the prerequisite, never as the integrity
gate — it requires an enclosing repository and reports false failures outside one.

## Secret scan

7 files scanned on the exact extracted archive contents. **0 findings.**

## Recovery procedure

1. Restore the v2 full package (Drive `13G2rMEZeqvGBxpPE7VXDVFp1mZJY6mja`).
2. `git fetch /path/to/cana-delta.bundle HEAD && git checkout FETCH_HEAD`
   — or `git checkout 54a0082 && git am patches/*.patch`
3. Verify before trusting: every `skills-src/*.mjs --selftest` (expect 258 total),
   the e2e binding (expect PROVEN), then the web suite (327/327).
