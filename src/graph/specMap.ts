// The spec-map derivation layer: parses docs/rules.md and docs/architecture.md
// (imported as ?raw markdown) into the model the View ▸ Architecture map overlay
// renders. Derived per SSOT-1/SSOT-3 — no hand-kept copy of a rule or module;
// editing a doc updates the view on the next build (HMR in dev).

export type ProvenanceGrade = "ARR" | "INFERRED" | "DEFAULT";
export type EnforcementStatus = "enforced" | "partial" | "unenforced";

export type SpecRule = {
  id: string;
  domain: string;
  title: string;
  grade: ProvenanceGrade;
  /** The **MUST:** paragraph, whitespace-collapsed. */
  must: string;
  enforcement: EnforcementStatus;
  /** `*.test.ts` files cited anywhere in the rule body. */
  tests: string[];
  hasExceptions: boolean;
};

export type SpecDomain = {
  prefix: string;
  title: string;
  /** Prose between the domain heading and its first rule, whitespace-collapsed. */
  blurb: string;
  rules: SpecRule[];
};

export type SpecRulesModel = {
  domains: SpecDomain[];
  ruleCount: number;
  summary: { enforced: number; partial: number; unenforced: number };
};

export type ArchModule = {
  /** Primary file/dir name (first backticked token of the row's name cell). */
  name: string;
  /** The full name cell, backticks stripped (may list companion files). */
  nameCell: string;
  role: string;
};

export type ArchGroup = { title: string; modules: ArchModule[] };

const RULE_ID = /(?:PROV|SSOT|SOCK|FX|VAL|PERSIST|ENGINE|EFFECT|STORE)-\d+/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Expand a summary-table cell like `SSOT-1,2,3 · SOCK-8` into full rule IDs. */
function expandIdList(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.split("·").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Z]+)-([\d,]+)$/);
    if (!m) continue;
    for (const n of m[2].split(",").filter(Boolean)) out.push(`${m[1]}-${n}`);
  }
  return out;
}

export function parseRulesDoc(md: string): SpecRulesModel {
  // Enforcement status comes from the enforcement-summary table — the doc's own
  // SSOT for it (per-rule bodies only carry the citations).
  const statusOf = new Map<string, EnforcementStatus>();
  for (const row of md.matchAll(/^\| (Enforced|Partially enforced|Unenforced) \| \d+ \| (.+?) \|$/gm)) {
    const status: EnforcementStatus =
      row[1] === "Enforced" ? "enforced" : row[1] === "Unenforced" ? "unenforced" : "partial";
    for (const id of expandIdList(row[2])) statusOf.set(id, status);
  }

  const domains: SpecDomain[] = [];
  // Domain sections: `# PREFIX — Title` … up to the next `# ` heading.
  for (const dm of md.matchAll(/^# ([A-Z]+) — (.+)$\n([\s\S]*?)(?=^# )/gm)) {
    const [, prefix, title, body] = dm;
    const firstRule = body.search(/^### /m);
    const blurb = collapse(firstRule === -1 ? body : body.slice(0, firstRule));
    const rules: SpecRule[] = [];
    for (const rm of body.matchAll(
      new RegExp(`^### (${RULE_ID.source}) — (.+?) \\*\\*\\[(ARR|INFERRED|DEFAULT)\\]\\*\\*$\\n([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`, "gm"),
    )) {
      const [, id, title, grade, ruleBody] = rm;
      const must = collapse(ruleBody.match(/\*\*MUST:\*\*([\s\S]*?)(?:\n\n|\n\*)/)?.[1] ?? "");
      const tests = [...new Set([...ruleBody.matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1]))];
      rules.push({
        id,
        domain: prefix,
        title,
        grade: grade as ProvenanceGrade,
        must,
        enforcement: statusOf.get(id) ?? "unenforced",
        tests,
        hasExceptions: /\*Exceptions:\*/.test(ruleBody),
      });
    }
    if (rules.length) domains.push({ prefix, title, blurb, rules });
  }

  const all = domains.flatMap((d) => d.rules);
  return {
    domains,
    ruleCount: all.length,
    summary: {
      enforced: all.filter((r) => r.enforcement === "enforced").length,
      partial: all.filter((r) => r.enforcement === "partial").length,
      unenforced: all.filter((r) => r.enforcement === "unenforced").length,
    },
  };
}

export function parseArchDoc(md: string): ArchGroup[] {
  const groups: ArchGroup[] = [];
  // Any ##/### section whose body carries a `| Module | Role |` table.
  for (const sm of md.matchAll(/^#{2,3} (.+)$\n([\s\S]*?)(?=^#{2,3} |$(?![\s\S]))/gm)) {
    const title = sm[1].replace(/\s*\(`[^`]*`\)\s*/g, " ").trim();
    const modules: ArchModule[] = [];
    // Rows are 2 or 3 cells (`| module | role |`, `| file | status | purpose |`);
    // the name cell must be backticked, the rest joins into the role.
    for (const line of sm[2].split("\n")) {
      const cells = line.match(/^\|(.+)\|\s*$/)?.[1].split(" | ").map((c) => c.trim());
      if (!cells || cells.length < 2 || !cells[0].startsWith("`")) continue;
      const nameCell = cells[0].replace(/`/g, "").trim();
      const name = cells[0].match(/`([^`]+)`/)?.[1] ?? nameCell;
      const role = collapse(cells.slice(1).join(" — "));
      if (name && role) modules.push({ name, nameCell, role });
    }
    if (modules.length) groups.push({ title, modules });
  }
  return groups;
}

/** Every distinct test file the rules cite, with the rules that cite it. */
export function testCitationIndex(model: SpecRulesModel): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const d of model.domains)
    for (const r of d.rules)
      for (const t of r.tests) index.set(t, [...(index.get(t) ?? []), r.id]);
  return index;
}
