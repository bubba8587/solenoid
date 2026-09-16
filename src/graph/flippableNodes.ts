// Which node types offer the "flip sockets" control (socketFlipStore). The mechanism
// itself is node-agnostic — a node opts in by adding its constructor name here (or
// calling registerFlippable at module load). The right-click menu reads this to decide
// whether to show the Flip / Unflip item.

const _flippable = new Set<string>(["DisplayNode"]);

/** Let a node type opt into the flip control. */
export function registerFlippable(typeName: string): void {
  _flippable.add(typeName);
}

/** Tests the constructor NAME (not instanceof) so a Vite hot-swap can't silently stop
 *  matching live instances — same rationale as pinNodeValue. */
export function isFlippableNode(node: { constructor: { name: string } } | null | undefined): boolean {
  return !!node && _flippable.has(node.constructor.name);
}
