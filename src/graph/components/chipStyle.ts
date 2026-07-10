/**
 * Inherit the host node's (or group's) accent + group color off the live DOM so
 * a popup opened from a chip matches the node it came from — header tint, and
 * (when grouped) the border + corner triangle, like the Formula popup. These
 * vars are set on the card / group root and cascade to the chip. `fallbackVar`
 * is the value TYPE's socket colour (`--sock-list`, `--sock-frame`, …) so a
 * chip opened with no node context (e.g. inline in a Report) still gets the
 * standard coloured header instead of a bare one.
 */
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
