// [[C10]] socketLattice, [[components#The design system]]

export function socketDocFor(node: object, socketKey: string): string | undefined {
  const ctor = node.constructor as { socketDocs?: Record<string, string> };
  return ctor.socketDocs?.[socketKey];
}
