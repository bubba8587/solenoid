// The AI palette's DEMO transport. The fake sits at the TRANSPORT seam (a fetch answering
// like the Messages API), so every production layer above it runs for real.

import { readTextForm, writeTextForm } from "./textForm";
import type { SavedGraph, SavedNode, SavedConnection } from "./persistence";

/** The magic "key" that routes `aiService` onto this transport. */
export const DEMO_KEY = "demo";

const QUESTION_RE = /(\?\s*$)|^(what|how|why|which|who|where|when|does|do|is|are|can|show me)\b/i;

interface DemoNode {
  name: string;
  type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  /** Column offset within the stage (× the node pitch). */
  col: number;
  row?: number;
}

const SALES_FRAME =
  '[{"name":"Product","type":"string","values":["Widget","Gadget","Doohickey","Widget","Gadget","Doohickey"]},' +
  '{"name":"Region","type":"string","values":["North","North","North","South","South","South"]},' +
  '{"name":"Units","type":"number","values":[120,80,45,95,60,30]},' +
  '{"name":"Price","type":"number","values":[9.5,14,22,9.5,14,22]}]';

interface Stage {
  /** The stage is DONE when this node already exists. */
  marker: string;
  blurb: string;
  nodes: DemoNode[];
  connections: SavedConnection[];
}

const STAGES: Stage[] = [
  {
    marker: "DemoSales",
    blurb: "Added a sales table with a computed Revenue column.",
    nodes: [
      { name: "DemoSales", type: "FrameInputNode", init: { label: "Sales", frameText: SALES_FRAME }, col: 0 },
      { name: "DemoRevenue", type: "ComputedColumnNode", init: { label: "Revenue", expr: "@Units * @Price" }, stringLiterals: { name: "Revenue", after: "" }, col: 1 },
      { name: "DemoTable", type: "DisplayNode", init: { label: "Sales with revenue" }, col: 2 },
    ],
    connections: [
      { source: "DemoSales", sourceOutput: "frame", target: "DemoRevenue", targetInput: "frame" },
      { source: "DemoRevenue", sourceOutput: "frame", target: "DemoTable", targetInput: "in" },
    ],
  },
  {
    marker: "DemoByRegion",
    blurb: "Added revenue totals by region.",
    nodes: [
      { name: "DemoRegionKey", type: "TextInputNode", init: { label: "Group key", value: "Region" }, col: 1, row: 1 },
      { name: "DemoByRegion", type: "GroupByFrameNode", init: { label: "Revenue by region", op: "sum" }, stringLiterals: { column: "Revenue" }, col: 2, row: 1 },
      { name: "DemoTotals", type: "DisplayNode", init: { label: "Totals" }, col: 3, row: 1 },
    ],
    connections: [
      { source: "DemoRevenue", sourceOutput: "frame", target: "DemoByRegion", targetInput: "frame" },
      { source: "DemoRegionKey", sourceOutput: "value", target: "DemoByRegion", targetInput: "keys" },
      { source: "DemoByRegion", sourceOutput: "frame", target: "DemoTotals", targetInput: "in" },
    ],
  },
  {
    marker: "DemoChart",
    blurb: "Added a column chart of the regional totals.",
    nodes: [
      { name: "DemoChart", type: "ChartNode", init: { label: "Revenue by region", op: "column" }, col: 3, row: 2 },
    ],
    connections: [
      { source: "DemoByRegion", sourceOutput: "frame", target: "DemoChart", targetInput: "values" },
    ],
  },
];

const PITCH_X = 300;
const PITCH_Y = 230;

/** Prose or a fenced rewrite — the demo model's raw reply for one prompt. */
export function demoReply(prompt: string, currentText: string): string {
  let current: SavedGraph;
  try {
    current = readTextForm(currentText);
  } catch {
    current = { v: 2, nodes: [], connections: [] };
  }

  if (QUESTION_RE.test(prompt.trim())) return describeDocument(current);

  const have = new Set(current.nodes.map((n) => n.name ?? n.id));
  const stage = STAGES.find((s) => !have.has(s.marker));
  if (!stage) {
    return (
      "The demo build is complete: a sales table, a computed Revenue column, " +
      "regional totals, and a chart. Ask a question about the document, or " +
      "start a new document to run the build again."
    );
  }

  // New nodes land to the RIGHT of everything already on the canvas.
  const baseX = current.nodes.length > 0 ? Math.max(...current.nodes.map((n) => n.x)) + PITCH_X : 40;
  const baseY = current.nodes.length > 0 ? Math.min(...current.nodes.map((n) => n.y)) : 40;

  const nodes: SavedNode[] = [
    ...current.nodes,
    ...stage.nodes.map((d) => {
      const sn: SavedNode = {
        id: d.name,
        type: d.type,
        name: d.name,
        x: baseX + (d.col - stage.nodes[0].col) * PITCH_X,
        y: baseY + (d.row ?? 0) * PITCH_Y,
        init: d.init ?? {},
      };
      if (d.literals) sn.literals = d.literals;
      if (d.stringLiterals) sn.stringLiterals = d.stringLiterals;
      return sn;
    }),
  ];
  const g: SavedGraph = {
    ...current,
    nodes,
    connections: [...current.connections, ...stage.connections],
  };
  return `${stage.blurb}\n\`\`\`solenoid\n${writeTextForm(g)}\`\`\``;
}

function describeDocument(g: SavedGraph): string {
  if (g.nodes.length === 0) {
    return "The document is empty. Ask for anything and the demo will start building a small sales dashboard.";
  }
  const counts = new Map<string, number>();
  for (const n of g.nodes) {
    const kind = n.type.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, c]) => (c === 1 ? `1 ${kind}` : `${c} ${kind}s`));
  return (
    `The document has ${g.nodes.length} node${g.nodes.length === 1 ? "" : "s"} ` +
    `(${parts.join(", ")}) wired by ${g.connections.length} cable${g.connections.length === 1 ? "" : "s"}. ` +
    `This is the demo assistant; edit requests add the next slice of the demo dashboard.`
  );
}

const DOC_RE = /```solenoid\n([\s\S]*?)```/;
const PROMPT_RE = /Request: ([\s\S]*)$/;

/** Answers like `POST /v1/messages`; the delay keeps the palette's busy state visible
 *  so the demo reads as a round trip. */
export function makeDemoFetch(delayMs = 600): typeof globalThis.fetch {
  return async (_input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    let prompt = "";
    let doc = "---\n{ \"v\": 2 }\n";
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ content?: unknown }> };
      const first = parsed.messages?.[0]?.content;
      if (typeof first === "string") {
        doc = DOC_RE.exec(first)?.[1] ?? doc;
        prompt = PROMPT_RE.exec(first)?.[1] ?? "";
      }
    } catch {
      /* an unparseable body gets the empty-doc default */
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(
      JSON.stringify({
        id: "msg_demo",
        type: "message",
        role: "assistant",
        model: "demo",
        content: [{ type: "text", text: demoReply(prompt, doc) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
