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

/** Just the resolved layer name (see resolveLayer), or null. */
export function resolveLayerName(target: SvgLike, root: SvgLike): string | null {
  return resolveLayer(target, root)?.name ?? null;
}
