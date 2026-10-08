// Runs a saved graph (JSON or the text form) headlessly through a real editor and engine and prints
// every node's outputs as JSON, keyed by label (else type, with a #n suffix on repeats). The strict
// validator gates the run (--force skips it). Never calls initFrameBackend, so every frame verb runs
// on the JS oracle with no Tauri dependency.
//   npx tsx scripts/run-graph.ts <graph.json|graph.txt>

import { readFileSync } from "node:fs";
import { promises as nodeFs } from "node:fs";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "../src/graph/rete-nodes";
import type { Schemes } from "../src/graph/schemes";
import { installInputCoercion } from "../src/graph/coerceInputs";
import { installErrorGuards } from "../src/graph/errorValue";
import { isFrameRef, readFrame } from "../src/graph/frameBackend";
import { computeAll } from "../src/graph/graphCompute";
import { validateGraph, validateText, formatIssues, hardIssues } from "../src/graph/graphValidate";
import { setFsProvider, type FsProvider } from "../src/graph/fileBridge";
import { settingsStore } from "../src/graph/settingsStore";
import { whenConnectionsSettled } from "../src/graph/connectionStore";

type SavedNode = {
  id: string;
  type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type SavedConnection = { source: string; sourceOutput: string; target: string; targetInput: string };
type SavedGraph = { nodes: SavedNode[]; connections: SavedConnection[] };

type NodeCtor = new (init?: Record<string, unknown>) => ClassicPreset.Node;

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
}

export async function runGraph(g: SavedGraph, opts: RunOptions = {}): Promise<Record<string, unknown>> {
  if (opts.vault) { setFsProvider(nodeFsProvider); settingsStore.set("obsidianVault", opts.vault); }
  if (opts.tasknotes) settingsStore.set("taskNotesUrl", opts.tasknotes);
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);

  const byId = new Map<string, ClassicPreset.Node>();
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
      new ClassicPreset.Connection(source, c.sourceOutput, target, c.targetInput) as Schemes["Connection"],
    );
  }

  let values = await computeAll(editor, engine);
  if (opts.vault || opts.tasknotes) {
    await whenConnectionsSettled();
    values = await computeAll(editor, engine);
  }
  if (opts.run) {
    const want = opts.run.trim().toLowerCase();
    const sink = [...byId.values()].find((n) => ((n as unknown as { label?: string }).label ?? "").trim().toLowerCase() === want) as
      (ClassicPreset.Node & { enabled?: boolean; run?: () => Promise<void>; status?: string; statusMessage?: string }) | undefined;
    if (!sink || typeof sink.run !== "function") throw new Error(`--run: no sink named "${opts.run}" in the graph.`);
    sink.enabled = true; // [[C38]] sinkRunButtonOnly: this explicit flag is the Run button
    await sink.run();
    if (sink.status === "error") throw new Error(`--run ${opts.run}: ${sink.statusMessage ?? "failed"}`);
    console.error(`${opts.run}: ${sink.statusMessage ?? sink.status ?? "ran"}`);
  }
  const seen = new Map<string, number>();
  const out: Record<string, unknown> = {};
  for (const sn of g.nodes) {
    const node = byId.get(sn.id);
    if (!node) continue;
    const label = ((node as unknown as { label?: string }).label ?? "").trim() || sn.type;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    const key = n === 1 ? label : `${label} #${n}`;
    out[key] = await resolveFrameRefs(values.get(node.id) ?? {});
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const opts: RunOptions = { vault: flag("--vault"), tasknotes: flag("--tasknotes"), run: flag("--run") };
  const consumed = new Set<string>(["--force"]);
  for (const name of ["--vault", "--tasknotes", "--run"]) { const i = args.indexOf(name); if (i >= 0) { consumed.add(args[i]); if (args[i + 1]) consumed.add(args[i + 1]); } }
  const file = args.find((a) => !consumed.has(a));
  if (!file) {
    console.error("Usage: npx tsx scripts/run-graph.ts <graph.json|graph.txt> [--force] [--vault <path>] [--tasknotes <url>] [--run <sink name>]");
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8");
  let g: SavedGraph;
  if (raw.trimStart().startsWith("{")) {
    g = JSON.parse(raw) as SavedGraph;
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
  console.log(JSON.stringify(out, null, 2));
}

// pathToFileURL, not a `file://` template, so this matches a backslashed Windows argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
