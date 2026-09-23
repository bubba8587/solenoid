// [[C62]] paletteAllOrNone
/** `fallbackVar` is the value type's socket color, used when there is no node context. */
export function readChipPopupStyle(
  el: HTMLElement,
  fallbackVar?: string,
): { accent?: string; groupColor?: string; groupColorDark?: string } {
  const cs = getComputedStyle(el);
  const accent =
    cs.getPropertyValue("--node-accent").trim() ||
    (fallbackVar ? cs.getPropertyValue(fallbackVar).trim() : "") ||
    undefined;
  return {
    accent,
    groupColor: cs.getPropertyValue("--group-color").trim() || undefined,
    groupColorDark: cs.getPropertyValue("--group-color-dark").trim() || undefined,
  };
}
