// [[C120]] linearWork, [[C130]] rustCore
// Timing, not a check: whole passes as the app runs them (`engine.pass`, then `landed` for the read a card's box makes),
// over chains of cards at 800,000 items. This is the bench for "is the app fast": a card's `data()` or `nodeOnCore`
// called from JS is a path the pass doesn't take between direct cards (graph-core.md § Direct calls).
// `BENCH=1 npx vitest run tests/graph/passBench.test.ts` prints the table, and BENCH_OUT=<file> writes it there (BENCH_ITEMS for another size).
import { describe, it } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { TextTransformNode, TextLenNode } from "../../src/graph/nodes/text";
import { SeriesNode, SortNode } from "../../src/graph/nodes/list";
import { CastNode } from "../../src/graph/nodes/cast";
import { listOut } from "../../src/graph/nodes/shared";
import * as Nodes from "../../src/graph/nodeClasses";
import { computeAll } from "../../src/graph/graphCompute";
import speedSeed from "../../src/graph/seedGraphs/engine-speed-test.json";

const N = Number(process.env.BENCH_ITEMS ?? 800_000);
const words = Array.from({ length: N }, (_, i) => `item ${i} straße`);

class WordsNode extends GraphNode {
  constructor() { super("Words"); this.addOutput("list", listOut("List")); }
  data() { return { list: words }; }
}

async function build(chain: GraphNode[], into?: string[]) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of chain) await editor.addNode(n as unknown as Schemes["Node"]);
  for (let i = 1; i < chain.length; i++) {
    const out = Object.keys(chain[i - 1].outputs)[0], inp = into?.[i - 1] ?? Object.keys(chain[i].inputs)[0];
    await editor.addConnection(new GraphConnection(chain[i - 1], out, chain[i], inp) as Schemes["Connection"]);
  }
  return { editor, engine };
}

async function time(run: () => Promise<unknown>, reps = 3) {
  await run(); let best = Infinity;
  for (let i = 0; i < reps; i++) { const t = performance.now(); await run(); best = Math.min(best, performance.now() - t); }
  return best;
}

describe.skipIf(!process.env.BENCH)("passes", () => {
  it("times", async () => {
    const rows: string[] = [];
    const line = (k: string, ms: number) => rows.push(`${k.padEnd(44)} ${ms.toFixed(1)} ms`);
    const series = () => { const s = new SeriesNode({ op: "sequence" }); (s as unknown as { literals: Record<string, number> }).literals = { count: N }; return s; };
    const cases: [string, () => GraphNode[]][] = [
      ["JS words -> UPPER", () => [new WordsNode(), new TextTransformNode({ op: "upper" })]],
      ["JS words -> UPPER -> LOWER -> LEN", () => [new WordsNode(), new TextTransformNode({ op: "upper" }), new TextTransformNode({ op: "lower" }), new TextLenNode()]],
      ["Series -> Cast", () => [series(), new CastNode({ op: "text" })]],
      ["Series -> Cast -> UPPER", () => [series(), new CastNode({ op: "text" }), new TextTransformNode({ op: "upper" })]],
      ["Series -> Cast -> UPPER -> LOWER -> LEN", () => [series(), new CastNode({ op: "text" }), new TextTransformNode({ op: "upper" }), new TextTransformNode({ op: "lower" }), new TextLenNode()]],
      ["Series -> Sort", () => [series(), new SortNode({ order: "desc" } as never)]],
    ];
    for (const [name, make] of cases) {
      const chain = make();
      const { engine } = await build(chain);
      line(`${name}: pass`, await time(() => engine.pass(undefined, undefined, true)));
      const last = chain[chain.length - 1];
      const key = Object.keys(last.outputs)[0];
      line(`${name}: pass + read last to JS`, await time(async () => { await engine.pass(undefined, undefined, true); const v = engine.landed(last.id, key) as unknown[]; if (!Array.isArray(v) || v.length !== N) throw new Error(`bad ${String(v).slice(0, 80)}`); }));
    }
    // The engine-speed-test seed's composite, its cards wired as one chain at N rows: model passes as the app runs them.
    type Saved = { id: string; type: string; init?: Record<string, unknown>; stringLiterals?: Record<string, string> };
    const inner = (speedSeed.nodes.find((n) => n.type === "CompositeNode") as unknown as { init: { internal: { nodes: Saved[] } } }).init.internal.nodes
      .filter((n) => !n.type.startsWith("Composite"));
    const chain = inner.map((sn) => {
      const node = new (Nodes as unknown as Record<string, new (i?: unknown) => GraphNode>)[sn.type]({ ...sn.init });
      if (sn.stringLiterals) (node as unknown as { stringLiterals: Record<string, string> }).stringLiterals = { ...sn.stringLiterals };
      return node;
    });
    (chain[0] as unknown as { literals: Record<string, number> }).literals = { count: N };
    const seed = await build(chain, (speedSeed.nodes.find((n) => n.type === "CompositeNode") as unknown as { init: { internal: { connections: { target: string; targetInput: string }[] } } })
      .init.internal.connections.filter((c) => c.target !== "m_totals").map((c) => c.targetInput).slice(1));
    const sort = chain[chain.length - 1] as unknown as { cachedResult: { columns: { values: unknown[] }[] } };
    line("speed seed: computeAll", await time(() => computeAll(seed.editor, seed.engine)));
    line("speed seed: edit Series, pass", await time(async () => {
      (chain[0] as unknown as { literals: Record<string, number> }).literals = { count: N };
      chain[0].edited();
      await seed.engine.pass(chain[0].id, undefined, false);
      if (sort.cachedResult?.columns?.[0]?.values?.length !== 5) throw new Error(`bad seed answer ${JSON.stringify(sort.cachedResult).slice(0, 300)}`);
    }));
    const table = `\n${N} items, best of 3\n` + rows.join("\n") + "\n";
    // Vitest holds a test's console output back; BENCH_OUT=<file> writes the table there too.
    if (process.env.BENCH_OUT) (await import("node:fs")).appendFileSync(process.env.BENCH_OUT, table);
    console.log(table);
  }, 600_000);
});
