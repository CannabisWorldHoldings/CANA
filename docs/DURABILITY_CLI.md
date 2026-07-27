# CANA durability CLI

```text
./cana durability status
./cana durability build
./cana durability verify
./cana durability restore [--target <new-path>]
./cana durability upload --remote <s3-or-ssh-url> --approval <signed-envelope.json>
./cana durability readback --approval <signed-envelope.json>
```

`status` distinguishes the remotely verified base frontier from the current candidate. `tools/durability/base-remote-receipt.json` records the user’s superseding Drive correction without changing the historical handoff receipt.

`build` refuses a dirty tree, a missing base ancestor, Git integrity errors, globally prohibited changes, unowned paths and outgoing-history secret findings. It creates:

- a self-contained Git bundle;
- a binary patch from c953ebc;
- a commit mailbox;
- a manifest and large-file inventory;
- SHA256SUMS;
- a compressed upload artifact.

`verify` validates every checksum and the bundle, reconstructs the exact tree independently from both the bundle and binary patch, runs `git fsck`, then runs `./cana verify focused` in the reconstructed clone.

`restore` creates a new target, verifies checksums, clones the bundle, checks commit/tree/fsck/clean status, and refuses any existing target.

## Remote proof gate

Upload supports only explicit `s3://` or `ssh://` destinations. A caller-set environment variable is never authorization. Both upload and readback require separate Ed25519-signed approval envelopes whose canonical payloads bind the action, exact commit and tree, sanitized remote, artifact SHA-256, approver, approval ID and expiry. Readback approval also binds the recorded upload time.

The trust anchor is intentionally outside candidate-controlled paths. The owner or Chief Integrator must explicitly reassign configuration and install a root-owned, non-group/world-writable Ed25519 public key at `/etc/cana/durability-owner-ed25519.pub` plus its key ID at `/etc/cana/durability-owner-key-id`. Neither file exists in this candidate environment, so every caller, including one that sets the legacy `CANA_DURABILITY_OWNER_AUTHORIZED=YES`, is refused.

Upload alone records `UPLOAD_RECORDED_READBACK_PENDING`. `readback` independently downloads the artifact and compares its SHA-256. Only that fresh, separately signed readback operation may emit a candidate `REMOTELY_DURABLE` receipt. Passive `status` never trusts mutable local upload state for this claim; it continues to report the candidate as `LOCAL_ONLY_CANDIDATE` and the immutable verified base as the durable frontier, even when a local round-trip record is present.

This lane does not possess owner authorization and therefore executed the refusal paths only. It did not upload the candidate.
