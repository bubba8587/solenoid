// [[C10]] socketLattice, [[C58]] tableInputRawText
import type { SocketDataType } from "./sockets";
import { coreReadDate, coreReadDecimal, coreReadLogical } from "./engineWasm";
import { solDate } from "./dateValue";
import { solError } from "./errorValue";

/** The kind a wildcard slot's keyed text is read as, picked on the card with the Frame column's type button. Number
 *  when unset. */
export type KeyedKind = "number" | "string" | "date" | "logical";

export interface KeyedHost {
  autoLiterals?: boolean;
  /** Each keyed wildcard slot's kind, where one was picked. */
  literalKinds?: Record<string, KeyedKind>;
  stringLiterals?: Record<string, string>;
}

/** The wildcard rungs a keyed literal can stand in for: one value, so `anycombo` too, never a list or a table. */
export function isKeyedWildcard(dt: string | undefined): boolean {
  return dt === "any" || dt === "anycombo" || dt === "anydata" || dt === "trueany";
}

export function keyedKindOf(node: KeyedHost, key: string): KeyedKind {
  return node.literalKinds?.[key] ?? "number";
}

/** The type an unwired keyed slot shows, so its socket takes the toggle's color: its kind once one is picked or text
 *  is keyed, else none, and the socket keeps its base. */
export function keyedRestType(node: KeyedHost, key: string, base: SocketDataType): SocketDataType | undefined {
  if (!node.autoLiterals || !isKeyedWildcard(base)) return undefined;
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
