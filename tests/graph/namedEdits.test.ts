// [[D102]] graphOnCore, [[C23]] calcModes
// A full cache clear trusts each direct card's stamped call: a card's call is read afresh only when its node was
// named since (graph-core.md § Direct calls), so every edit names its node, even one manual mode holds back.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { auditNamedEdits, unnamedEdits } from "../../src/graph/engineWasm/solenoid_graph.js";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ArithmeticNode, ValueInputNode } from "../../src/graph/nodeClasses";
import { processGraph, requestRecalc, setEditorRefs } from "../../src/graph/process";
import { calcModeStore } from "../../src/graph/calcModeStore";
import { VIEW_FIELDS } from "../../src/graph/nodeInit";
import type { Schemes } from "../../src/graph/schemes";
import type { View } from "../../src/graph/view";

async function times21() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const a = new ValueInputNode({ value: "2" });
  const b = new ArithmeticNode({ op: "mul" });
  b.literals = { b: 21 };
  await editor.addNode(a as unknown as Schemes["Node"]);
  await editor.addNode(b as unknown as Schemes["Node"]);
  await editor.addConnection(new GraphConnection(a, Object.keys(a.outputs)[0], b, "a") as unknown as Schemes["Connection"]);
  expect((await engine.fetch(b.id)).result).toBe(42);
  return { editor, engine, b };
}

function withoutAudit<T>(fn: () => Promise<T>): Promise<T> {
  auditNamedEdits(false);
  return fn().finally(() => auditNamedEdits(true));
}

describe("named edits", () => {
  it("a full clear keeps a card's call; naming its node reads it afresh", () => withoutAudit(async () => {
    const { engine, b } = await times21();
    b.literals.b = 10;
    engine.reset();
    expect((await engine.fetch(b.id)).result).toBe(42);
    b.edited();
    engine.reset();
    expect((await engine.fetch(b.id)).result).toBe(20);
  }));

  it("forgetting a node, or a targeted pass naming it, reads its call afresh", () => withoutAudit(async () => {
    const { editor, engine, b } = await times21();
    b.literals.b = 10;
    engine.forget(b.id);
    expect((await engine.fetch(b.id)).result).toBe(20);
    b.literals.b = 5;
    expect((await engine.computeAll(b.id))?.get(b.id)?.result).toBe(10);
    b.literals.b = 3;
    editor.named(b.id);
    expect((await engine.computeAll())?.get(b.id)?.result).toBe(6);
  }));

  it("an edit manual mode holds back is still known to F9's full pass", () => withoutAudit(async () => {
    const { editor, engine, b } = await times21();
    setEditorRefs(editor, engine, { rerenderNode: async () => {} } as unknown as View);
    calcModeStore.setMode("manual");
    try {
      b.literals.b = 10;
      await processGraph(b.id);
      expect(engine.isCached(b.id)).toBe(true);
      await requestRecalc();
      expect(engine.landed(b.id, "result")).toBe(20);
    } finally {
      calcModeStore.setMode("auto");
    }
  }));

  it("resizing, folding or recoloring a card leaves its call as the core holds it", async () => {
    const { engine, b } = await times21();
    Object.assign(b, { width: 320, height: 140, collapsed: true, color: "teal" });
    engine.reset();
    expect((await engine.fetch(b.id)).result).toBe(42);
    expect(unnamedEdits()).toEqual([]);
  });

  it("the tests' audit catches a card changed in place with its node unnamed", async () => {
    const { engine, b } = await times21();
    b.literals.b = 10;
    engine.reset();
    expect((await engine.fetch(b.id)).result).toBe(20);
    expect(unnamedEdits()).toEqual(["ArithmeticNode ArithmeticNode"]);
  });
});

const SRC = path.resolve(__dirname, "../../src/graph");

/** The full passes a component asks for with no node changed: each names why. */
const NO_EDIT: Record<string, string> = {
  "components/ConnectionDialog.tsx": "a new cable",
  "components/ConduitComponent.tsx": "its lanes follow its cables, and a new Conduit is a new node",
};

describe("every component edit names its node", () => {
  it("a full pass a component asks for follows a node's edited()", () => {
    const misses: string[] = [];
    for (const dir of ["components", "flow"]) {
      for (const f of fs.readdirSync(path.join(SRC, dir), { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(f)) continue;
        const rel = `${dir}/${f}`;
        const lines = fs.readFileSync(path.join(SRC, rel), "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!line.includes("processGraph()")) return;
          if (lines.slice(Math.max(0, i - 12), i + 1).some((l) => /\.edited\??\.?\(\)/.test(l))) return;
          if (!(rel in NO_EDIT)) misses.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(misses).toEqual([]);
  });
});

const CORE = path.resolve(__dirname, "../../crates/solenoid-core/src");

/** Where a view field's name appears in the core as something other than a saved field, and what it is there. */
const VIEW_NAMES_ELSEWHERE: Record<string, { counts: Record<string, number>; why: string }> = {
  "nodes/text.rs": { counts: { width: 3 }, why: "the padding cards' width input" },
  "nodes/list.rs": { counts: { height: 1 }, why: "Find Peaks' height input" },
  "nodes/qr.rs": { counts: { height: 1 }, why: "a key of the image it makes" },
  "nodes/sched.rs": { counts: { color: 2 }, why: "a key of a task row on its input" },
  "nodes/visual.rs": { counts: { color: 9 }, why: "a chart option read from its inputs" },
  "nodes/widgets.rs": { counts: { color: 2, height: 1 }, why: "the color cards' output and a chart payload's key" },
};

describe("a card's call leaves out the view fields", () => {
  it("no body on the core reads a view field", () => {
    const names = new RegExp(`"(${VIEW_FIELDS.join("|")})"`, "g");
    const found: Record<string, Record<string, number>> = {};
    for (const f of fs.readdirSync(CORE, { recursive: true }) as string[]) {
      if (!f.endsWith(".rs")) continue;
      for (const m of fs.readFileSync(path.join(CORE, f), "utf8").matchAll(names)) {
        const at = (found[f.split(path.sep).join("/")] ??= {});
        at[m[1]] = (at[m[1]] ?? 0) + 1;
      }
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(VIEW_NAMES_ELSEWHERE).map(([f, e]) => [f, e.counts])));
  });
});
