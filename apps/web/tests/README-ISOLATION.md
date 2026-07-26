# Test database isolation

## The confound this exists to prevent

An independent verifier attacking the merchant pilot observed `prisma/dev.db`
changing hash underneath it mid-run, and reasonably suspected either tampering
or a concurrent adversary. The real cause was benign but corrosive: my own API
contract tests were creating and deleting fixture rows in the SAME database the
verifier was measuring.

The verifier spent effort re-verifying integrity and re-restoring backups to
rule out an attacker that did not exist. Worse, the reverse failure is
available: a verifier could attribute MY fixture's rows to the component it is
attacking, and report a bypass that is really a test artifact — or miss a real
one because the state moved.

**A verification run and a test run must never share a database.**

## Rules

1. Any harness that writes to a database takes an explicit path
   (`--db <path>`), and never silently defaults to `prisma/dev.db`.
2. Tests that need rows create them, assert, and destroy them in `after()`,
   so teardown runs even when assertions fail. Never mutate seeded rows.
3. Never relabel seeded demonstration data as verified to make a test
   non-vacuous. That manufactures the exact counterfeit-verification failure
   the truth boundary exists to prevent, and leaves it in the database. Create a
   distinct, clearly-named fixture instead.
4. A verifier is told which database file is authoritative for its run, and that
   file is not touched by anything else while it runs.

## Why the file hash legitimately changes

SQLite rewrites page layout on write, so `sha256(dev.db)` can differ while the
logical contents are identical. Integrity must be compared LOGICALLY — row
counts, field values, and a recomputed hash chain — not by file digest.

When recomputing the `DemandCreditEntry` chain, note that `hashBody(entry, prevHash)`
takes `prevHash` as its SECOND ARGUMENT, not as a field on the entry, and the
chain is per-merchant. Getting either wrong produces a false "chain broken"
report; that mistake was made and corrected during verification 07.
