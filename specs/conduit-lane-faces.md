<!-- [[D17]] relaysTransparent -->

# Spec: Conduit lane faces

Serves [[D17]] relaysTransparent. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

There is NO flip rule: inputs sit on the local **−x** face, outputs on **+x**, and both simply rotate with the block angle (`ConduitComponent.tsx` places lanes at ∓`halfW` and rotates; `ribbonCable.ts` `conduitFacePoint` uses `sign = side === "out" ? 1 : −1`; both lane exit angles are `snap45(angle)`). The old flip-at-`sin r = 0` rule belonged to the removed two-arm Manifold — if you find a face-sign predicate anywhere, it's dead code.
