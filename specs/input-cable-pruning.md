<!-- [[D10]] onePrunePath -->

# Spec: Input-cable pruning

Serves [[D10]] onePrunePath. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Input-cable pruning; a WHY that is not in a node belongs in one.

Every "these input sockets are going away" moment — a mode/op switch hiding inputs, a variadic row deleted, a formula variable or side socket disappearing — drops the affected cables through `dropInputCables` BEFORE the socket is hidden or removed. The three rules the twelve hand-rolled copies each half-remembered, now carried by the helper: prune **before** hide/`removeInput` (a cable referencing a removed socket is unsafe; a hidden socket with a live cable is an invisible wire), go through the **ACTIVE** editor (a drill-in edits its own graph), snapshot-then-**await** each removal (removals mutate the list; each is its own undo entry). Binds node classes as much as components — Computed Column's side-socket reconcile was the copy the components-only sweep missed. Sanctioned direct `removeConnection` callers (cross-graph port sync, both-direction prunes like Equation's, type-compat filters, single user-picked cable) each carry their reason in `sourceInvariants.test.ts`'s list.
