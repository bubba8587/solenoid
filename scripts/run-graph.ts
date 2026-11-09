// Runs a saved graph (JSON or the text form) headlessly through a real editor and engine and prints
// every node's outputs as JSON, keyed by label (else its document name, else type; a #n suffix on repeats). The strict
// validator gates the run (--force skips it). Never calls initFrameBackend, so every frame verb runs
// on the JS oracle with no Tauri dependency.
//   npm run run-graph -- <graph.json|graph.txt> [--set name=value]… [--out name]…
//   npm run run-graph -- --formula 'PMT(rate / 12, 60, 10000)' --set rate=0.05
// The JSON may be the short form shot-graph takes (`scripts/shot-graph-expand.mjs`: cables as "a.out -> b.in" strings,
// a Frame Input's `frame`). `--set` types a value into the input card of that name before the run, `--out` prints only
// the named cards, and `--formula` runs one formula, its variables set by `--set`, and prints its answer alone. A card
// is named by its document name (the text form's `Name:`) or its id, else by its label.
// What prints is plain JSON for another program to read (`plainValue`): a date as ISO text, a table as its rows, a
// value with a unit as `{value, unit}`, an error as `{error, message}`. `--raw` prints the engine's own values.
// `npm run build:cli` bundles it into dist-cli/ (run-graph.mjs + the engine's wasm), which needs only Node.

import { readFileSync, realpathSync } from "node:fs";
import { promises as nodeFs } from "node:fs";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { GraphConnection, GraphNode } from "../src/graph/graphModel";
import { DataflowEngine } from "../src/graph/dataflowEngine";
import { GraphEditor } from "../src/graph/graphEditor";
import { loadWasmEngineSync, wasmUrl } from "../src/graph/engineWasm";
import * as Nodes from "../src/graph/nodeClasses";
import type { Schemes } from "../src/graph/schemes";
import { isFrameRef, readFrame } from "../src/graph/frameBackend";
import { isFrameValue, isCubeValue, frameRowCount, type FrameColType } from "../src/graph/frame";
import { isSolDate } from "../src/graph/dateValue";
import { isSolError } from "../src/graph/errorValue";
import { isUnitCell } from "../src/graph/unitValue";
import { displayMagnitudeOf } from "../src/graph/unitBridge";
import { formatDateSerial } from "../src/graph/nodes/dateSerial";
import { computeAll } from "../src/graph/graphCompute";
import { validateGraph, validateText, formatIssues, hardIssues } from "../src/graph/graphValidate";
import { setFsProvider, type FsProvider } from "../src/graph/fileBridge";
import { settingsStore } from "../src/graph/settingsStore";
import { whenConnectionsSettled } from "../src/graph/connectionStore";
// @ts-expect-error a plain .mjs script, untyped
import { expand } from "./shot-graph-expand.mjs";

type SavedNode = {
  id: string;
  type: string;
  /** The card's name in the document, which the text form addresses it by. */
  name?: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type SavedConnection = { source: string; sourceOutput: string; target: string; targetInput: string };
type SavedGraph = { nodes: SavedNode[]; connections: SavedConnection[] };

type NodeCtor = new (init?: Record<string, unknown>) => GraphNode;

async function resolveFrameRefs(v: unknown): Promise<unknown> {
  if (isFrameRef(v)) return readFrame(v);
  if (Array.isArray(v)) return Promise.all(v.map(resolveFrameRefs));
  if (v && typeof v === "object") {
    const entries = await Promise.all(
      Object.entries(v as Record<string, unknown>).map(async ([k, val]) => [k, await resolveFrameRefs(val)] as const),
    );
    return Object.fromEntries(entries);
  }
  return v;
}

const isoDate = (serial: number): unknown =>
  Number.isFinite(serial) ? formatDateSerial(serial, Number.isInteger(serial) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss") : null;

/** A value as plain JSON another program can read, as Write File's JSON spells a frame ([[C137]] datesNeverSerials): a
 *  date as ISO text, a Frame or Cube as its rows keyed by column name, a value with a unit as `{value, unit}` in the
 *  unit it shows, an error as `{error, message}` (its code alone inside a table row). */
export function plainValue(v: unknown, type?: FrameColType): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return type === "date" ? isoDate(v) : Number.isFinite(v) ? v : null;
  if (typeof v !== "object") return v;
  if (isSolDate(v)) return isoDate(v.__date);
  if (isSolError(v)) return type ? v.code : { error: v.code, message: v.message };
  if (isUnitCell(v)) return { value: displayMagnitudeOf(v), unit: v.display ?? "" };
  if (Array.isArray(v)) return v.map((x) => plainValue(x));
  if (isFrameValue(v)) {
    return Array.from({ length: frameRowCount(v) }, (_, i) =>
      Object.fromEntries(v.columns.map((c) => [c.name, plainValue(c.values[i] ?? null, c.type)])));
  }
  if (isCubeValue(v)) {
    const rows = v.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
    return Array.from({ length: rows }, (_, i) =>
      Object.fromEntries(v.columns.map((c) => [c.name, plainValue(c.cells[i] ?? null, c.type ?? "string")])));
  }
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainValue(x)]));
}

