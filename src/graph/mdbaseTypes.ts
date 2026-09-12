// mdbase collections (mdbase-dev/mdbase-spec v0.3): a folder with `mdbase.yaml` and a
// `_types/` folder of markdown type files (`kind: mdbase.type`, `match.path_glob`, a JSON
// Schema `schema.value`). This maps those schemas into the shared TypeHint vocabulary
// (typing source #1, above `.obsidian/types.json` and the guesser). Pure; graph/DOM-free.
//
// mdbase breaks by policy before 1.0, so this reads defensively: an unknown spec_version
// or an unparseable schema yields no types, never an error — the folder falls back to
// types.json / the guesser (bundle 24 risk note).
import { parse as parseYaml } from "yaml";
import { type TypeHint, type TypeMap, type ScalarKind } from "./vaultTypes";

/** The in-process validation subset of a property's JSON Schema (Write Properties, item B). */
export interface PropConstraint {
  kind: ScalarKind | "list" | "frame";
  enum?: (string | number)[];
  min?: number;
  max?: number;
}

export interface MdbaseType {
  name: string;
  /** Glob relative to the collection root ("*.md"). */
  pathGlob: string;
  /** Per-property parse hints from the schema. */
  properties: TypeMap;
  /** Per-property validation constraints (type / enum / min / max). */
  constraints: Record<string, PropConstraint>;
  /** Keys the schema marks required (always present). */
  required: string[];
}

export interface MdbaseCollection {
  specVersion: string;
  types: MdbaseType[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalarKindOf(type: unknown, format: unknown): ScalarKind {
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "logical";
  if (type === "string" && (format === "date" || format === "date-time")) return "date";
  return "string";
}

/** One JSON-Schema property → a parse hint (null when the shape isn't understood). */
function propHint(schema: unknown): TypeHint | null {
  if (!isRecord(schema)) return null;
  const t = schema.type;
  if (t === "number" || t === "integer") return { kind: "number" };
  if (t === "boolean") return { kind: "logical" };
  if (t === "string") {
    return schema.format === "date" || schema.format === "date-time" ? { kind: "date" } : { kind: "string" };
  }
  if (t === "array") {
    const items = schema.items;
    if (isRecord(items) && items.type === "object") return { kind: "frame" };
    return { kind: "list", elem: scalarKindOf(isRecord(items) ? items.type : undefined, isRecord(items) ? items.format : undefined) };
  }
  return null;
}

/** One JSON-Schema property → its validation constraint (null when not understood). */
function propConstraint(schema: unknown): PropConstraint | null {
  const hint = propHint(schema);
  if (!hint || !isRecord(schema)) return null;
  const kind = hint.kind;
  const c: PropConstraint = { kind };
  if (Array.isArray(schema.enum)) {
    c.enum = schema.enum.filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  }
  if (typeof schema.minimum === "number") c.min = schema.minimum;
  if (typeof schema.maximum === "number") c.max = schema.maximum;
  return c;
}

/** The YAML frontmatter object of a `_types/*.md` file, or null. */
function frontmatterOf(text: string): unknown {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  try { return parseYaml(m[1]); } catch { return null; }
}

/** Build one `MdbaseType` from a type file's text; null when it isn't a valid type doc. */
function parseTypeFile(text: string): MdbaseType | null {
  const fm = frontmatterOf(text);
  if (!isRecord(fm) || fm.kind !== "mdbase.type") return null;
  const name = typeof fm.name === "string" ? fm.name : "";
  const match = isRecord(fm.match) ? fm.match : {};
  const pathGlob = typeof match.path_glob === "string" ? match.path_glob : "";
  if (pathGlob === "") return null;
  const schema = isRecord(fm.schema) ? fm.schema : {};
  const value = isRecord(schema.value) ? schema.value : {};
  const props = isRecord(value.properties) ? value.properties : {};
  const properties: TypeMap = {};
  const constraints: Record<string, PropConstraint> = {};
  for (const [key, sub] of Object.entries(props)) {
    const hint = propHint(sub);
    if (hint) properties[key] = hint;
    const c = propConstraint(sub);
    if (c) constraints[key] = c;
  }
  const required = Array.isArray(value.required) ? value.required.filter((r): r is string => typeof r === "string") : [];
  return { name, pathGlob, properties, constraints, required };
}

/** Parse a collection from its `mdbase.yaml` text + the texts of its `_types/*.md` files. */
export function parseMdbaseCollection(mdbaseYaml: string, typeFileTexts: readonly string[]): MdbaseCollection {
  let spec = "";
  try {
    const root = parseYaml(mdbaseYaml);
    if (isRecord(root) && typeof root.spec_version === "string") spec = root.spec_version;
  } catch { /* keep spec "" — still usable */ }
  const types: MdbaseType[] = [];
  for (const text of typeFileTexts) {
    const t = parseTypeFile(text);
    if (t) types.push(t);
  }
  return { specVersion: spec, types };
}

/** A glob (relative to the collection root) → an anchored regex. `**` spans separators,
 *  `*` stays within one segment. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

/** The parse hints for a note at `relPath` (relative to the collection root): the first
 *  type whose glob matches. {} when none matches. */
export function mdbaseTypeFor(collection: MdbaseCollection, relPath: string): TypeMap {
  for (const t of collection.types) {
    if (globToRegExp(t.pathGlob).test(relPath)) return t.properties;
  }
  return {};
}

/** The matching type's validation schema for a note at `relPath`, or null. */
export function mdbaseSchemaFor(collection: MdbaseCollection, relPath: string): { constraints: Record<string, PropConstraint>; required: string[] } | null {
  for (const t of collection.types) {
    if (globToRegExp(t.pathGlob).test(relPath)) return { constraints: t.constraints, required: t.required };
  }
  return null;
}

/** Validate a YAML-ready value against a property constraint — a human reason, or null when
 *  it passes. A null value passes here (missing-required is a row-level check). */
export function validateAgainst(value: unknown, c: PropConstraint): string | null {
  if (value === null || value === undefined) return null;
  if (c.kind === "number") {
    if (typeof value !== "number") return "must be a number";
    if (c.min !== undefined && value < c.min) return `must be at least ${c.min}`;
    if (c.max !== undefined && value > c.max) return `must be at most ${c.max}`;
  }
  if (c.kind === "logical" && typeof value !== "boolean") return "must be true or false";
  if (c.enum && (typeof value === "string" || typeof value === "number") && !c.enum.includes(value)) {
    return `must be one of ${c.enum.join(", ")}`;
  }
  return null;
}
