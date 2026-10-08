// [[B14]] oneDesignSystem (DESIGN.md § Voice is the rule the corpus is linted against)
// Collects every shipped UI string for `uiCopy.test.ts` and `scripts/copy-inventory.ts`.
// Node-only (reads the filesystem): never import it from app code.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { flattenLeaves } from "./catalogSearch";
import { buildCatalog } from "./catalogUtils";

export const HELP_DIR = "src/graph/help";
export const SEED_DIR = "src/graph/seedGraphs";

export type CopyKind =
  | "help-file"
  | "catalog-label"
  | "catalog-desc"
  | "tsx-tooltip"
  | "tsx-aria"
  | "tsx-placeholder"
  | "tsx-opt-label"
  | "tsx-opt-title"
  | "tsx-opt-desc"
  | "seed-string";

/** A tsx `text` is the source substring, escapes included, so an exact replace in the file is safe. */
export type CopyRecord = {
  id: string;
  kind: CopyKind;
  file: string;
  /** JSON path inside the seed file (seed-string only), e.g. `nodes[3].init.body`. */
  path?: string;
  /** 1-based source line (tsx kinds only). */
  line?: number;
  text: string;
};

export type Unit = { src: string; text: string; opener: boolean };

export function sentences(src: string, text: string): Unit[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => ({ src, text: s, opener: i === 0 }));
}

/** A plain literal, a template's static segments, or every literal in a braced expression; segments under 4 chars
 *  are skipped, and a string held in a variable above the JSX is not seen. */
