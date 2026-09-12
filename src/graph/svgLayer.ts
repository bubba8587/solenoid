// "Which layer did you click?" for the SVG Picker node. Kept DOM-agnostic (the tiny
// `SvgLike` surface) so it unit-tests with no jsdom.

// Name-bearing attributes in priority order, so a readable human label beats a
// machine id when an authoring tool wrote both.
const NAME_ATTRS = ["inkscape:label", "data-name", "aria-label", "id"] as const;

/** The minimal element surface the resolver walks — satisfied by DOM `Element`. */
export interface SvgLike {
  getAttribute(name: string): string | null;
  parentElement: SvgLike | null;
}

/** The first present, non-blank name attribute on an element, or null. */
export function elementName(el: SvgLike): string | null {
  for (const attr of NAME_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Itself if named, else the nearest named ancestor, stopping at and EXCLUDING
 *  `root`; null when nothing up the chain is named. */
export function resolveLayer<T extends SvgLike>(target: T, root: T): { el: T; name: string } | null {
  let el: T | null = target;
  while (el && el !== root) {
    const name = elementName(el);
    if (name) return { el, name };
    el = el.parentElement as T | null;
  }
  return null;
}

/** Whether the SOURCE text still names `name` on some element (the same attributes the
 *  resolver reads), so a persisted pick never outlives the picture it was made on. Text-level
 *  on purpose: the headless graph has no DOM. */
export function sourceHasLayer(source: string, name: string): boolean {
  if (!name) return false;
  const re = /\b(?:inkscape:label|data-name|aria-label|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of source.matchAll(re)) if ((m[1] ?? m[2] ?? "").trim() === name) return true;
  return false;
}

/** Just the resolved layer name (see resolveLayer), or null. */
export function resolveLayerName(target: SvgLike, root: SvgLike): string | null {
  return resolveLayer(target, root)?.name ?? null;
}
