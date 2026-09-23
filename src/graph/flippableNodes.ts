// [[C43]] oneFlowSurface, [[C34]] classNameIsType. Mechanics: tree/specs/canvas/react-flow-surface-contract.md.

const _flippable = new Set<string>(["DisplayNode"]);

export function registerFlippable(typeName: string): void {
  _flippable.add(typeName);
}

/** By constructor name, not `instanceof` ([[C34]] classNameIsType). */
export function isFlippableNode(node: { constructor: { name: string } } | null | undefined): boolean {
  return !!node && _flippable.has(node.constructor.name);
}