export const nodeFsProvider: FsProvider = {
  readTextFile: (p) => nodeFs.readFile(p, "utf8"),
  readDir: async (p) => (await nodeFs.readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() })),
  writeTextFile: (p, content) => nodeFs.writeFile(p, content, "utf8"),
  rename: (from, to) => nodeFs.rename(from, to),
  mkdir: async (p, recursive) => { await nodeFs.mkdir(p, { recursive }); },
  exists: async (p) => { try { await nodeFs.access(p); return true; } catch { return false; } },
  stat: async (p) => { const st = await nodeFs.stat(p); return { mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }; },
  join: async (...parts) => nodePath.join(...parts),
  dirname: async (p) => nodePath.dirname(p),
  readBinary: async (p) => new Uint8Array(await nodeFs.readFile(p)),
  writeBinary: (p, bytes) => nodeFs.writeFile(p, bytes),
};

export interface RunOptions {
  vault?: string;
  tasknotes?: string;
  run?: string;
  /** Values typed into input cards before the run, by the card's name. */
  set?: Record<string, string>;
  /** The only cards to print, by name; every card when empty. */
  out?: string[];
}

const nameOf = (n: GraphNode, type: string) => ((n as unknown as { label?: string }).label ?? "").trim() || type;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Types `text` into the card as its editor would: a card with one typed `value` (Value Input, Slider, Dial) takes it
 *  there, a text one as text and a number one as a number. */
function setInput(node: GraphNode, name: string, text: string): void {
  const card = node as unknown as { value?: unknown };
  if (typeof card.value === "string") card.value = text;
  else if (typeof card.value === "number" && text.trim() !== "" && Number.isFinite(Number(text))) card.value = Number(text);
  else if (typeof card.value === "number") throw new Error(`--set ${name}: "${text}" isn't a number.`);
  else throw new Error(`--set ${name}: "${name}" isn't an input card with one value to set.`);
}

/** One formula as a graph of its own: an Expression card whose variables take the numbers `set` gives them. */
export function formulaGraph(expr: string, set: Record<string, string> = {}): SavedGraph {
  const literals: Record<string, number> = {};
  for (const [name, text] of Object.entries(set)) {
    if (text.trim() === "" || !Number.isFinite(Number(text))) throw new Error(`--set ${name}: a formula's variable takes a number, and "${text}" isn't one.`);
    literals[name] = Number(text);
  }
  return { nodes: [{ id: "formula", type: "ExpressionNode", init: { label: "formula", expr, literals } }], connections: [] };
}

