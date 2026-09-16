// The typing vocabulary the vault cores agree on. A `TypeHint` says how a frontmatter
// key's scalars (or list items) PARSE; a cube column carries no declared type, so this
// only steers parsing (Vault Folder / bundle 24 item A). Kept graph/DOM-free.

export type ScalarKind = "number" | "string" | "logical" | "date";

export type TypeHint =
  | { kind: ScalarKind }
  | { kind: "list"; elem: ScalarKind }
  | { kind: "frame" };

/** Per-key type hints for one note (or one collection's schema). */
export type TypeMap = Record<string, TypeHint>;
