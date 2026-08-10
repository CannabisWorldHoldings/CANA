# Cognitive evolution state

The implemented state is bounded reflection, not recursive self-improvement.

One deterministic episode can record its source snapshot hash, prior belief, observed result, bottleneck, proposed causal mechanism, and next owner action. The only allowed output state is `REFLECTION_ONLY`; value remains `VALUE_NOT_ESTABLISHED`; promoted mutations remain zero.

Promotion is blocked until a future candidate supplies all of:

- frozen parent and comparable baseline;
- hidden holdout evaluation;
- adversarial court;
- negative-transfer checks;
- independent recomputation and approval;
- later retrieval evidence proving the memory was useful.

There is no implemented champion/challenger manager, winner-memory write, TruthGraph promotion, autonomous policy mutation, or commercial-value proof in Slice 1. Site Intelligence may observe the reflection receipt but cannot promote it.
