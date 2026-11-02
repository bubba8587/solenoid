// [[A1]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { RecordNode } from "../../src/graph/nodes/visual";
import { recordNavTarget } from "../../src/graph/components/recordNav";
import type { RecordPayload } from "../../src/graph/chartValue";
import type { FrameValue } from "../../src/graph/frame";

// B3: the Record card popup pages with ←/→ + on-screen prev/next. recordNavTarget gates
// WHEN the pager is offered: a Detail view whose picked rows number more than one.
const sock = new (class extends GraphSocket {})("any");
const frameOf = (n: number): FrameValue => ({
  __frame: true,
  columns: [{ name: "Item", type: "string", values: Array.from({ length: n }, (_, i) => `r${i}`) }],
});

async function setup(op: "detail" | "gallery" | "list", rows = 3) {
  const editor = new GraphEditor<Schemes>();
  const rec = new RecordNode({ op });
  await editor.addNode(rec as never);
  await rec.data({ frame: [frameOf(rows)] }); // populates cachedChart.payload.total
  setEditorRefs(editor as never, {} as never, {} as never);
  return { editor, rec };
}

describe("recordNavTarget — when the Record pager (prev/next) is offered", () => {
  it("a Detail view over >1 rows with Row unwired is steppable", async () => {
    const { rec } = await setup("detail");
    expect(recordNavTarget(rec.id)).toBe(rec.id);
  });

  it("a gallery or list view is not steppable (it already shows every row)", async () => {
    expect(recordNavTarget((await setup("gallery")).rec.id)).toBeNull();
    expect(recordNavTarget((await setup("list")).rec.id)).toBeNull();
  });

  it("a single-row frame has nothing to flip through", async () => {
    expect(recordNavTarget((await setup("detail", 1)).rec.id)).toBeNull();
  });

  it("the pager steps its own page: Rows picks the set it steps through, so a wired list still pages", async () => {
    const { editor, rec } = await setup("detail", 5);
    const src = new GraphNode("Src");
    src.addOutput("out", new GraphOutput(sock, "o"));
    await editor.addNode(src as never);
    await editor.addConnection(new GraphConnection(src as never, "out", rec as never, "rows") as never);
    await rec.data({ frame: [frameOf(5)], rows: [[2, 4]] });
    expect(recordNavTarget(rec.id)).toBe(rec.id);
    await rec.data({ frame: [frameOf(5)], rows: [3] });
    expect(recordNavTarget(rec.id)).toBeNull(); // one pick: nothing to step through
  });
});

describe("Detail's filter (the popup's Filter field)", () => {
  const people: FrameValue = {
    __frame: true,
    columns: [
      { name: "Name", type: "string", values: ["Ada Lovelace", "Alan Turing", "Grace Hopper"] },
      { name: "Born", type: "number", values: [1815, 1912, 1906] },
    ],
  };
  const pageWith = async (query: string, page = 1) => {
    const rec = new RecordNode({ op: "detail" });
    rec.stringLiterals.query = query;
    rec.literals.page = page;
    await rec.data({ frame: [people] });
    return rec.cachedChart!.payload as RecordPayload;
  };

  it("pages through the records holding every word, caseless, numbers as shown", async () => {
    const p = await pageWith("19");
    expect([p.total, p.filtered]).toEqual([2, true]);
    expect((await pageWith("GRACE 1906")).total).toBe(1);
    expect((await pageWith("19", 2)).cards[0][0].value).toBe("Grace Hopper");
  });

  it("no match draws nothing to page; a blank filter is every record", async () => {
    expect((await pageWith("zzz")).total).toBe(0);
    const all = await pageWith("  ");
    expect([all.total, all.filtered]).toEqual([3, undefined]);
  });
});
