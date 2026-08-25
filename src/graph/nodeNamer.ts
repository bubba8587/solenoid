// The ONE home of a node's display name for modules that cannot import catalogUtils
// (errorValue, groupCollapse sit below it in the import graph). catalogUtils binds the
// real derivation (nodeDisplayName) at load; until then the class-derived fallback stands.
// NAME-1 (docs/rules.md).

type Named = { label?: string; constructor: { name: string } };

/** The class-derived fallback for a node with NO catalog entry (a Placeholder, a
 *  composite boundary). Never a display source on its own. */
export function nodeTypeName(n: { constructor: { name: string } }): string {
  return n.constructor.name.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

let namer: (n: object) => string = (n) => (n as Named).label?.trim() || nodeTypeName(n as Named);

export function setNodeNamer(fn: (n: object) => string): void { namer = fn; }

/** A placed node's display name, by the same derivation every surface uses. */
export function displayNameOf(n: object): string { return namer(n); }
