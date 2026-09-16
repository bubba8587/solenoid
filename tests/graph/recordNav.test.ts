import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { RecordNode } from "../../src/graph/nodes/visual";
import { recordNavTarget } from "../../src/graph/components/recordNav";
import type { FrameValue } from "../../src/graph/frame";

// B3: the Record card popup pages with ←/→ + on-screen prev/next. recordNavTarget gates
// WHEN the pager is offered — a card view over >1 rows with an unwired Row.
const sock = new (class extends ClassicPreset.Socket {})("any");
const frameOf = (n: number): FrameValue => ({
  __frame: true,
  columns: [{ name: "Item", type: "string", values: Array.from({ length: n }, (_, i) => `r${i}`) }],
});

async function setup(op: "card" | "gallery" | "list", rows = 3) {
  const editor = new NodeEditor<Schemes>();
  const rec = new RecordNode({ op });
  await editor.addNode(rec as never);
  await rec.data({ frame: [frameOf(rows)] }); // populates cachedChart.payload.total
  setEditorRefs(editor as never, {} as never, {} as never);
  return { editor, rec };
}

describe("recordNavTarget — when the Record pager (prev/next) is offered", () => {
  it("a card view over >1 rows with Row unwired is steppable", async () => {
    const { rec } = await setup("card");
    expect(recordNavTarget(rec.id)).toBe(rec.id);
  });

  it("a gallery/list view is not steppable (it already shows every row)", async () => {
    expect(recordNavTarget((await setup("gallery")).rec.id)).toBeNull();
    expect(recordNavTarget((await setup("list")).rec.id)).toBeNull();
  });

  it("a single-row frame has nothing to flip through", async () => {
    expect(recordNavTarget((await setup("card", 1)).rec.id)).toBeNull();
  });

  it("a wired Row means the cable wins — no arrows", async () => {
    const { editor, rec } = await setup("card");
    const src = new ClassicPreset.Node("Src");
    src.addOutput("out", new ClassicPreset.Output(sock, "o"));
    await editor.addNode(src as never);
    await editor.addConnection(new ClassicPreset.Connection(src as never, "out", rec as never, "row") as never);
    expect(recordNavTarget(rec.id)).toBeNull();
  });
});