export async function runGraph(g: SavedGraph, opts: RunOptions = {}): Promise<Record<string, unknown>> {
  if (opts.vault) { setFsProvider(nodeFsProvider); settingsStore.set("obsidianVault", opts.vault); }
  if (opts.tasknotes) settingsStore.set("taskNotesUrl", opts.tasknotes);
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);

  const byId = new Map<string, GraphNode>();
  for (const sn of g.nodes) {
    const Ctor = (Nodes as unknown as Record<string, NodeCtor>)[sn.type];
    if (typeof Ctor !== "function") {
      throw new Error(`Unknown node type "${sn.type}" (id ${sn.id}) — this build has no matching class.`);
    }
    const node = new Ctor({ ...sn.init });
    const anyNode = node as unknown as Record<string, unknown>;
    if (sn.literals) anyNode.literals = { ...sn.literals };
    if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
    byId.set(sn.id, node);
    await editor.addNode(node as unknown as Schemes["Node"]);
  }
  for (const c of g.connections) {
    const source = byId.get(c.source);
    const target = byId.get(c.target);
    if (!source || !target) {
      throw new Error(`Connection references an unknown node (${c.source} → ${c.target}).`);
    }
    await editor.addConnection(
      new GraphConnection(source, c.sourceOutput, target, c.targetInput) as Schemes["Connection"],
    );
  }

  // A card by its document name or id, else by its label, which several cards may share.
  const named = (flag: string, want: string): SavedNode[] => {
    const own = g.nodes.filter((sn) => sameName(sn.name ?? "", want) || sameName(sn.id, want));
    const hits = own.length ? own : g.nodes.filter((sn) => sameName(nameOf(byId.get(sn.id)!, sn.type), want));
    if (hits.length === 0) throw new Error(`${flag} ${want}: no card has that name.`);
    return hits;
  };
  for (const [name, text] of Object.entries(opts.set ?? {})) {
    const hits = named("--set", name);
    if (hits.length !== 1) throw new Error(`--set ${name}: ${hits.length} cards share that name.`);
    setInput(byId.get(hits[0].id)!, name, text);
  }
  const printed = opts.out?.length ? new Set(opts.out.flatMap((want) => named("--out", want)).map((sn) => sn.id)) : null;

  let values = await computeAll(editor, engine);
  if (opts.vault || opts.tasknotes) {
    await whenConnectionsSettled();
    values = await computeAll(editor, engine);
  }
  if (opts.run) {
    const want = opts.run.trim().toLowerCase();
    const sink = [...byId.values()].find((n) => ((n as unknown as { label?: string }).label ?? "").trim().toLowerCase() === want) as
      (GraphNode & { enabled?: boolean; run?: () => Promise<void>; status?: string; statusMessage?: string }) | undefined;
    if (!sink || typeof sink.run !== "function") throw new Error(`--run: no sink named "${opts.run}" in the graph.`);
    sink.enabled = true; // [[B18]] safeToShare: this explicit flag is the Run button
    await sink.run();
    if (sink.status === "error") throw new Error(`--run ${opts.run}: ${sink.statusMessage ?? "failed"}`);
    console.error(`${opts.run}: ${sink.statusMessage ?? sink.status ?? "ran"}`);
  }
  const seen = new Map<string, number>();
  const out: Record<string, unknown> = {};
  for (const sn of g.nodes) {
    const node = byId.get(sn.id);
    if (!node) continue;
    const label = ((node as unknown as { label?: string }).label ?? "").trim() || sn.name || sn.type;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    const key = n === 1 ? label : `${label} #${n}`;
    if (printed && !printed.has(sn.id)) continue;
    out[key] = await resolveFrameRefs(values.get(node.id) ?? {});
  }
  return out;
}

async function main() {
  // Before validating: the validator builds every node to learn its type, and a node needs the engine.
  loadWasmEngineSync(readFileSync(wasmUrl));
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  // A flag takes the word after it; `--set` and `--out` may repeat.
  const flags: Record<string, string[]> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force" || a === "--raw") continue;
    if (["--vault", "--tasknotes", "--run", "--set", "--out", "--formula"].includes(a)) {
      if (args[i + 1] === undefined) throw new Error(`${a} needs a value after it.`);
      (flags[a] ??= []).push(args[++i]);
    } else rest.push(a);
  }
  const set: Record<string, string> = {};
  for (const pair of flags["--set"] ?? []) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new Error(`--set ${pair}: write it as name=value.`);
    set[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
  const opts: RunOptions = { vault: flags["--vault"]?.[0], tasknotes: flags["--tasknotes"]?.[0], run: flags["--run"]?.[0], set, out: flags["--out"] ?? [] };
  const print = (v: unknown) => console.log(JSON.stringify(args.includes("--raw") ? v : plainValue(v), null, 2));
  const formula = flags["--formula"]?.[0];
  if (formula !== undefined) {
    const out = await runGraph(formulaGraph(formula, set), { ...opts, set: {}, out: [] });
    print((out["formula"] as { result?: unknown }).result ?? null);
    return;
  }
  const file = rest[0];
  if (!file) {
    console.error("Usage: npm run run-graph -- <graph.json|graph.txt> [--force] [--raw] [--set name=value]… [--out name]… [--vault <path>] [--tasknotes <url>] [--run <sink name>]\n       npm run run-graph -- --formula '<formula>' [--set name=number]… [--raw]");
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8");
  let g: SavedGraph;
  if (raw.trimStart().startsWith("{")) {
    g = expand(JSON.parse(raw)) as SavedGraph;
    const hard = hardIssues(validateGraph(g as Parameters<typeof validateGraph>[0]));
    if (hard.length > 0 && !force) {
      console.error(formatIssues(hard));
      console.error(`\n${file}: ${hard.length} issue${hard.length === 1 ? "" : "s"} — not running (pass --force to run anyway).`);
      process.exit(1);
    }
  } else {
    const { issues, graph } = validateText(raw);
    const hard = hardIssues(issues);
    if ((hard.length > 0 && !force) || !graph) {
      console.error(formatIssues(hard));
      console.error(`\n${file}: ${hard.length} issue${hard.length === 1 ? "" : "s"} — not running${graph ? " (pass --force to run anyway)" : ""}.`);
      process.exit(1);
    }
    g = graph as unknown as SavedGraph;
  }
  const out = await runGraph(g, opts);
  print(out);
}

// pathToFileURL, not a `file://` template, so this matches a backslashed Windows argv[1]; realpath, so it matches
// when launched through a symlink, as npm's bin links do.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
