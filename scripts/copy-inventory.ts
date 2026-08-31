// Run with: npx tsx scripts/copy-inventory.ts extract [out.md]
//           npx tsx scripts/copy-inventory.ts apply   [out.md]
//
// The hand-rewrite tool for shipped UI copy. `extract` writes EVERY shipped
// string — catalog labels + descriptions, tsx tooltips / aria labels /
// placeholders, seed prose, help pages — into one flat file to read straight
// through and edit in place, plus a sidecar (<out>.orig.json) holding each
// string as extracted. `apply` diffs the edited file against the sidecar and
// writes only the changed strings back to their sources: seed strings are set
// structurally by JSON path, help pages are rewritten whole, catalog strings
// are located by their quoted form, and tsx strings are replaced verbatim in
// their file. Anything ambiguous (string not found, or found more than once)
// is SKIPPED and reported, never guessed. Corpus definition lives in
// src/graph/copyCorpus.ts, shared with uiCopy.test.ts, so the inventory and
// the voice lint always cover the same strings.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectCopyRecords, type CopyRecord } from "../src/graph/copyCorpus";

const DEFAULT_OUT = "copy-inventory.md";

// ─── Render / parse ────────────────────────────────────────────────────────────
// Record framing: `@@@ <id>` opens a record, `@@@ end` closes it; the lines
// between are the string, verbatim. Everything outside records (the preamble,
// section headings) is ignored by parse. A text line that itself starts with
// `@@@` is escaped with one leading backslash.

const SECTION: Record<string, string> = {
  "catalog-label": "Catalog · node labels",
  "catalog-desc": "Catalog · node descriptions",
  "tsx-tooltip": "Chrome · tooltips (title=)",
  "tsx-aria": "Chrome · accessible names (aria-label=)",
  "tsx-placeholder": "Chrome · field placeholders",
  "tsx-opt-label": "Option tables · row labels (label:)",
  "tsx-opt-title": "Option tables · row tooltips (title:)",
  "tsx-opt-desc": "Option tables · descriptions (description:)",
  "seed-string": "Seed documents · note and report prose, labels",
  "help-file": "Help pages (whole files)",
};
const SECTION_ORDER = Object.keys(SECTION);

const escapeLine = (l: string) => (/^\\*@@@/.test(l) ? `\\${l}` : l);
const unescapeLine = (l: string) => (/^\\+@@@/.test(l) ? l.slice(1) : l);

export function renderInventory(records: CopyRecord[]): string {
  const bySection = new Map<string, CopyRecord[]>();
  for (const r of records) {
    const list = bySection.get(r.kind) ?? [];
    list.push(r);
    bySection.set(r.kind, list);
  }
  const lines: string[] = [
    "# Solenoid copy inventory",
    `# ${records.length} strings. Edit text INSIDE records; everything outside is ignored.`,
    "# Do not edit @@@ lines. Apply edits back with: npx tsx scripts/copy-inventory.ts apply",
    "",
  ];
  for (const kind of SECTION_ORDER) {
    const list = bySection.get(kind);
    if (!list?.length) continue;
    lines.push(`## ${SECTION[kind]} (${list.length})`, "");
    for (const r of list) {
      lines.push(`@@@ ${r.id}`);
      for (const l of r.text.split("\n")) lines.push(escapeLine(l));
      lines.push("@@@ end", "");
    }
  }
  return lines.join("\n");
}

/** id → edited text. Throws on an unterminated record. */
export function parseInventory(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = md.split("\n");
  let id: string | null = null;
  let buf: string[] = [];
  for (const raw of lines) {
    if (id === null) {
      if (raw.startsWith("@@@ ") && raw !== "@@@ end") {
        id = raw.slice(4).trim();
        buf = [];
      }
    } else if (raw === "@@@ end") {
      out.set(id, buf.map(unescapeLine).join("\n"));
      id = null;
    } else {
      buf.push(raw);
    }
  }
  if (id !== null) throw new Error(`record "${id}" has no "@@@ end"`);
  return out;
}

// ─── Apply ─────────────────────────────────────────────────────────────────────

export type ApplyOutcome = { id: string; status: "applied" | "skipped"; reason?: string };

// Segments: `key` or `key[3]`, dot-separated (as built by collectCopyRecords).
function jsonPathSegs(path: string): (string | number)[] {
  return path.split(".").flatMap((s) => {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(s);
    if (!m) return [s];
    const idx = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    return [m[1], ...idx];
  });
}

function parentByJsonPath(root: unknown, path: string): { parent: Record<string | number, unknown>; key: string | number } | null {
  const segs = jsonPathSegs(path);
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string | number, unknown>)[segs[i]];
  }
  if (cur == null || typeof cur !== "object") return null;
  return { parent: cur as Record<string | number, unknown>, key: segs[segs.length - 1] };
}

