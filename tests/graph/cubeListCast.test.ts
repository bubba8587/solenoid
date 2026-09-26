// [[D80]] cubeColumnTypes
import { it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { ListIndexNode } from "../../src/graph/nodes/list";
import { CubeInputNode } from "../../src/graph/nodes/cube";
import { CastNode } from "../../src/graph/nodes/cast";
const connect = (e: NodeEditor<Schemes>, a: ClassicPreset.Node, ao: string, b: ClassicPreset.Node, bi: string) => e.addConnection(new ClassicPreset.Connection(a, ao, b, bi) as Schemes["Connection"]);
// A list mixing kinds in an untyped column claims no kind; Cast reads it item by item.
it("a mixed list cell from a cube passes through Cast, item by item", async () => {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>(); editor.use(engine);
  const cube = new CubeInputNode({ cubeText: '[{"a":"x","l":[5,7,"seven"]}]' });
  const idx = new ListIndexNode(); idx.literals.index = 1; idx.literals.column = 2;
  const cast = new CastNode({ target: "number" });
  for (const n of [cube, idx, cast]) await editor.addNode(n);
  await connect(editor, cube, "cube", idx, "list");
  await connect(editor, idx, "result", cast, "value");
  expect((await engine.fetch(idx.id) as { result: unknown }).result).toEqual([5, 7, "seven"]);
  const out = (await engine.fetch(cast.id) as { result: unknown[] }).result;
  expect(out.slice(0, 2)).toEqual([5, 7]);
  expect(out[2]).toMatchObject({ code: "#VALUE!" });
});
