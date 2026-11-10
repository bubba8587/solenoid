// [[B19]] spreadsheetHabits, [[components#The rules]]
/** A key event as the DOM or React hands it: React's keeps the browser's own on `nativeEvent`. */
type KeyLike = { key: string; isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } };

/** Whether an input method (Japanese, Chinese, Korean…) is mid-composition, so the key confirms a candidate rather than
 *  the field. Safari ends the composition before the confirming keydown reaches a handler; keyCode 229 still marks it. */
export function composing(e: KeyLike): boolean {
  const n = e.nativeEvent ?? e;
  return n.isComposing === true || n.keyCode === 229;
}

/** Enter as a commit, submit or pick: never the Enter that confirms an input method's candidate. */
export function isEnter(e: KeyLike): boolean {
  return e.key === "Enter" && !composing(e);
}
