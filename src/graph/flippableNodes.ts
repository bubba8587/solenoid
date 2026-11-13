// [[B3]] sameNodeEverywhere, [[save-format#A save loses nothing quietly]]. Mechanics: tree/specs/canvas/react-flow-surface-contract.md.

const _flippable = new Set<string>(["DisplayNode"]);

/** By constructor name, not `instanceof` ([[save-format#A save loses nothing quietly]]). */
export function isFlippableNode(node: { constructor: { name: string } } | null | undefined): boolean {
  return !!node && _flippable.has(node.constructor.name);
}
