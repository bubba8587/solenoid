// [[C43]] oneFlowSurface, [[C34]] classNameIsType. Mechanics: tree/specs/canvas/react-flow-surface-contract.md.
// Which node types offer the "flip sockets" control (socketFlipStore).

const _flippable = new Set<string>(["DisplayNode"]);

/** Let a node type opt into the flip control. */
export function registerFlippable(typeName: string): void {
  _flippable.add(typeName);
}

/** Matches the constructor NAME, not `instanceof` ([[C34]] classNameIsType). */
export function isFlippableNode(node: { constructor: { name: string } } | null | undefined): boolean {
  return !!node && _flippable.has(node.constructor.name);
}
