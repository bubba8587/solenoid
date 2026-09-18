<!-- [[C43]] oneFlowSurface -->

# Spec: Graph load / teardown performance

Serves [[C43]] oneFlowSurface. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Graph load / teardown performance; a WHY that is not in a node belongs in one.

The rete-era cost model (hundreds of per-node React roots to unmount, socket-position bookkeeping) died with the rete surface — every card renders in ONE React tree and RF measures handles itself. What carries the load path now:

- **The topology pipe coalesces a rebuild into ONE commit.** The surface's editor pipe queues `syncTopology` on any add/remove event, and the queued sync defers while `isGraphRebuilding()` holds (re-arming on a timer until the gate drops) — so a load's hundreds of events become one `setNodes`/`setEdges` commit, not N. The drill-in's pipe has its own local gate (`s.rebuilding`).
- **`syncTopology` preserves survivors' OBJECT IDENTITY** so RF's memo skips unchanged cards — adding or removing one node re-renders one card, not the whole canvas. Without both halves, a big-graph undo (a full snapshot restore) was O(n²) — 113s at 241 nodes; with them, under a second.
- **Build — construct-then-batch:** every node constructs synchronously (id remap + state restore), THEN adds and positions concurrently — a per-node `await addNode; await translate` is ~2N sequential microtask hops; `Promise.all` collapses the chain into one barrier while each node's own add→translate stays ordered.
- **Store reset:** the per-node `noderemoved` handler skips `forgetNode` while rebuilding (`isGraphRebuilding`) — stores scan their whole maps per event; the bulk path resets them once.
