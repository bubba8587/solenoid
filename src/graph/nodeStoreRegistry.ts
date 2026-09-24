
type Forgetter = (nodeId: string) => void;

const _forgetters = new Set<Forgetter>();
const _forgetAllers = new Set<() => void>();

export function registerNodeForget(fn: Forgetter): void {
  _forgetters.add(fn);
}

export function registerNodeForgetAll(fn: () => void): void {
  _forgetAllers.add(fn);
}

export function forgetNode(nodeId: string): void {
  for (const fn of _forgetters) fn(nodeId);
}

type Nesting = { id: string; internalEditor?: { getNodes(): Nesting[] } };

/** A real delete: the node and, inside a composite, every card at every depth. Unpack relocates the cards, so it forgets only the composite. */
export function forgetNodeDeep(node: Nesting): void {
  forgetNode(node.id);
  for (const n of node.internalEditor?.getNodes() ?? []) forgetNodeDeep(n);
}

export function forgetAllNodes(): void {
  for (const fn of _forgetAllers) fn();
}
