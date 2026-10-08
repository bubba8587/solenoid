// [[C10]] socketLattice, [[B14]] oneDesignSystem

export function socketDocFor(node: object, socketKey: string): string | undefined {
  const ctor = node.constructor as { socketDocs?: Record<string, string> };
  return ctor.socketDocs?.[socketKey];
}
