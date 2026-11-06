// [[C10]] socketLattice, [[C58]] tableInputRawText
import { declaredTypeOf, type SocketDataType } from "./sockets";
import { coreLiteralField, coreReadDate, coreReadDecimal, coreReadLogical } from "./engineWasm";
import { solDate } from "./dateValue";
import { solError } from "./errorValue";

/** The kind a wildcard slot's keyed text is read as, picked on the card with the Frame column's type button. Number
 *  when unset. */
export type KeyedKind = "number" | "string" | "date" | "logical";

interface KeyedHost {
  /** Each keyed wildcard slot's kind, where one was picked. */
  literalKinds?: Record<string, KeyedKind>;
  stringLiterals?: Record<string, string>;
}

export function keyedKindOf(node: KeyedHost, key: string): KeyedKind {
  return node.literalKinds?.[key] ?? "number";
}

/** The type an unwired keyed slot shows, so its socket takes the toggle's color: its kind once one is picked or text
 *  is keyed, else none, and the socket keeps its base. */
export function keyedRestType(node: LiteralFieldHost, key: string): SocketDataType | undefined {
  if (literalFieldOf(node, key) !== "keyed") return undefined;
  const kind = node.literalKinds?.[key];
  if (kind) return kind;
  return node.stringLiterals?.[key] ? "number" : undefined;
}

/** A removed slot takes its keyed text and kind with it. */
export function forgetKeyed(node: KeyedHost & { literals?: Record<string, number> }, key: string): void {
  delete node.literals?.[key];
  delete node.stringLiterals?.[key];
  delete node.literalKinds?.[key];
}

/** Keyed text read as its kind by the core's readers, as `Call::keyed` reads it: blank is undefined, and text the kind
 *  can't read `#TYPE!` naming it. For a body that runs in JavaScript (Script). */
export function readKeyed(kind: KeyedKind, text: string | undefined): unknown {
  if (text === undefined || text === "") return undefined;
  if (kind === "string") return text;
  if (text.trim() === "") return undefined;
  const n = kind === "date" ? coreReadDate(text) : kind === "logical" ? coreReadLogical(text) : coreReadDecimal(text);
  if (n === undefined) return undefined;
  if (Number.isNaN(n)) {
    const name = kind === "date" ? "date" : kind === "logical" ? "logical" : "number";
    return solError("#TYPE!", `"${text}" doesn't read as a ${name}. Key in a ${name}, or switch the slot's kind`);
  }
  return kind === "date" ? solDate(n) : kind === "logical" ? n === 1 : n;
}

/** The field an unwired input shows, and so the one place its value lives and how it is read
 *  (`tree/specs/documents/inline-literal-maps.md` § One field per input). The core holds the one table
 *  (`nodes/fields.rs`): the canvas draws the field it names, a body reads the input through it (`Call::unwired`) and a
 *  load drops what it doesn't read (`pruneLiterals`), so a value can't sit in a map its card doesn't show.
 *  - `number`: the number field, `literals`. `logical`: the TRUE/FALSE checkbox, `literals` as 1 or 0.
 *  - `text`: the text field or a column picker, `stringLiterals` as keyed. `csv`: a list keyed as comma-separated text.
 *  - `keyed`: a wildcard slot's keyed text and kind button, `stringLiterals` and `literalKinds`.
 *  - `bound`: a range bound (Expect's), the number field on a number rung and a date's text on a date rung, each kind
 *    keeping its own value. `none`: wire-only. */
export type LiteralField = "number" | "logical" | "text" | "csv" | "keyed" | "bound" | "none";

/** What a row host draws: a field, with a bound shown as its rung's kind (`date`: a date keyed as text). */
export type DrawnField = Exclude<LiteralField, "bound"> | "date";

export interface LiteralFieldHost extends KeyedHost {
  inputs: Record<string, { socket?: unknown } | undefined>;
  constructor: { name: string };
}

export function literalFieldOf(node: LiteralFieldHost, key: string): LiteralField {
  const rung = declaredTypeOf(node.inputs[key]?.socket);
  if (!rung) return "none";
  const kept = node.stringLiterals !== undefined && key in node.stringLiterals;
  return coreLiteralField(node.constructor.name, key, rung, kept) as LiteralField;
}

/** The field a row host draws: a bound shows its rung's kind. */
export function drawnFieldOf(node: LiteralFieldHost, key: string): DrawnField {
  const field = literalFieldOf(node, key);
  if (field !== "bound") return field;
  return declaredTypeOf(node.inputs[key]?.socket) === "date" ? "date" : "number";
}

/** The maps a field keeps its value in. */
function mapsOfField(field: LiteralField): ReadonlyArray<"literals" | "stringLiterals"> {
  switch (field) {
    case "number": case "logical": return ["literals"];
    case "bound": return ["literals", "stringLiterals"];
    case "none": return [];
    default: return ["stringLiterals"];
  }
}

/** What a save keeps of a card's typed values. */
export interface SavedLiterals {
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  init?: { literalKinds?: unknown };
}

/** Puts a save's typed values on the card its constructor rebuilt, onto the maps its class declares ([[C28]]
 *  literalsIffEditable; after construction, or the constructor's defaults overwrite them), then drops what no field
 *  reads (`pruneLiterals`). Every restore (a load, a composite's hydrate, a paste) goes through here. */
export function restoreLiterals(node: object, saved: SavedLiterals): void {
  const n = node as Record<string, unknown>;
  if (saved.literals && typeof n.literals === "object") n.literals = { ...saved.literals };
  if (saved.stringLiterals && typeof n.stringLiterals === "object") n.stringLiterals = { ...saved.stringLiterals };
  const kinds = saved.init?.literalKinds;
  if (kinds && typeof kinds === "object" && typeof n.literalKinds === "object") n.literalKinds = { ...kinds };
  if (n.inputs && typeof n.inputs === "object") pruneLiterals(node as LiteralFieldHost & { literals?: Record<string, number> });
}

/** Drops each saved literal its input's field doesn't read, so what a card computes from is what it shows. Run on load, after the card's inputs are rebuilt. */
function pruneLiterals(node: LiteralFieldHost & { literals?: Record<string, number> }): void {
  for (const map of ["literals", "stringLiterals"] as const) {
    const m = node[map] as Record<string, unknown> | undefined;
    if (!m) continue;
    for (const key of Object.keys(m)) {
      // A key with no input belongs to the card's own fields (Script's names before its first rebuild, List Input's rows):
      // only an input's entry is judged.
      if (!(key in node.inputs)) continue;
      if (!mapsOfField(literalFieldOf(node, key)).includes(map)) delete m[key];
    }
  }
  for (const key of Object.keys(node.literalKinds ?? {})) {
    if (key in node.inputs && literalFieldOf(node, key) !== "keyed") delete node.literalKinds![key];
  }
}
