// [[C19]] namingModel
// For modules below catalogUtils in the import graph (errorValue, groupCollapse); catalogUtils binds nodeDisplayName at
// load, and until then the class-derived fallback stands.

type Named = { label?: string; constructor: { name: string } };

/** For a node with no catalog entry (a Placeholder, a composite boundary); never a display source on its own. */
export function nodeTypeName(n: { constructor: { name: string } }): string {
  return n.constructor.name.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

let namer: (n: object) => string = (n) => (n as Named).label?.trim() || nodeTypeName(n);

export function setNodeNamer(fn: (n: object) => string): void { namer = fn; }

export function displayNameOf(n: object): string { return namer(n); }
