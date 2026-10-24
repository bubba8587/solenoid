// [[C17]], [[C48]] appendLadder

export type SkipCells = "none" | "blanks" | "errors" | "both";
/** Excel's `ignore` codes: 0 keeps every value, 1 skips blanks, 2 errors, 3 both. */
export const SKIP_BY_CODE: readonly SkipCells[] = ["none", "blanks", "errors", "both"];