const countOccurrences = (hay: string, needle: string): number => {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** Write one edited record back to its source under `root`. Pure decision +
 *  fs write; ambiguity skips with a reason. */
export function applyRecord(
  root: string,
  rec: CopyRecord,
  edited: string,
  tsxSearchFiles?: string[],
): ApplyOutcome {
  const { id, kind } = rec;
  const skip = (reason: string): ApplyOutcome => ({ id, status: "skipped", reason });
  if (kind === "seed-string") {
    const file = join(root, rec.file);
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const loc = parentByJsonPath(json, rec.path!);
    if (!loc) return skip(`path ${rec.path} not found`);
    // Staleness: the source must still hold the text this inventory extracted.
    if (loc.parent[loc.key] !== rec.text) return skip("source changed since extract; re-extract");
    loc.parent[loc.key] = edited;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    return { id, status: "applied" };
  }
  if (kind === "help-file") {
    const file = join(root, rec.file);
    if (readFileSync(file, "utf8") !== rec.text) return skip("source changed since extract; re-extract");
    writeFileSync(file, edited);
    return { id, status: "applied" };
  }
  if (kind === "catalog-label" || kind === "catalog-desc") {
    // Catalog values are runtime strings; locate the SOURCE by its quoted form
    // (the repo quotes double, and JSON escaping matches for these strings).
    const oldQ = JSON.stringify(rec.text);
    const newQ = JSON.stringify(edited);
    const files = tsxSearchFiles ?? catalogSearchFiles(root);
    const hits = files.filter((f) => countOccurrences(readFileSync(f, "utf8"), oldQ) > 0);
    if (hits.length === 0) return skip("quoted string not found; edit by hand");
    const total = hits.reduce((n, f) => n + countOccurrences(readFileSync(f, "utf8"), oldQ), 0);
    if (total > 1) return skip(`quoted string appears ${total} times; edit by hand`);
    const src = readFileSync(hits[0], "utf8");
    writeFileSync(hits[0], src.replace(oldQ, newQ));
    return { id, status: "applied" };
  }
  // tsx-*: the extracted text is a verbatim source substring; replace it in its
  // file, but only when unambiguous and the edit can't break the quoting.
  const file = join(root, rec.file);
  if (/[`\n]/.test(edited) || (edited.includes('"') && !rec.text.includes('"'))) {
    return skip("edit adds quoting the attribute may not survive; edit by hand");
  }
  const src = readFileSync(file, "utf8");
  const n = countOccurrences(src, rec.text);
  if (n === 0) return skip("string not found; source changed since extract");
  if (n > 1) return skip(`string appears ${n} times in the file; edit by hand`);
  writeFileSync(file, src.replace(rec.text, edited));
  return { id, status: "applied" };
}

function catalogSearchFiles(root: string): string[] {
  // Catalog labels/descriptions live in nodeCatalog.ts and the pack modules.
  const packs = readdirSync(join(root, "src/graph/packs"))
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => join(root, "src/graph/packs", n));
  return [join(root, "src/graph/nodeCatalog.ts"), ...packs];
}

export function applyInventory(
  root: string,
  records: CopyRecord[],
  edits: Map<string, string>,
): { outcomes: ApplyOutcome[]; unchanged: number; unknown: string[] } {
  const byId = new Map(records.map((r) => [r.id, r]));
  const outcomes: ApplyOutcome[] = [];
  const unknown: string[] = [];
  let unchanged = 0;
  for (const [id, text] of edits) {
    const rec = byId.get(id);
    if (!rec) {
      unknown.push(id);
      continue;
    }
    if (text === rec.text) {
      unchanged++;
      continue;
    }
    outcomes.push(applyRecord(root, rec, text));
  }
  return { outcomes, unchanged, unknown };
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function main(): void {
  const [mode = "extract", out = DEFAULT_OUT] = process.argv.slice(2);
  const sidecar = `${out}.orig.json`;
  if (mode === "extract") {
    const records = collectCopyRecords();
    writeFileSync(out, renderInventory(records));
    writeFileSync(sidecar, `${JSON.stringify(records, null, 1)}\n`);
    const perKind = new Map<string, number>();
    for (const r of records) perKind.set(r.kind, (perKind.get(r.kind) ?? 0) + 1);
    console.log(`${records.length} strings → ${out} (+ ${sidecar})`);
    for (const [k, n] of perKind) console.log(`  ${k}: ${n}`);
    return;
  }
  if (mode === "apply") {
    if (!existsSync(out) || !existsSync(sidecar)) {
      console.error(`need both ${out} and ${sidecar} — run extract first`);
      process.exit(1);
    }
    const records = JSON.parse(readFileSync(sidecar, "utf8")) as CopyRecord[];
    const edits = parseInventory(readFileSync(out, "utf8"));
    const { outcomes, unchanged, unknown } = applyInventory(".", records, edits);
    const applied = outcomes.filter((o) => o.status === "applied");
    const skipped = outcomes.filter((o) => o.status === "skipped");
    console.log(`${applied.length} applied · ${unchanged} unchanged · ${skipped.length} skipped`);
    for (const o of skipped) console.log(`  SKIP ${o.id}: ${o.reason}`);
    for (const id of unknown) console.log(`  UNKNOWN ${id} (not in sidecar)`);
    if (applied.length) console.log("Run the suite (uiCopy lints the new text), then re-extract for a fresh inventory.");
    return;
  }
  console.error("usage: copy-inventory.ts [extract|apply] [out.md]");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
