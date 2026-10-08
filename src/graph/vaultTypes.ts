// [[B1]] obsidianBet, [[C67]] mdbaseCeiling

export type ScalarKind = "number" | "string" | "logical" | "date";

export type TypeHint =
  | { kind: ScalarKind }
  | { kind: "list"; elem: ScalarKind }
  | { kind: "matrix"; elem: ScalarKind }
  | { kind: "frame" };

export type TypeMap = Record<string, TypeHint>;
