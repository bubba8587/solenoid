// [[C10]] socketLattice, [[components#One design system governs every look, layout and word in the app]]

export function socketDocFor(node: object, socketKey: string): string | undefined {
  const ctor = node.constructor as { socketDocs?: Record<string, string> };
  return ctor.socketDocs?.[socketKey];
}
