# Cable collision avoidance — deferred spec

The only live content of the original React-Flow-era cable spec: the deferred
collision-avoidance design that `backlog.md` points at. Everything else in that
spec shipped in a different form (walk-enumeration router + tangent-exact
spline in `cablePaths.ts`; the two-arm "Manifold" node was removed — today's
Conduit is the block bundler) — see CLAUDE.md and `subsystem-invariants.md`
"Cable routing" for the built system. Don't implement from historical geometry.

## §2. Collision avoidance (deferred)

- **Avoid nodes** — cables route around node bounding boxes instead of cutting
  through.
- **Avoid cables** — cables that would cross another prefer to run parallel
  where they share direction, then split at the last reasonable point. At
  unavoidable crossings, draw a small bridge hop (electrical-schematic
  convention).

Both toggles act on top of the chosen shape — straight + avoid nodes is a
circuit-board feel; spline + avoid cables is an organic "data clusters flowing
alongside each other" feel.

Deferred follow-ups from the same spec:
- Avoid-nodes routing — ELK or smart-edge integration.
- Avoid-cables + intersection bridge UI.
- Per-cable shape / avoidance overrides (shape is graph-wide today).
