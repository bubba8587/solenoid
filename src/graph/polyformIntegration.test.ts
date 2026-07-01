import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { TableInputNode, TableReshapeNode } from "./nodes/matrix";
import { MapTableNode } from "./nodes/tableLambda";
import { ExpressionNode } from "./nodes/expression";
import { TextSplitNode } from "./nodes/text";
import { DisplayNode } from "./nodes/display";

// End-to-end polyform checks through a real editor + DataflowEngine with the
// same two wrappers Canvas installs (central input coercion + error guard).
// These cover what a bare node.data() can't: that a value flows across a
// connection into a polyform node's `any` input UN-coerced (coerceInputs only
// normalizes the numeric lattice), and that a text/date result flows back out
// on its swapped socket into a real consumer.

function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

function makeEditor() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

describe("polyform through the engine", () => {
  it("MAP turns a numeric matrix source into a text matrix", async () => {
    const { editor, engine } = makeEditor();
    const table = new TableInputNode({ tableText: "1, 2\n3, 4" });
    const map = new MapTableNode({ expr: '"r" & r & "c" & c', resultAs: "text" });
    await editor.addNode(table);
    await editor.addNode(map);
    // table (a `table` output) → MAP's `any` value input: the matrix passes
    // through coercion untouched, and the text formula maps over every cell.
    await connect(editor, table, "table", map, "table");
    const out = await engine.fetch(map.id) as { result: unknown };
    expect(out.result).toEqual([
      ["r1c1", "r1c2"],
      ["r2c1", "r2c2"],
    ]);
  });

  it("Expression broadcasts a text function over a wired string list", async () => {
    const { editor, engine } = makeEditor();
    const split = new TextSplitNode();
    split.stringLiterals = { text: "alice,bob,cara", delimiter: "," };
    const expr = new ExpressionNode({ expr: "UPPER(name)", resultAs: "text" });
    await editor.addNode(split);
    await editor.addNode(expr);
    // strlist → Expression's `any` input `name`: arrives as the raw string[]
    // (no numeric coercion), and UPPER maps element-wise.
    await connect(editor, split, "result", expr, "name");
    const out = await engine.fetch(expr.id) as { result: unknown };
    expect(out.result).toEqual(["ALICE", "BOB", "CARA"]);
  });

  it("a text Expression result flows out its swapped socket into a consumer", async () => {
    const { editor, engine } = makeEditor();
    const expr = new ExpressionNode({ expr: 'UPPER("hi")', resultAs: "text" });
    const disp = new DisplayNode();
    await editor.addNode(expr);
    await editor.addNode(disp);
    // Expression's output is now `strcombo` (text); it must connect into a
    // consumer and carry the text value through the engine.
    await connect(editor, expr, "result", disp, "in");
    const out = await engine.fetch(disp.id) as { out: unknown };
    expect(out.out).toBe("HI");
    expect(disp.cachedValue).toBe("HI");
  });

  it("a text matrix flows MAP → TOCOL → list (the reshaper completes the chain)", async () => {
    const { editor, engine } = makeEditor();
    const table = new TableInputNode({ tableText: "1, 2\n3, 4" });
    const map = new MapTableNode({ expr: '"#" & x', resultAs: "text" });
    const tocol = new TableReshapeNode({ op: "tocol" });
    await editor.addNode(table);
    await editor.addNode(map);
    await editor.addNode(tocol);
    // MAP emits a `strtable`; TOCOL's `any` input accepts it and flattens it to a
    // 1-D list of the text values — so the 2-D text result is no longer a dead end.
    await connect(editor, table, "table", map, "table");
    await connect(editor, map, "result", tocol, "matrix");
    const out = await engine.fetch(tocol.id) as { result: unknown };
    expect(out.result).toEqual(["#1", "#2", "#3", "#4"]);
  });
});
