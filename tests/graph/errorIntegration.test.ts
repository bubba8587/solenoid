import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { isSolError, type SolError } from "../../src/graph/errorValue";
import { loopMembers } from "../../src/graph/graphCompute";
import { solError } from "../../src/graph/errorValue";
import { TableInputNode } from "../../src/graph/nodes/matrix";
import { ListIndexNode } from "../../src/graph/nodes/list";
import { LambdaNode } from "../../src/graph/nodes/lambda";
import { MapTableNode } from "../../src/graph/nodes/tableLambda";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import { DisplayNode } from "../../src/graph/nodes/display";
import { IsTestNode } from "../../src/graph/nodes/logic";

// A connection between two concrete node classes is Connection<A, B>, which the
// invariant SolenoidConnection (Connection<Node, Node>) won't accept directly —
// erase the endpoint types the way the real graph does.
function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

// End-to-end checks that wire nodes through a real editor + DataflowEngine with
// the SAME two wrappers Canvas installs — central input coercion (inner) and the
// error-value guard (outer). These cover the seed's cases that a bare node.data()
// can't: the coercion #SHAPE! path and an error riding a cable into a consumer.
function makeEditor() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);                 // wraps data() first (inner)
  editor.addPipe((ctx) => {                      // wraps data() second (outer)
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

describe("error propagation through the engine", () => {
  it("a 2×2 table fed where one value is needed is #SHAPE!", async () => {
    const { editor, engine } = makeEditor();
    const table = new TableInputNode({ tableText: "1, 2\n3, 4" });
    const index = new ListIndexNode();
    await editor.addNode(table);
    await editor.addNode(index);
    // table → the `index` socket, which wants a single number: coercion narrows
    // the 2×2 down, can't, and throws — surfacing as #SHAPE! on the consumer.
    await connect(editor, table, "table", index, "index");
    const out = await engine.fetch(index.id) as { result: unknown };
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#SHAPE!");
  });

  it("a broken LAMBDA carries #NAME? down its cable into MAP", async () => {
    const { editor, engine } = makeEditor();
    const lam = new LambdaNode({ params: "x, 2y", expr: "x" }); // "2y" isn't a valid name
    const map = new MapTableNode();
    await editor.addNode(lam);
    await editor.addNode(map);
    await connect(editor, lam, "result", map, "lambda");
    const out = await engine.fetch(map.id) as { result: unknown };
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#NAME?");
  });

  it("an error propagates through a downstream computation", async () => {
    const { editor, engine } = makeEditor();
    const div = new ArithmeticNode({ op: "div" });
    div.literals = { a: 1, b: 0 };               // 1 ÷ 0 → #DIV/0!
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 5 };
    await editor.addNode(div);
    await editor.addNode(add);
    await connect(editor, div, "result", add, "a");
    const out = await engine.fetch(add.id) as { result: unknown };
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#DIV/0!"); // the source code, not a new one
  });

  it("a Display SHOWS the error in its box and FORWARDS it down the chain", async () => {
    const { editor, engine } = makeEditor();
    const div = new ArithmeticNode({ op: "div" });
    div.literals = { a: 1, b: 0 };
    const disp = new DisplayNode();
    const check = new IsTestNode({ op: "iserror" });
    await editor.addNode(div);
    await editor.addNode(disp);
    await editor.addNode(check);
    await connect(editor, div, "result", disp, "in");
    await connect(editor, disp, "out", check, "value");
    const out = await engine.fetch(disp.id) as { out: unknown };
    expect(isSolError(out.out)).toBe(true);             // forwarded
    expect((out.out as SolError).code).toBe("#DIV/0!");
    expect(isSolError(disp.cachedValue)).toBe(true);    // shown in the box (not blank)
    // …and ISERROR downstream reports TRUE and remembers the code to explain it.
    const checkOut = await engine.fetch(check.id) as { result: unknown };
    expect(checkOut.result).toBe(true);
    expect(check.seenError?.code).toBe("#DIV/0!");
  });
});

describe("dependency loops (#CIRC!)", () => {
  it("loopMembers flags only the true loop, not its neighbors", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    const c = new ArithmeticNode({ op: "add" });
    const d = new ArithmeticNode({ op: "add" });
    for (const n of [a, b, c, d]) await editor.addNode(n);
    // a ⇄ b is the loop; c feeds it (upstream), d is fed by it (downstream).
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a");
    await connect(editor, c, "result", a, "b");
    await connect(editor, b, "result", d, "a");
    const loop = loopMembers(editor);
    expect(loop.has(a.id)).toBe(true);
    expect(loop.has(b.id)).toBe(true);
    expect(loop.has(c.id)).toBe(false); // upstream — computes normally
    expect(loop.has(d.id)).toBe(false); // downstream — gets the PROPAGATED #CIRC!
  });

  it("a node downstream of a loop shows the propagated #CIRC! (cache-seeding)", async () => {
    const { editor, engine } = makeEditor();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    const disp = new DisplayNode();
    const check = new IsTestNode({ op: "iserror" });
    for (const n of [a, b, disp, check]) await editor.addNode(n);
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a");      // a ⇄ b loop
    await connect(editor, b, "result", disp, "in");  // loop → Display → ISERROR
    await connect(editor, disp, "out", check, "value");
    // Replicate processGraph's seeding: pre-cache the loop members as #CIRC!.
    const circ = solError("#CIRC!", "loop");
    for (const id of loopMembers(editor)) {
      const node = editor.getNode(id)!;
      const outs: Record<string, unknown> = {};
      for (const k of Object.keys(node.outputs)) outs[k] = circ;
      engine.cache.add(id, Object.assign(Promise.resolve(outs), { cancel() {} }));
    }
    // Downstream nodes now compute against the cached error instead of deadlocking.
    const dispOut = await engine.fetch(disp.id) as { out: unknown };
    expect((dispOut.out as { code?: string }).code).toBe("#CIRC!");
    expect((disp.cachedValue as { code?: string }).code).toBe("#CIRC!"); // shown, not blank
    const checkOut = await engine.fetch(check.id) as { result: unknown };
    expect(checkOut.result).toBe(true);                     // ISERROR sees it…
    expect(check.seenError?.code).toBe("#CIRC!");         // …and can explain it
  });

  it("a node outside a loop fetches fine even though the graph contains one", async () => {
    const { editor, engine } = makeEditor();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    const free = new ArithmeticNode({ op: "add" });
    free.literals = { a: 2, b: 3 };
    await editor.addNode(a);
    await editor.addNode(b);
    await editor.addNode(free);
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a");
    // NOTE: `engine.fetch(a.id)` would HANG forever — the pull engine resolves
    // inputs before data() and deadlocks on the loop. That is precisely why
    // processGraph never fetches a cyclic node; it marks them #CIRC! directly.
    // A node outside the loop has no path into it, so it computes normally.
    const out = await engine.fetch(free.id) as { result: unknown };
    expect(out.result).toBe(5);
  });
});
