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

`tools/durability/owner-approval-key.json` intentionally contains no public key in this candidate. The owner or Chief Integrator must explicitly reassign that configuration and install the owner public key before either network operation can run. Until then every caller, including one that sets the legacy `CANA_DURABILITY_OWNER_AUTHORIZED=YES`, is refused.

Upload alone records `UPLOAD_RECORDED_READBACK_PENDING`. `readback` independently downloads the artifact and compares its SHA-256. Only a matching upload/download round trip for the current commit permits `REMOTELY_DURABLE`.

This lane does not possess owner authorization and therefore executed the refusal paths only. It did not upload the candidate.
