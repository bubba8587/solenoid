// A node whose string literal names a COLUMN of an incoming frame declares it once via
// `columnPickers()` — which literal key holds the name, and which frame INPUT socket the
// name is a column of. The shared card control (components/ColumnPickerField) reads this to
// offer that frame's column names (from the static frameShapeResolver) with a free-text
// fallback; the socket/literal model is unchanged (it writes the same string literal). This
// is the display sibling of `frameShape()` (frameShapeHook.ts) — declare both together.

/** One column-name literal and the frame input it names a column of. */
export interface ColumnPickerSpec {
  /** The `stringLiterals` key holding the column name (e.g. "column", "leftKey"). */
  key: string;
  /** The frame INPUT socket key whose columns the picker lists (e.g. "frame", "left"). */
  frameInput: string;
}

interface HasColumnPickers {
  columnPickers(): ColumnPickerSpec[];
}

/** A node's declared column pickers, or [] — duck-typed like `frameShapeOf`. */
export function columnPickersOf(n: unknown): ColumnPickerSpec[] {
  const f = (n as Partial<HasColumnPickers> | null)?.columnPickers;
  return typeof f === "function" ? f.call(n) : [];
}
