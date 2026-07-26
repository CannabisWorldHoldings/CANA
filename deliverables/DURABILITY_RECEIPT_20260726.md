# DURABILITY RECEIPT — 2026-07-26

`CannabisWorldHoldings/CANA` remains 404 (owner action), so head `4e012fa` existed
only in the agent workspace. It is now recoverable from Google Drive, and that
claim is proven by read-back, not asserted from a successful upload.

## Drive artifact

| Field | Value |
|-------|-------|
| File ID | `1Ukuwq8xHKaCy5D4-ILlNVRtGAer2bAlc` |
| Name | `CANA-DURABLE-20260726.tar.gz` |
| Folder | `CANA-DURABILITY/2026-07-26` (`1uo1KJSpQqdIp_DAsm-LxYRDMlR4swVXP`) |
| Size | 6,960,884 bytes |
| SHA-256 | `ac410d757c11bf3456c1c43b70637f85e52b113f57fa6e98132456cbe352fe6f` |
| Owner | princeleuel1@gmail.com |
| Sharing | not shared — private to the owner's Drive |

## Read-back verification — 5 gates, all PASS

| Gate | Check | Result |
|------|-------|--------|
| 1 | Byte size, local vs. Drive read-back | 6,960,884 = 6,960,884 **MATCH** |
| 2 | SHA-256 recomputed locally on the read-back bytes | identical **MATCH** |
| 3 | All 39 inner file hashes after extracting the read-back | **39/39 OK** |
| 4 | Bundle clones from the read-back copy | HEAD `4e012fa`, 0 fsck errors, **11/11** ref tips, **87** commits, tree `99708e5…` identical |
| 5 | Test suites run FROM the Drive-recovered code | **241/241** passing, e2e binding **PROVEN** |

Gate 5 is the one that matters. Gates 1–4 prove bytes survived; gate 5 proves the
recovered bytes are working software.

## Two independent recovery paths, both proven

**Bundle** — `git clone cana-ui-recover-ALL.bundle` → all 11 refs, 87 commits
reachable from all tips in both source and restore, 0 fsck errors, HEAD tree
`99708e5321508d5c7f19d57db8660ec9e36bb0ae`, 241/241 tests pass from the restore.

**Patch series** — `git checkout 487ece6 && git am patches/*.patch` → 36/36
commits replay to the same tree `99708e5…`, byte-identical to the target.

A single recovery route that turns out to be corrupt is not a recovery route.

## Secret scan

1,057 text blobs across the full history; the final scan ran on the exact
extracted archive contents. **0 real secrets.** Two false positives investigated
and resolved rather than suppressed:

- An `AKIA`-shaped byte run in `brand-assets.b64.json`. Decoding the containing
  value yields magic bytes `ffd8ffe0` — JPEG image data, not a credential.
- Password literals in test files are fixtures (`StrongClaim!2026`).

`.env` is gitignored and never entered any commit; `.env.example` has empty values.
No `.pem`, `.key`, `id_rsa`, `.p12` or `.pfx` file is tracked anywhere in history.

## Scope discipline

Nothing was pushed to any source repository — the working repo has no remote, so
no source lineage could be touched. The protected baseline `487ece6` is unchanged
by all 36 commits. No external drive was requested, inspected, mounted, or
depended on. No secret was requested in chat.
