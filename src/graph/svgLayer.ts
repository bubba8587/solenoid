// ─── SVG layer resolution ─────────────────────────────────────────────────────
// The pure "which layer did you click?" logic behind the SVG Picker node. Clicking
// a shape resolves to a NAME: the element's own name attribute if it has one, else
// the nearest named ancestor (walking up, stopping at the root <svg>). That name is
// what the node outputs — wire it into a Filter to slice a dataset by the region.
//
// SVGs name things a few ways depending on the authoring tool: Inkscape writes an
// `inkscape:label` on layers, hand-authored / Illustrator SVGs use `id`, and some
// use `data-name` / `aria-label`. We check them in a human-name-first order so a
// readable label (matching a data key) wins over a machine id when both exist.
//
// Kept DOM-agnostic (operates on a tiny `SvgLike` surface) so it unit-tests in the
// node vitest env with no jsdom — real DOM `Element`s satisfy the interface too.

// Name-bearing attributes, in priority order (human label first, id last).
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

/**
 * Resolve the clicked element to its named layer: itself if named, else the
 * nearest named ancestor, stopping at (and EXCLUDING) `root` (the <svg>). Returns
 * the matched element AND its name, or null if nothing up the chain is named.
 * Generic over the element type so the component gets a real `Element` back to
 * highlight, while tests can pass plain mock objects.
 */
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
