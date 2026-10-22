// [[D99]] rustIsSpec, [[D102]] graphOnCore
// FREEZE_NODES=1 records every card body's call while the suite runs: the class, its saved fields, the inputs its body
// saw (after arrival coercion), what it answered or threw, and the fields it set on itself for its component. Each
// worker appends to .dev/node-calls/<pid>.jsonl; `node scripts/freeze-nodes.mjs` folds them into fixtures/core/nodes/.
import { afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ClassicPreset } from "rete";
import type { Settings } from "../../src/graph/settingsStore";

// Imported only when recording, so a plain run's setup loads nothing of the app.
const app = process.env.FREEZE_NODES ? {
  ...(await import("rete")),
  ...(await import("../../src/graph/nodeCtorRegistry")),
  ...(await import("../../src/graph/copyPaste")),
  ...(await import("../../src/graph/sockets")),
  ...(await import("../../src/graph/coreValues")),
  ...(await import("../../src/graph/nodeWire")),
  ...(await import("../../src/graph/process")),
  ...(await import("../../src/graph/settingsStore")),
  ...(await import("../../src/graph/errorValue")),
} : null;
const { ClassicPreset: Classic, ctorRegistry, extractInit, declaredTypeOf, nodeWire, jsonEnc, engineClock, getRecalcGen, settingsStore, DEFAULT_SETTINGS, isSolError } = app ?? ({} as NonNullable<typeof app>);

const DIR = path.resolve(__dirname, "../../.dev/node-calls");
const ONLY = process.env.FREEZE_NODES === "1" ? null : new Set((process.env.FREEZE_NODES ?? "").split(","));
const PATCHED = Symbol.for("solenoid.nodeRecorder");
const g = globalThis as { [PATCHED]?: { lines: string[] } };

/** The core's wire form with the run-time error references dropped; undefined where a value can't cross. */
function wire(v: unknown): unknown {
  const w = nodeWire(v);
  return w === undefined ? undefined : JSON.parse(JSON.stringify(w, (k, x) => (k === "ref" ? undefined : x)));
}

function kindOf(v: unknown): string {
  if (Array.isArray(v)) return `list<${[...new Set(v.map(kindOf))].join("|")}>`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.__frame) return "frame";
    if (o.__frameRef || o.handle) return "frameRef";
    if (o.__cube) return "cube";
    return `object:${Object.keys(o).slice(0, 3).join(",")}`;
  }
  return typeof v;
}

const SKIP_FIELDS = new Set(["inputs", "outputs", "controls", "id", "selected", "__coerced"]);

function ownFields(node: object): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const k of Object.keys(node)) if (!SKIP_FIELDS.has(k) && typeof (node as Record<string, unknown>)[k] !== "function") m.set(k, (node as Record<string, unknown>)[k]);
  return m;
}

function changedSettings(): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = settingsStore.get(k);
    if (v !== DEFAULT_SETTINGS[k]) out[k] = v;
  }
  return out as Partial<Settings>;
}

// A class past this many distinct calls in one worker adds nothing a merge would keep, only bytes; a call made
// again (a graph recomputed) is written once.
const PER_CLASS = 2500;
const counts = new Map<string, number>();
const written = new Set<string>();

