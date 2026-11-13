// [[obsidian-plugin]]
export function processGraph(_changedNodeId?: string): Promise<void> {
  return Promise.resolve();
}

export function processEdited(_nodeId: string, _alsoChanged?: Iterable<string>, _opts?: { topology?: boolean }): Promise<void> {
  return Promise.resolve();
}

export function processChanged(_ids: Iterable<string>, _opts?: { topology?: boolean }): Promise<void> {
  return Promise.resolve();
}
