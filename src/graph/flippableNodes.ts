// [[C43]] oneFlowSurface, [[B12]] losslessSaves. Mechanics: tree/specs/canvas/react-flow-surface-contract.md.

const _flippable = new Set<string>(["DisplayNode"]);

export function registerFlippable(typeName: string): void {
  _flippable.add(typeName);
}

/** By constructor name, not `instanceof` ([[B12]] losslessSaves). */
export function isFlippableNode(node: { constructor: { name: string } } | null | undefined): boolean {
  return !!node && _flippable.has(node.constructor.name);
}
