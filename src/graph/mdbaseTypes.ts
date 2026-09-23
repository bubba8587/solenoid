// [[C67]]
import { parse as parseYaml } from "yaml";
import { type TypeHint, type TypeMap, type ScalarKind } from "./vaultTypes";

export interface PropConstraint {
  kind: ScalarKind | "list" | "frame";
  enum?: (string | number)[];
  min?: number;
  max?: number;
}

export interface MdbaseType {
  name: string;
  pathGlob: string;
  properties: TypeMap;
  constraints: Record<string, PropConstraint>;
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

function propConstraint(schema: unknown): PropConstraint | null {
  const hint = propHint(schema);
  if (!hint || hint.kind === "matrix" || !isRecord(schema)) return null;
  const kind = hint.kind;
  const c: PropConstraint = { kind };
  if (Array.isArray(schema.enum)) {
    c.enum = schema.enum.filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  }
  if (typeof schema.minimum === "number") c.min = schema.minimum;
  if (typeof schema.maximum === "number") c.max = schema.maximum;
  return c;
}

function frontmatterOf(text: string): unknown {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  try { return parseYaml(m[1]); } catch { return null; }
}

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

export function mdbaseTypeFor(collection: MdbaseCollection, relPath: string): TypeMap {
  for (const t of collection.types) {
    if (globToRegExp(t.pathGlob).test(relPath)) return t.properties;
  }
  return {};
}

export function mdbaseSchemaFor(collection: MdbaseCollection, relPath: string): { constraints: Record<string, PropConstraint>; required: string[] } | null {
  for (const t of collection.types) {
    if (globToRegExp(t.pathGlob).test(relPath)) return { constraints: t.constraints, required: t.required };
  }
  return null;
}

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
