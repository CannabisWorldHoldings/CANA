# CANA owner-action packet

This packet authorizes nothing by itself. Every hosted or remote claim remains
`UNPROVEN` until its verification step passes. Secrets must be supplied through a
secret manager or hosting control panel, never committed or pasted into receipts.

## 1. Canonical GitHub repository access

OWNER_ACTION

Create an empty private repository named `CANA` in the
`CannabisWorldHoldings` organization, or grant an owner-designated automation
principal administrator access to the existing
`CannabisWorldHoldings/CANA`. Do not initialize a new repository with a README,
license, or `.gitignore`. Provide the canonical SSH or HTTPS URL and explicit
written authorization for remote inspection and push.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Refresh `./cana github prepare`, add the canonical remote, fetch it, compare all
remote refs, rerun outgoing-history secret and large-file scans, execute push dry
runs, push only the approved protected and integration histories, and open the
integration pull request. No substitute repository will be used.

VERIFICATION_REQUIRED

Confirm the pushed commit and tree equal the normalized promotion receipt. Apply
strict required checks `candidate-unit`, `focused-verifier`, `maria-verifier`,
`cpanel-verifier`, `durability-proof`, and `github-import-offline`; enforce
administrators, code-owner review, one approval, last-push approval, conversation
resolution, linear history, and refusal of force pushes and deletions.

ROLLBACK

Delete no history. Close the pull request if unmerged. If merged, create a reviewed
merge-revert pull request. Remove the canonical remote locally if access is
withdrawn.

## 2. Hosted MariaDB staging

OWNER_ACTION

Provision a private MariaDB 11.4-compatible staging database with TLS, a dedicated
least-privilege application user, a separate migration user, automated backups,
and no public allowlist beyond the private staging application. Supply host, port,
database name, usernames, TLS requirements, and backup controls without exposing
passwords in source or chat. Explicitly approve or reject a live provider-cutover
commit.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Generate the provider-cutover diff atomically from
`tools/mariadb-sim/schema.prisma`, including every required `@db.Text` annotation
and fail-closed attribution identity constraint. Produce migration SQL, a
pre-migration backup command, schema diff, rollback SQL, and a private staging-only
execution plan. Do not modify production.

VERIFICATION_REQUIRED

Run empty, populated, old-schema, interrupted, concurrent, backup, restore, and
rollback cases against the hosted staging database. Recheck DATETIME(3),
collations, duplicate/NULL identity, long-chain JSON/digest round trips,
contention, deadlock retry, connection exhaustion, TLS, and least privilege.

ROLLBACK

Stop application writes, retain the failed release, restore only the exact
hash-verified pre-migration backup to a new database, point private staging back
to the prior database, and verify prior release identity and readiness.

## 3. Environment secrets

OWNER_ACTION

Provide staging-only values through the cPanel environment or an approved secret
manager for `DATABASE_URL`, interaction/challenge signing, admin authentication,
and any other variables explicitly reported missing by release verification.
Use unique staging values; provide no production secret.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Map variables to server-only runtime configuration, generate a names-only
inventory, scan source and built browser assets, and verify that no value enters
Git, receipts, logs, client chunks, or deployment archives.

VERIFICATION_REQUIRED

Rotate a staging value and prove the old value no longer authenticates. Search
outgoing history, release tarball, server logs, `.next/static`, browser chunks,
and normalized receipts for exact values and credential signatures.

ROLLBACK

Revoke and rotate the affected staging values, remove them from the staging
application, activate the prior immutable release, and rebuild artifacts from a
clean checkout.

## 4. Private cPanel staging application

OWNER_ACTION

Create a private Node application rooted outside `public_html`, with immutable
release storage, a `current` activation pointer, shared data/log/evidence-spill/
backup directories, TLS, and access restriction. Provide the account path, Node
runtime path, private staging hostname, Passenger restart mechanism, and explicit
authorization to deploy only to this staging application.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Build the exact verified release package, upload it to a new immutable release
directory, install production dependencies from the lockfile, generate Prisma,
configure server-only variables, run readiness, and activate by atomic pointer
replacement. No public or production application will be touched.

VERIFICATION_REQUIRED

Verify `/api/health`, `/api/ready`, `/api/release`, homepage smoke, worker
checkpoint, shared persistence, logs, no-store identity, exact Git SHA, process
ownership, port binding, and absence of secrets from public/browser artifacts.

ROLLBACK

Atomically restore `current` to the previous immutable release, restart only the
owned Passenger application, verify prior `/api/release` SHA and readiness, and
retain the failed release and logs for diagnosis.

## 5. Staging migration

OWNER_ACTION

Approve the exact migration commit, maintenance window, pre-migration backup hash,
and rollback threshold. Confirm no production database is in scope.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Quiesce staging writes, acquire the migration lock, record the current schema and
row-count checksums, run the reviewed migration once, and restart the private
staging application only after readiness passes.

VERIFICATION_REQUIRED

Compare schema, counts, evidence-chain digests, JSON validity, ledger sequence and
entry hashes, duplicate-event refusal, and release identity before and after.

ROLLBACK

If any invariant fails, stop writes, execute the reviewed down migration only when
it is proven safe; otherwise restore the hash-verified backup to a new staging
database and reactivate the prior release.

## 6. Hosted backup and restore proof

OWNER_ACTION

Choose a staging backup destination and retention window, authorize one destructive
restore test only into a new isolated staging database, and identify who may approve
deletion after verification.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Create and hash a logical backup, copy it to the authorized location, restore it to
the isolated database, run fsck-equivalent database checks and application
readiness, then record source/backup/restored identities.

VERIFICATION_REQUIRED

Confirm row counts, evidence JSON/digests, ledger chains, release compatibility,
TLS, and the restored application's exact commit. A backup without an executed
restore does not pass.

ROLLBACK

Delete nothing until the owner accepts the receipt. If restore verification fails,
retain both artifacts, revoke access to the failed database, and continue using the
untouched source database.

## 7. Remote durability

OWNER_ACTION

Install an owner-controlled, root-owned Ed25519 public key and key ID at the paths
documented in `docs/DURABILITY_CLI.md`. Choose an authorized `s3://` or `ssh://`
destination and issue separate signed, expiring approval envelopes for upload and
readback, each binding the exact commit, tree, artifact hash, action, remote,
approver, approval ID, and expiry.

CODEX_AUTOMATION_AFTER_AUTHORIZATION

Run `./cana durability build`, `verify`, and `upload` with the signed upload
envelope. After upload, perform an independent download with the separately signed
readback envelope and compare the complete artifact SHA-256.

VERIFICATION_REQUIRED

Only `./cana durability readback` may emit `REMOTELY_DURABLE`, and only after the
downloaded bytes match. Confirm a clean mirror reconstruction, fsck, exact
commit/tree, focused verification, and retained signed receipts.

ROLLBACK

If upload or readback fails, leave the candidate `LOCAL_ONLY_CANDIDATE`, revoke the
approval envelope, retain the local verified artifact, and remove only the failed
remote object after separate owner authorization.

## Exact next owner action

Create or grant administrator access to the empty private
`CannabisWorldHoldings/CANA` repository and provide explicit authorization for
Codex to inspect and push the exact integration history. No other owner action is
needed before that decision.
