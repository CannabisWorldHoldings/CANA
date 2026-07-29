# Mission 2 commit ledger

Protected base:

- commit: `70a7200fbdbfd46bdcef7143863e33caf6f9d6fe`
- tree: `b7f979a2d1d82b9dbc0b23a015eefaa1402a1dec`

Traceable Mission 2 commits:

| Commit | Intent |
|---|---|
| `d14537b37fdec1b0a12531eaf2d3f26aabf66160` | bind the mission to the protected base |
| `c34fcfdaa0962e42a6c6b17e3487ff9452ecdcb2` | add the durable CANA autonomy kernel |
| `0d65ec83a136689810bcab5988865cc2ff667a11` | execute the Minimum Alive Loop in shadow mode |
| `6657c04e593e916b1d6f8b4cf49d9b1bb70e3a97` | add the Mission 2 courts to the candidate workflow |
| `1f56364385bb707a14dce2c19461ed247b911ef3` | record contracts, repairs, and Mission 3 boundaries |
| `5b4f61f3f29d1a8f8c277caf9d09f205c2ddc79c` | add this non-self-referential commit ledger |
| `aba819087d432d55cf2ebb464d3bebfa56dba26f` | record the exact ownership-policy repair evidence |
| `27057809850fa6a96bfe35d73d5ce86de55679bd` | reconcile exact Mission 2 durability ownership |
| `c0966a456de08cff111e5e310da19891a5af15e3` | seal the non-self-referential Mission 2 commit ledger |
| `73ca0b03e86f8839c7079e401e30b11daadd4818` | restore the symlink security fixture under the canonical Node 24 court |
| `ec56bcfe4a6ea3ca3b6b88122d35cfa49d35dfab` | bind the Node 24 court to exact Mission 2 ownership |
| `34afc1e7cc92d03bbaa67ee8c6960800185adfc6` | close the fail-closed authority, verifier, lifecycle, durability, and evidence review findings |
| `cb9860d4297d153b51a9bf803506b8e35efbb11b` | own the exact Mission 2 execution-lease surface |
| `4eac8fd66d7f9187333ebf8e2aff76a5a7186c2d` | make authority receipts and durable storage restart-safe |
| `cff07669db234e121b1b73065da4cd8b65084de5` | independently reproduce authorization and verifier admission decisions |
| `b6a438d8bf94348481677172f0259eaaa8c9483f` | sign worker leases, isolate verifier execution, enforce exact Foundry schemas, and make execution/rollback crash-safe |
| `c417cd8ab665bc57f7cf82371c2e3fde47603210` | seal exact verifier propositions, make receipt replay restart-stable, and require observed rollback bytes |

The exact ownership-reconciliation and final-evidence commits are recorded by their
full identities in the final external verification receipt after the branch is
sealed. This avoids a self-referential commit claim. No commit in this lineage may
be rebased, squashed, amended, or reconstructed.

Rollback is a deterministic execution operation, not a history rewrite. The
legitimate-loop receipt proves exact byte restoration in its isolated worktree.
If the canonical Mission 2 merge must later be reversed, use a separately reviewed
branch and:

```bash
git revert -m 1 <MISSION_2_CANONICAL_MERGE_COMMIT>
```
