// The one collector for every shipped UI string — help pages, catalog labels
// and descriptions, tsx tooltip/aria/placeholder attributes, seed prose.
// Two consumers, one walk: `uiCopy.test.ts` lints sentence units from it, and
// `scripts/copy-inventory.ts` renders whole-string records for a hand-rewrite
// pass. Node-only (reads the filesystem); never import from app code.
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

/** One shipped string, whole and addressed. `id` is the stable handle the
 *  inventory round-trips on; `text` is verbatim (multiline for seed bodies and
 *  help files). tsx texts are the SOURCE substring, escapes included, so an
 *  exact old→new replace in the file is safe. */
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

/** One linted string, tagged with where it came from. */
export type Unit = { src: string; text: string; opener: boolean };

/** Sentence-ish split: the unit a copy rule judges. A rule keyed to a sentence's
 *  START needs the sentence, not the paragraph — the string the lint exists for
 *  ("Hover any dot for its name.") sat at the tail of a five-sentence line. */
export function sentences(src: string, text: string): Unit[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => ({ src, text: s, opener: i === 0 }));
}

/** Copy carried by a title / aria-label / placeholder attribute on one line of
 *  TSX. Three shapes:
 *    - attr="…" — the plain literal;
 *    - attr={`… ${hole} …`} — a template: its STATIC segments are fixed copy
 *      ("…. Click to change the type." hid between two holes), so the prose
 *      between the ${…} holes is judged segment by segment;
 *    - attr={cond ? "…" : `…`} — a braced expression: EVERY double-quoted and
 *      backtick literal inside the braces is possible shipped copy. Ternary
 *      arms were how "Document. Click to open the report." evaded the lint.
 *  A segment shorter than 4 chars is punctuation glue and is skipped. A string
 *  assigned to a variable ABOVE the JSX (title={titleText}) is still invisible
 *  here — that one shape stays a human call. */
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
    if (expr === null) continue; // spans lines — out of scope, as before
    for (const q of expr.matchAll(/"((?:[^"\\]|\\.)*)"/g)) push(kind, q[1]);
    for (const t of expr.matchAll(/`([^`]*)`/g)) {
      for (const seg of t[1].split(/\$\{[^}]*\}/)) push(kind, seg);
    }
  }
  return out;
}

/** The text between the `{` at s[0] and its matching `}`, skipping string
 *  literals so a brace inside a quoted string (a template's ${…} hole, a "}"
 *  in copy) can't end the walk early. Null when the expression doesn't close
 *  on this line. */
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

/** Option-table strings: `label:` / `title:` / `description:` string literals in
 *  object rows — every OpSelect and SegToggle option, the op-meta tables. These
 *  render as dropdown rows and tooltips but never appear as a `title=` JSX
 *  attribute, so the attribute collector cannot see them. Text is the SOURCE
 *  substring, escapes included, like attrStrings. */
export function optStrings(line: string): { key: "label" | "title" | "description"; text: string }[] {
  const out: { key: "label" | "title" | "description"; text: string }[] = [];
  for (const m of line.matchAll(/\b(label|title|description)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const text = m[2];
    if (text.trim().length >= 2) out.push({ key: m[1] as "label" | "title" | "description", text });
  }
  return out;
}

/** Every non-test .ts/.tsx under `dir` that can carry option-table copy.
 *  nodeCatalog + packs are excluded: their labels/descriptions are the catalog
 *  records. */
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

/** Every shipped string as a whole, addressed record. */
export function collectCopyRecords(root = "."): CopyRecord[] {
  const out: CopyRecord[] = [];
  const at = (p: string) => join(root, p);

  // The Reference overlay's Help / Notes / Socket Types tabs — one record per
  // page (the file is the editing unit; the lint re-splits into lines).
  const helpDir = at(HELP_DIR);
  for (const name of readdirSync(helpDir).filter((n) => n.endsWith(".md"))) {
    out.push({
      id: `help:${name}`,
      kind: "help-file",
      file: `${HELP_DIR}/${name}`,
      text: readFileSync(join(helpDir, name), "utf8"),
    });
  }

  // Every node's Add-menu label and description (also the Function Reference's
  // description column, and the node card's hover text). Values come from the
  // built catalog, so pack entries are included; apply locates them by quoted
  // source search, hence the nominal file.
  for (const { leaf } of flattenLeaves(buildCatalog(true))) {
    if (leaf.label) {
      out.push({ id: `catalog:${leaf.type}.label`, kind: "catalog-label", file: "src/graph/nodeCatalog.ts", text: leaf.label });
    }
    if (leaf.description) {
      out.push({ id: `catalog:${leaf.type}.desc`, kind: "catalog-desc", file: "src/graph/nodeCatalog.ts", text: leaf.description });
    }
  }

  // Chrome strings: tooltips, accessible names, field placeholders. Tooltips are
  // the WORST surface for a narrated affordance — the tooltip fires while the
  // pointer is already on the control.
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

  // Option-table copy: dropdown rows and their tooltips, op-meta labels and
  // descriptions. Inventory-only for now — the voice lint's corpus predates
  // these and widening it is a sweep of its own (unitsFromRecords skips them).
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

  // Seed-graph prose: every `body` / `label` / `text` string, addressed by its
  // JSON path so an edit can be written back structurally.
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

/** The lint's sentence units, derived from the records — same `src` formats the
 *  rules' `where` clauses key on (`help/x.md:12`, `catalog:type.desc`,
 *  `path:line.tooltip`, `seed/name`). */
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
        out.push(...sentences(r.id, r.text)); // catalog:<type>.label / .desc
        break;
      case "tsx-opt-label":
      case "tsx-opt-title":
      case "tsx-opt-desc":
        break; // inventory-only: not yet part of the lint corpus (see above)
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

/** The full lint corpus (what `uiStrings()` in uiCopy.test.ts used to build). */
export function uiStrings(): Unit[] {
  return unitsFromRecords(collectCopyRecords());
}
