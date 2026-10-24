// [[D93]] oneTextReading, [[C24]] arraySemantics
// The typed list literals: a list input's text as a card stores it, and how its items read. Arrival coercion itself
// is the graph core's input boundary (`crates/solenoid-graph/src/boundary.rs`, compute-pass.md § Arrival coercion).
import type { SocketDataType } from "./sockets";
import { coerceFrameCell, type FrameColType } from "./frame";
import { parseCsvLine } from "./csv";
import { csvField } from "./csvSafety";

export const TYPEABLE_LIST: ReadonlySet<string> = new Set(["strlist", "datelist", "logicallist"]);

/** A list literal's items as typed: split like CSV, trimmed, blanks dropped. */
export function listLiteralItems(csv: string): string[] {
  return parseCsvLine(csv).map((s) => s.trim()).filter((s) => s !== "");
}

/** The literal `listLiteralItems` reads back as `items`: an item holding a comma or quote is quoted (`csvField`), and items join on a bare comma, since a quote after a space doesn't open a quoted field. */
export function listLiteralText(items: readonly string[]): string {
  return items.map((s) => csvField(s, false)).join(",");
}

const LITERAL_READ: Partial<Record<SocketDataType, FrameColType>> = { numlist: "number", list: "number", datelist: "date", logicallist: "logical" };

/** Each typed item reads as a Frame cell of the list's type ([[D93]] oneTextReading). */
export function parseListLiteral(csv: string, dt: SocketDataType): unknown[] {
  const parts = listLiteralItems(csv);
  const type = LITERAL_READ[dt];
  return type ? parts.map((p) => coerceFrameCell(type, p)) : parts;
}
