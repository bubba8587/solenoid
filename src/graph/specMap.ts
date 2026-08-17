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
  /** The `*Why:*` / `*Origin:*` / `*Exceptions:*` sections, collapsed ("" when absent). */
  why: string;
  origin: string;
  exceptions: string;
  enforcement: EnforcementStatus;
  /** `*.test.ts` files cited anywhere in the rule body. */
  tests: string[];
  /** Non-test source files backtick-cited in the rule body. */
  moduleRefs: string[];
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

export type ArchGroup = {
  title: string;
  modules: ArchModule[];
  /** Directory the section owns (from a heading like ``(`src/graph/nodes/`)``), graph-root-relative. */
  dir?: string;
  /** Inline-code file/identifier citations from a PROSE section (no module table). */
  claims?: string[];
};

const RULE_ID = /(?:PROV|SSOT|SOCK|FX|VAL|PERSIST|ENGINE|EFFECT|STORE)-\d+/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** One labelled rule-body section (`*Why:*` …), ending at the next label or blank line. */
function ruleSection(body: string, label: string): string {
  const m = body.match(
    new RegExp(`^\\*${label}:\\*([\\s\\S]*?)(?=^\\*(?:Why|Enforced by|Origin|Exceptions):\\*|^\\s*$)`, "m"),
  );
  return collapse(m?.[1] ?? "");
}

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
      const moduleRefs = [...new Set(
        [...ruleBody.matchAll(/`([\w./-]+\.tsx?)`/g)].map((m) => m[1]).filter((f) => !f.endsWith(".test.ts")),
      )];
      rules.push({
        id,
        domain: prefix,
        title,
        grade: grade as ProvenanceGrade,
        must,
        why: ruleSection(ruleBody, "Why"),
        origin: ruleSection(ruleBody, "Origin"),
        exceptions: ruleSection(ruleBody, "Exceptions"),
        enforcement: statusOf.get(id) ?? "unenforced",
        tests,
        moduleRefs,
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
  // Any ##/### section with a `| Module | Role |` table (a tabled group), plus
  // any ### section that instead cites its files in prose (a claims group) —
  // together they carry the whole file → group assignment archGraph.ts makes.
  for (const sm of md.matchAll(/^(#{2,3}) (.+)$\n([\s\S]*?)(?=^#{2,3} |$(?![\s\S]))/gm)) {
    const [, hashes, rawTitle, body] = sm;
    const title = rawTitle.replace(/\s*\(`[^`]*`\)\s*/g, " ").trim();
    // A directory the heading owns, e.g. `src/graph/nodes/` → "nodes/". The
    // graph root itself is never a dir claim (it would swallow everything).
    const dir = rawTitle.match(/\(`src\/graph\/([\w-]+)\/`\)/)?.[1];
    const modules: ArchModule[] = [];
    // Rows are 2 or 3 cells (`| module | role |`, `| file | status | purpose |`);
    // the name cell must be backticked, the rest joins into the role.
    for (const line of body.split("\n")) {
      const cells = line.match(/^\|(.+)\|\s*$/)?.[1].split(" | ").map((c) => c.trim());
      if (!cells || cells.length < 2 || !cells[0].startsWith("`")) continue;
      const nameCell = cells[0].replace(/`/g, "").trim();
      const name = cells[0].match(/`([^`]+)`/)?.[1] ?? nameCell;
      const role = collapse(cells.slice(1).join(" — "));
      if (name && role) modules.push({ name, nameCell, role });
    }
    let claims: string[] | undefined;
    if (!modules.length && hashes === "###") {
      claims = [...new Set(
        [...body.matchAll(/`([^`\n]+)`/g)]
          .map((m) => m[1].trim())
          .filter((t) => /^[\w./-]+\.tsx?$/.test(t) || /^[A-Za-z]\w*$/.test(t)),
      )];
      if (!claims.length) claims = undefined;
    }
    if (modules.length || dir || claims)
      groups.push({ title, modules, ...(dir ? { dir: `${dir}/` } : {}), ...(claims ? { claims } : {}) });
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

export type SuiteNode = {
  suite: string;
  ruleIds: string[];
  /** Domain prefixes of the citing rules. */
  domains: string[];
  /** Architecture-table groups whose module row matches the suite's stem ([] = untabled). */
  groups: string[];
};

/**
 * One node per cited suite, ordered by barycenter over its neighbours' layer
 * positions (mean of normalized domain + group indices) so the middle layer
 * runs roughly diagonal and edge crossings stay low. Suite → group is a stem
 * match: the suite's stem names its home module; no match is honest signal
 * (the module isn't in an architecture TABLE), never fuzzy-matched away.
 */
export function buildSuiteNodes(model: SpecRulesModel, groups: ArchGroup[]): SuiteNode[] {
  const domainAt = new Map(model.domains.map((d, i) => [d.prefix, i]));
  const groupAt = new Map(groups.map((g, i) => [g.title, i]));
  const norm = (i: number, n: number) => (n <= 1 ? 0.5 : i / (n - 1));
  const nodes = [...testCitationIndex(model)].map(([suite, ruleIds]) => {
    const stem = suite.replace(/\.test\.ts$/, "").split("/").pop()!;
    return {
      suite,
      ruleIds,
      domains: [...new Set(ruleIds.map((id) => id.split("-")[0]))],
      groups: groups
        .filter((g) =>
          g.modules.some((m) =>
            m.name === `${stem}.ts` || m.name.startsWith(`${stem}.`) || m.nameCell.includes(`${stem}.`)) ||
          (g.dir !== undefined && suite.startsWith(g.dir)))
        .map((g) => g.title),
    };
  });
  const keyOf = (s: SuiteNode) => {
    const ks = [
      ...s.domains.map((d) => norm(domainAt.get(d) ?? 0, model.domains.length)),
      ...s.groups.map((g) => norm(groupAt.get(g) ?? 0, groups.length)),
    ];
    return ks.reduce((a, b) => a + b, 0) / ks.length;
  };
  return nodes
    .map((n, i) => ({ n, i, k: keyOf(n) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.n);
}
