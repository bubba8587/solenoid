// [[C103]] untrustedContentSeams
// "Which layer did you click?" for the SVG Picker node, DOM-agnostic (`SvgLike`) so it tests without jsdom.

// Priority order, so a readable label beats a machine id when a tool wrote both.
const NAME_ATTRS = ["inkscape:label", "data-name", "aria-label", "id"] as const;

export interface SvgLike {
  getAttribute(name: string): string | null;
  parentElement: SvgLike | null;
}

export function elementName(el: SvgLike): string | null {
  for (const attr of NAME_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Stops at and excludes `root`. */
export function resolveLayer<T extends SvgLike>(target: T, root: T): { el: T; name: string } | null {
  let el: T | null = target;
  while (el && el !== root) {
    const name = elementName(el);
    if (name) return { el, name };
    el = el.parentElement as T | null;
  }
  return null;
}

/** Text-level, since the headless graph has no DOM, so a saved pick never outlives the picture it was made on. */
export function sourceHasLayer(source: string, name: string): boolean {
  if (!name) return false;
  const re = /\b(?:inkscape:label|data-name|aria-label|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of source.matchAll(re)) if ((m[1] ?? m[2] ?? "").trim() === name) return true;
  return false;
}

export function resolveLayerName(target: SvgLike, root: SvgLike): string | null {
  return resolveLayer(target, root)?.name ?? null;
}
