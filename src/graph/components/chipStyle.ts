/** Reads the host card's accent/group vars off the live DOM so a chip's popup matches
 *  the node it came from; `fallbackVar` is the value TYPE's socket color, used when
 *  there is no node context. */
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
