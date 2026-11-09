// [[C10]] socketLattice
/** `String(v)` for a value whose type is unknown where it is read: a primitive as `String` writes it, an object by its
 *  own `toString`, so an answer never moves for being read this way. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return (v as { toString(): string }).toString();
}
