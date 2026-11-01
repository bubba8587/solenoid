// [[C120]] linearWork, [[C130]] rustCore
// A standard box's read of a big list a card body on the core made takes its first rows (`listPreview.ts`,
// graph-core.md § Direct calls); every other read takes it whole.
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { SeriesNode } from "../../src/graph/nodes/list";
import { CastNode } from "../../src/graph/nodes/cast";
import { previewed, listLength, tableWidth, fullList } from "../../src/graph/listPreview";

async function texts(count: number) {
  const editor = new GraphEditor<Schemes>();
  editor.use(new DataflowEngine<Schemes>());
  const s = new SeriesNode({ op: "sequence" });
  (s as unknown as { literals: Record<string, number> }).literals = { count };
  const cast = new CastNode({ target: "text" });
  await editor.addNode(s as never);
  await editor.addNode(cast as never);
  await editor.addConnection(new GraphConnection(s, "list", cast, "value") as never);
  await editor.engine!.pass(undefined, undefined, false);
  return { editor, cast };
}

describe("a box's preview of a big list", () => {
  it("is its first rows, counted and read whole on demand", async () => {
    const { editor, cast } = await texts(20_000);
    const rows = previewed(() => cast.cachedResult) as string[];
    expect(rows).toEqual(["1", "2", "3", "4"]);
    expect(listLength(rows)).toBe(20_000);
    expect(previewed(() => cast.cachedResult)).toBe(rows);
    const whole = fullList(rows);
    expect(whole).toHaveLength(20_000);
    expect(whole[19_999]).toBe("20000");
    expect(fullList(rows)).toBe(whole);
    editor.dispose();
  });

  it("is the whole list outside a box's read, and once JavaScript holds the whole", async () => {
    const { editor, cast } = await texts(20_000);
    const whole = cast.cachedResult as string[];
    expect(whole).toHaveLength(20_000);
    expect(previewed(() => cast.cachedResult)).toBe(whole);
    editor.dispose();
  });

  it("cuts a big table to its first rows and columns, counting both whole", async () => {
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const s = new SeriesNode({ op: "sequence" });
    (s as unknown as { literals: Record<string, number> }).literals = { count: 20_000, cols: 6 };
    await editor.addNode(s as never);
    await editor.engine!.pass(undefined, undefined, false);
    const rows = previewed(() => s.cachedList) as number[][];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveLength(4);
    expect(listLength(rows)).toBe(20_000);
    expect(tableWidth(rows)).toBe(6);
    expect((fullList(rows) as number[][])[19_999]).toHaveLength(6);
    editor.dispose();
  });

  it("leaves a list under the threshold whole", async () => {
    const { editor, cast } = await texts(500);
    const v = previewed(() => cast.cachedResult) as string[];
    expect(v).toHaveLength(500);
    expect(listLength(v)).toBe(500);
    expect(fullList(v)).toBe(v);
    editor.dispose();
  });
});
