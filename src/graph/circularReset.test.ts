import type { Surface } from "./surface";
import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards, isSolError, type SolError } from "./errorValue";
import { setEditorRefs, processGraph } from "./process";
import { cableValueStore } from "./cableValueStore";
import { ArithmeticNode } from "./nodes/scalar";

// Regression: closing a dependency loop must surface #CIRC!, not blow the stack.
//
// Canvas's connectioncreated pipe (Canvas.tsx ~2444, "audit finding 40") reacts to
// a single new cable with a TARGETED pass: processGraph(cable.target, undefined,
// { topology: true }). runGraphPass then calls `_engine.reset(changedNodeId)`
// (process.ts:518) BEFORE the #CIRC! loop-seeding runs — and rete-engine 2.1.1's
// DataflowEngine.reset(nodeId) walks outgoing connections RECURSIVELY with no
// visited set, so the moment the new cable closes a cycle the reset chases it
// around forever and throws "RangeError: Maximum call stack size exceeded".
// The old (pre compile/fuse merge) pipe called the bare processGraph(), whose
// full `_engine.reset()` is just cache.clear() — no recursion — and the seeding
// then dead-ended the loop members with #CIRC!.
//
// This test drives the EXACT post-merge pipe call. It fails (RangeError) until
// the targeted pass is made cycle-safe.

function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

function makeGraph() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);                  // same wrappers Canvas installs
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  // runGraphPass touches the area only via `area.update("node", id)` — stub it.
  const area = { update: async () => {} } as unknown as Surface;
  setEditorRefs(editor, engine, area);
  return { editor, engine };
}

describe("closing a cycle with a live cable (targeted topology pass)", () => {
  it("yields #CIRC! on the loop members instead of throwing a RangeError", async () => {
    const { editor } = makeGraph();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    await editor.addNode(a);
    await editor.addNode(b);
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a"); // this cable CLOSES the loop

    // Exactly what Canvas's connectioncreated pipe now does for the new cable
    // (target = a): a targeted pass with the topology flag.
    await expect(
      processGraph(a.id, undefined, { topology: true }),
    ).resolves.not.toThrow();

    // The loop members must carry the seeded #CIRC! error, like a full pass gives.
    for (const n of [a, b]) {
      const out = cableValueStore.get(n.id, "result");
      expect(isSolError(out)).toBe(true);
      expect((out as SolError).code).toBe("#CIRC!");
      expect(isSolError(n.cachedResult)).toBe(true);
      expect((n.cachedResult as SolError).code).toBe("#CIRC!");
    }
  });
});