function record(lines: string[], node: ClassicPreset.Node, inputs: Record<string, unknown[]>, before: Map<string, unknown>, outcome: { out?: unknown; thrown?: unknown }): void {
  const kind = node.constructor.name;
  if (ONLY && !ONLY.has(kind)) return;
  if ((counts.get(kind) ?? 0) >= PER_CLASS) return;
  const uncrossable: string[] = [];
  const ins: Record<string, unknown[]> = {};
  for (const [k, arr] of Object.entries(inputs ?? {})) {
    if (!Array.isArray(arr)) { uncrossable.push(`in:${k}:${kindOf(arr)}`); continue; }
    const w = arr.map(wire);
    w.forEach((x, i) => { if (x === undefined) uncrossable.push(`in:${k}:${kindOf(arr[i])}`); });
    ins[k] = w;
  }
  let result: unknown;
  if ("thrown" in outcome) {
    const t = outcome.thrown;
    if (isSolError(t)) result = { thrown: wire(t) };
    else result = { thrownJs: t instanceof Error ? `${t.constructor.name}: ${t.message}` : String(t) };
  } else {
    const out = outcome.out as Record<string, unknown> | undefined;
    if (out === undefined || out === null || typeof out !== "object") result = { outRaw: out === undefined ? "undefined" : JSON.stringify(out) };
    else {
      const outs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(out)) {
        const w = wire(v);
        if (w === undefined) uncrossable.push(`out:${k}:${kindOf(v)}`);
        outs[k] = w;
      }
      result = { out: outs };
    }
  }
  const display: Record<string, unknown> = {};
  const after = ownFields(node);
  for (const [k, v] of after) {
    if (before.has(k) && Object.is(before.get(k), v)) continue;
    const w = wire(v);
    if (w === undefined && v !== undefined) {
      // A plain-JSON field (a chart's payload, a picked list) crosses as JSON; anything else is named, not frozen.
      try { display[k] = { __json: jsonEnc(v) }; } catch { uncrossable.push(`display:${k}:${kindOf(v)}`); }
    } else display[k] = w === undefined ? { __undef: 1 } : w;
  }
  for (const k of before.keys()) if (!after.has(k)) display[k] = { __deleted: 1 };
  // The fields as they stood before the call, so a replay can tell a field set to what it already held from one left
  // alone; freeze-nodes.mjs keeps only the ones some call of the class sets.
  const prior: Record<string, unknown> = {};
  const saved = extractInit(node);
  for (const [k, v] of before) {
    if (k in saved || k === "literals" || k === "stringLiterals") continue;
    const w = wire(v);
    let x: unknown = w;
    if (w === undefined) {
      if (v === undefined) x = { __undef: 1 };
      else try { x = { __json: jsonEnc(v) }; } catch { continue; }
    }
    if (JSON.stringify(x).length <= 4000) prior[k] = x;
  }
  const sockets: Record<string, [string | null, string]> = {};
  for (const [k, input] of Object.entries(node.inputs)) sockets[k] = [declaredTypeOf(input?.socket) ?? null, input?.label ?? k];
  const outputs: Record<string, string | null> = {};
  for (const [k, output] of Object.entries(node.outputs)) outputs[k] = declaredTypeOf(output?.socket) ?? null;
  // What a save holds: the init and the two literal maps.
  const json = (v: unknown): unknown => {
    try { return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? { __nf: Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf" } : x))); }
    catch { return { __unserializable: true }; }
  };
  const n = node as unknown as { literals?: unknown; stringLiterals?: unknown };
  const init = json(saved);
  const line = JSON.stringify({
    kind, init, ...(n.literals ? { literals: json(n.literals) } : {}), ...(n.stringLiterals ? { stringLiterals: json(n.stringLiterals) } : {}),
    sockets, outputs, inputs: ins, result, display, prior,
    ctx: { settings: changedSettings(), clock: engineClock(), gen: getRecalcGen() },
    ...(uncrossable.length ? { uncrossable } : {}),
  });
  // A call over a huge value (a 10⁵-item list) is counted, not kept.
  const kept = line.length > 64_000 ? JSON.stringify({ kind, uncrossable: ["oversize"] }) : line;
  const key = createHash("sha1").update(kept.replace(/"clock":\{[^}]*\},"gen":-?\d+/, "")).digest("base64");
  if (written.has(key)) return;
  written.add(key);
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  lines.push(kept);
  if (lines.length >= 2000) flush(lines);
}

function patch(lines: string[]): void {
  const inFlight = new WeakSet<object>();
  const seen = new Set<object>();
  for (const ctor of ctorRegistry().values()) {
    for (let proto = ctor.prototype; proto && proto !== Classic.Node.prototype; proto = Object.getPrototypeOf(proto)) {
      if (seen.has(proto) || !Object.prototype.hasOwnProperty.call(proto, "data")) continue;
      seen.add(proto);
      const body = proto.data as (this: ClassicPreset.Node, inputs: Record<string, unknown[]>) => unknown;
      proto.data = function (this: ClassicPreset.Node, inputs: Record<string, unknown[]>) {
        // A subclass calling super.data() is one call of the outer body.
        if (inFlight.has(this)) return body.call(this, inputs);
        const before = ownFields(this);
        inFlight.add(this);
        let out: unknown;
        try {
          out = body.call(this, inputs);
        } catch (e) {
          inFlight.delete(this);
          record(lines, this, inputs, before, { thrown: e });
          throw e;
        }
        inFlight.delete(this);
        if (out instanceof Promise) {
          return out.then(
            (v) => { record(lines, this, inputs, before, { out: v }); return v; },
            (e) => { record(lines, this, inputs, before, { thrown: e }); throw e; },
          );
        }
        record(lines, this, inputs, before, { out });
        return out;
      };
    }
  }
}

if (process.env.FREEZE_NODES && !g[PATCHED]) {
  const state = { lines: [] as string[] };
  g[PATCHED] = state;
  patch(state.lines);
}

function flush(lines: string[]): void {
  if (lines.length === 0) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.join(DIR, `${process.pid}.jsonl`), lines.join("\n") + "\n");
  lines.length = 0;
}

afterAll(() => {
  const state = g[PATCHED];
  if (state) flush(state.lines);
});
