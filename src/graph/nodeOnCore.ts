// [[D102]] graphOnCore, [[D99]] rustIsSpec
// A card's body on the Rust core (`crates/solenoid-core/src/nodes/`): `data()` sends the class, what a save holds,
// its sockets and its inputs, and takes back the outputs and the fields the body sets for the card's component.
// The mechanism is tree/specs/computation/node-bodies.md.
import type { GraphNode } from "./graphModel";
import { extractInit } from "./nodeInit";
import { declaredTypeOf, AdoptiveSocket } from "./sockets";
import { engineClock } from "./coreValues";
import { nodeWire, readNodeReply, jsonDec, jsonEnc } from "./nodeWire";
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

/** The type an adoptive socket took up, where it differs from the one it was declared at. */
export function adopted(socket: unknown): string[] {
  const now = (socket as { dataType?: string } | undefined)?.dataType;
  return socket instanceof AdoptiveSocket && now !== undefined && now !== socket.base ? [now] : [];
}

/** What a save holds, and the run-time fields the class names in `static coreFields` (a resolved mode no save keeps). */
export function coreInit(node: GraphNode): Record<string, unknown> {
  const init = extractInit(node);
  const fields = (node.constructor as { coreFields?: readonly string[] }).coreFields;
  for (const f of fields ?? []) init[f] = (node as unknown as Record<string, unknown>)[f];
  return init;
}

/** The card's outputs as its body on the core answers them; an error the body throws is thrown, for the error guard. */
export function nodeOnCore(node: GraphNode, inputs: Record<string, unknown[] | undefined>): Record<string, unknown> {
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
      init: jsonEnc(coreInit(node)),
      ...(n.literals ? { literals: jsonEnc(n.literals) } : {}),
      ...(n.stringLiterals ? { stringLiterals: jsonEnc(n.stringLiterals) } : {}),
      sockets: Object.entries(node.inputs).map(([k, input]) => [k, declaredTypeOf(input?.socket) ?? null, input?.label ?? k, ...adopted(input?.socket)]),
      outputs: Object.entries(node.outputs).map(([k, output]) => [k, declaredTypeOf(output?.socket) ?? null, ...adopted(output?.socket)]),
      inputs: wired,
      clock: engineClock(),
    });
  } catch (e) {
    if (e instanceof CoreTrap) throw solError("#ERROR!", "The engine stopped while computing this card; it restarted, so recalculate to try again");
    throw e;
  }
  if (reply.none) throw new Error(`${node.constructor.name} has no body on the core`);
  if ("thrown" in reply) {
    for (const [field, v] of Object.entries(reply.display)) n[field] = shown(v);
    throw read(reply.thrown);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(reply.out ?? {})) {
    // An output that is one of the inputs as it came is that very object (`Outs` in nodes/mod.rs).
    const from = (v as { input?: [string, number] } | null)?.input;
    out[k] = Array.isArray(from) ? inputs[from[0]]?.[from[1]] : read(v);
  }
  // A field that is an output itself comes back as that output, the same object, as the TS body set it.
  for (const [field, v] of Object.entries(reply.display)) {
    const o = v as { output?: string } | null;
    n[field] = o && typeof o === "object" && typeof o.output === "string" ? out[o.output] : shown(v);
  }
  for (const [k, u] of Object.entries(reply.matrixUnits ?? {})) {
    const unit = jsonDec(u) as ColumnUnit;
    if (k.startsWith("display:")) withMatrixUnit(n[k.slice("display:".length)], unit);
    else withMatrixUnit(out[k], unit);
  }
  return out;
}
