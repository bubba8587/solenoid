// [[D102]] graphOnCore, [[D99]] rustIsSpec
// A card's body on the Rust core (`crates/solenoid-core/src/nodes/`): `data()` sends the class, what a save holds,
// its sockets and its inputs, and takes back the outputs and the fields the body sets for the card's component.
// The mechanism is tree/specs/computation/node-bodies.md.
import type { ClassicPreset } from "rete";
import { extractInit } from "./nodeInit";
import { declaredTypeOf } from "./sockets";
import { engineClock } from "./coreValues";
import { nodeWire, readNodeReply, jsonDec } from "./nodeWire";
import { withMatrixUnit, type ColumnUnit } from "./unitValue";
import { wasmInvokeSync, CoreTrap } from "./engineWasm";
import { solError } from "./errorValue";

type Reply = { out?: Record<string, unknown>; thrown?: unknown; none?: true; display: Record<string, unknown>; matrixUnits?: Record<string, unknown> };

function read(r: unknown): unknown {
  const v = readNodeReply(r);
  if (!v) throw solError("#VALUE!", "The card's answer can't be read back");
  return v.value;
}

function shown(r: unknown): unknown {
  const o = r as { undef?: true } | null;
  if (o && typeof o === "object" && o.undef === true) return undefined;
  return read(r);
}

/** What a save holds, and the run-time fields the class names in `static coreFields` (a resolved mode no save keeps). */
export function coreInit(node: ClassicPreset.Node): Record<string, unknown> {
  const init = extractInit(node);
  const fields = (node.constructor as { coreFields?: readonly string[] }).coreFields;
  for (const f of fields ?? []) init[f] = (node as unknown as Record<string, unknown>)[f];
  return init;
}

/** The card's outputs as its body on the core answers them; an error the body throws is thrown, for the error guard. */
export function nodeOnCore(node: ClassicPreset.Node, inputs: Record<string, unknown[] | undefined>): Record<string, unknown> {
  const n = node as unknown as { literals?: unknown; stringLiterals?: unknown } & Record<string, unknown>;
  const wired: [string, unknown[]][] = [];
  for (const [k, arr] of Object.entries(inputs)) {
    if (!Array.isArray(arr)) continue;
    const w = arr.map(nodeWire);
    if (w.includes(undefined)) throw solError("#VALUE!", `${node.label || node.constructor.name}: an input holds a value the card can't read`);
    wired.push([k, w]);
  }
  let reply: Reply;
  try {
    reply = wasmInvokeSync<Reply>("engine_node", {
      kind: node.constructor.name,
      init: coreInit(node),
      ...(n.literals ? { literals: n.literals } : {}),
      ...(n.stringLiterals ? { stringLiterals: n.stringLiterals } : {}),
      sockets: Object.entries(node.inputs).map(([k, input]) => [k, declaredTypeOf(input?.socket) ?? null, input?.label ?? k]),
      outputs: Object.entries(node.outputs).map(([k, output]) => [k, declaredTypeOf(output?.socket) ?? null]),
      inputs: wired,
      clock: engineClock(),
    });
  } catch (e) {
    if (e instanceof CoreTrap) throw solError("#ERROR!", "The engine stopped while computing this card; it restarted, so recalculate to try again");
    throw e;
  }
  if (reply.none) throw new Error(`${node.constructor.name} has no body on the core`);
  for (const [field, v] of Object.entries(reply.display)) n[field] = shown(v);
  if ("thrown" in reply) throw read(reply.thrown);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(reply.out ?? {})) out[k] = read(v);
  for (const [k, u] of Object.entries(reply.matrixUnits ?? {})) withMatrixUnit(out[k], jsonDec(u) as ColumnUnit);
  return out;
}
