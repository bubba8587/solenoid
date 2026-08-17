// Opt-in per-socket detail for the Inspector: a node class that wants one
// declares a static `socketDocs` map (socket key → one plain-English sentence
// beyond the type name) — the same declare-on-the-class shape as `frameHints`
// and `literals`, so the text sits beside the sockets it documents and
// survives minification. Most sockets need nothing: the label plus
// SOCKET_TYPE_LABELS already carries them.

export function socketDocFor(node: object, socketKey: string): string | undefined {
  const ctor = node.constructor as { socketDocs?: Record<string, string> };
  return ctor.socketDocs?.[socketKey];
}