export function attrStrings(line: string): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  const kinds = { title: "tooltip", "aria-label": "aria", placeholder: "placeholder" } as const;
  const push = (kind: string, text: string) => {
    const t = text.trim();
    if (t.length >= 4) out.push({ kind, text: t });
  };
  for (const m of line.matchAll(/(title|aria-label|placeholder)=(?="|\{)/g)) {
    const kind = kinds[m[1] as keyof typeof kinds];
    const rest = line.slice(m.index + m[0].length);
    if (rest.startsWith('"')) {
      const lit = /^"([^"]*)"/.exec(rest);
      if (lit) push(kind, lit[1]);
      continue;
    }
    const expr = bracedExpr(rest);
    if (expr === null) continue;
    for (const q of expr.matchAll(/"((?:[^"\\]|\\.)*)"/g)) push(kind, q[1]);
    for (const t of expr.matchAll(/`([^`]*)`/g)) {
      for (const seg of t[1].split(/\$\{[^}]*\}/)) push(kind, seg);
    }
  }
  return out;
}

/** Skips string literals, so a brace inside one can't end the walk; null when the braces don't close on this line. */
export function bracedExpr(s: string): string | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(1, i);
  }
  return null;
}

export function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTsx(p, acc);
    else if (name.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/** Option-table literals, which never appear as a JSX attribute. */
export function optStrings(line: string): { key: "label" | "title" | "description"; text: string }[] {
  const out: { key: "label" | "title" | "description"; text: string }[] = [];
  for (const m of line.matchAll(/\b(label|title|description)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const text = m[2];
    if (text.trim().length >= 2) out.push({ key: m[1] as "label" | "title" | "description", text });
  }
  return out;
}

/** nodeCatalog and packs are skipped: their labels and descriptions are the catalog records. */
export function walkCode(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "packs" || name.name === "help") continue;
      walkCode(p, acc);
    } else if (
      /\.tsx?$/.test(name.name) &&
      !/\.test\.tsx?$|\.d\.ts$/.test(name.name) &&
      !["nodeCatalog.ts", "copyCorpus.ts"].includes(name.name)
    ) {
      acc.push(p);
    }
  }
  return acc;
}

export function collectCopyRecords(root = "."): CopyRecord[] {
  const out: CopyRecord[] = [];
  const at = (p: string) => join(root, p);

  const helpDir = at(HELP_DIR);
  for (const name of readdirSync(helpDir).filter((n) => n.endsWith(".md"))) {
    out.push({
      id: `help:${name}`,
      kind: "help-file",
      file: `${HELP_DIR}/${name}`,
      text: readFileSync(join(helpDir, name), "utf8"),
    });
  }

  // `file` is nominal: apply finds catalog strings by a quoted-source search.
  for (const { leaf } of flattenLeaves(buildCatalog(true))) {
    if (leaf.label) {
      out.push({ id: `catalog:${leaf.type}.label`, kind: "catalog-label", file: "src/graph/nodeCatalog.ts", text: leaf.label });
    }
    if (leaf.description) {
      out.push({ id: `catalog:${leaf.type}.desc`, kind: "catalog-desc", file: "src/graph/nodeCatalog.ts", text: leaf.description });
    }
  }

  for (const p of walkTsx(at("src/graph"))) {
    const rel = p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p;
    const src = readFileSync(p, "utf8");
    src.split("\n").forEach((line, i) => {
      attrStrings(line).forEach(({ kind, text }, n) => {
        out.push({
          id: `tsx:${rel}:${i + 1}.${kind}#${n}`,
          kind: `tsx-${kind}` as CopyKind,
          file: rel,
          line: i + 1,
          text,
        });
      });
    });
  }

  const OPT_KIND = { label: "tsx-opt-label", title: "tsx-opt-title", description: "tsx-opt-desc" } as const;
  for (const p of walkCode(at("src/graph"))) {
    const rel = p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p;
    const src = readFileSync(p, "utf8");
    src.split("\n").forEach((line, i) => {
      optStrings(line).forEach(({ key, text }, n) => {
        out.push({
          id: `opt:${rel}:${i + 1}.${key}#${n}`,
          kind: OPT_KIND[key],
          file: rel,
          line: i + 1,
          text,
        });
      });
    });
  }

  const seedDir = at(SEED_DIR);
  for (const name of readdirSync(seedDir).filter((n) => n.endsWith(".json"))) {
    const seed = JSON.parse(readFileSync(join(seedDir, name), "utf8")) as unknown;
    const visit = (o: unknown, path: string): void => {
      if (Array.isArray(o)) return o.forEach((v, i) => visit(v, `${path}[${i}]`));
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        const kp = path ? `${path}.${k}` : k;
        if (typeof v === "string" && (k === "body" || k === "label" || k === "text")) {
          out.push({ id: `seed:${name}:${kp}`, kind: "seed-string", file: `${SEED_DIR}/${name}`, path: kp, text: v });
        } else visit(v, kp);
      }
    };
    visit(seed, "");
  }

  return out;
}

/** The `src` formats are what the copy rules' `where` clauses key on. */
export function unitsFromRecords(records: CopyRecord[]): Unit[] {
  const out: Unit[] = [];
  for (const r of records) {
    switch (r.kind) {
      case "help-file": {
        const name = r.id.slice("help:".length);
        r.text.split("\n").forEach((line, i) => {
          if (line.trim()) out.push(...sentences(`help/${name}:${i + 1}`, line));
        });
        break;
      }
      case "catalog-label":
      case "catalog-desc":
        out.push(...sentences(r.id, r.text));
        break;
      case "tsx-opt-label":
      case "tsx-opt-title":
      case "tsx-opt-desc":
        break;
      case "tsx-tooltip":
      case "tsx-aria":
      case "tsx-placeholder": {
        const kind = r.kind.slice("tsx-".length);
        out.push(...sentences(`${r.file}:${r.line}.${kind}`, r.text));
        break;
      }
      case "seed-string": {
        const name = r.id.slice("seed:".length, r.id.indexOf(":", "seed:".length));
        for (const line of r.text.split(/\n+/)) out.push(...sentences(`seed/${name}`, line));
        break;
      }
    }
  }
  return out;
}

export function uiStrings(): Unit[] {
  return unitsFromRecords(collectCopyRecords());
}
