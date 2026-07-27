# CANA durability CLI

```text
./cana durability status
./cana durability build
./cana durability verify
./cana durability restore [--target <new-path>]
./cana durability upload [--remote <s3-or-ssh-url>]
./cana durability readback
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

Upload supports only explicit `s3://` or `ssh://` destinations and requires:

```text
CANA_DURABILITY_OWNER_AUTHORIZED=YES
CANA_DURABILITY_REMOTE=<remote>
```

Upload alone records `UPLOAD_RECORDED_READBACK_PENDING`. `readback` independently downloads the artifact and compares its SHA-256. Only a matching upload/download round trip for the current commit permits `REMOTELY_DURABLE`.

This lane does not possess owner authorization and therefore executed the refusal paths only. It did not upload the candidate.
