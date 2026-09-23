// [[C40]] storesRegisterForget

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

export function forgetAllNodes(): void {
  for (const fn of _forgetAllers) fn();
}
