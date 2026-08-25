import { describe, it, expect } from "vitest";
import { buildCatalog } from "./catalogUtils";
import { formulaFunctionNames } from "./excelFormula";
import { initPackFormulas } from "./formulaExtensions";
import { FX_FUNCTION_NAMES } from "./excelFunctions";
import { NODE_OPS } from "./nodeOps";
import { despace } from "./formulaNodeParity";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "./AddNodeMenu";

// NAME-4 (docs/rules.md): an ALL-CAPS (incl. dotted) leaf/op label claims a formula-callable
// name; anything else is Title Case. The label is a card title (NAME-3), so the case IS the
// signal — an all-caps name a user can't call, or a Title-Case name that shadows a real Excel
// function, both misreport what the node does.

// Acronym proper-nouns + the Solenoid-only ISNULL op may stay all-caps though they don't dispatch.
const ALLCAPS_ALLOW = new Set(["PCA", "BMI", "TDEE", "SVG", "KPI", "ISNULL"]);
// The flagship Convert leaf may stay Title Case though CONVERT dispatches.
const TITLECASE_EXCEL_ALLOW = new Set(["CONVERT"]);

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";
// One all-caps identifier token (a name a user could type): letters/digits/dots, no lowercase.
// Tested on ORIGINAL casing — "NumberInput" (from "Number Input") is Title Case, not all-caps.
// (despace() UPPERCASES, so it can't be used for the case test — strip spaces case-preserving.)
const isAllCapsTok = (s: string) => /^[A-Z][A-Z0-9.]*$/.test(s);
const strip = (s: string) => s.replace(/\s+/g, "");
// An "X / Y" (or "X, Y") label enumerates several names — split and check each (case preserved).
const tokens = (label: string) => label.split(/[/,]/).map((t) => strip(t)).filter(Boolean);

describe("NAME-4 — ALL CAPS ⟺ callable function name", () => {
  initPackFormulas();
  const callable = new Set(formulaFunctionNames().map((n) => n.toUpperCase())); // Excel + Solenoid dispatch
  const excel = new Set(FX_FUNCTION_NAMES.map((n) => n.toUpperCase())); // real Excel (Formula.js) names

  const leafLabels: string[] = [];
  const walk = (entries: CatalogEntry[]): void => {
    for (const e of entries) {
      if (isCategory(e)) { walk(e.children); continue; }
      if (isPair(e)) { walk(e.children); continue; }
      if (!(e as NodeCatalogEntry).hidden) leafLabels.push(e.label);
    }
  };
  walk(buildCatalog(false));

  const opLabels = (NODE_OPS as Array<{ ops?: Array<{ label: string }> }>)
    .flatMap((d) => d.ops ?? []).map((o) => o.label);

  it("every ALL-CAPS leaf/op label token is callable or allowlisted", () => {
    const bad: string[] = [];
    for (const [kind, labels] of [["leaf", leafLabels], ["op", opLabels]] as const) {
      for (const label of labels) {
        for (const tok of tokens(label)) {
          const up = tok.toUpperCase();
          if (isAllCapsTok(tok) && !callable.has(up) && !ALLCAPS_ALLOW.has(up)) {
            bad.push(`${kind} "${label}" → ${tok} is ALL CAPS but not a callable function`);
          }
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("no Title-Case leaf label despaces to a real Excel function (except Convert)", () => {
    const bad: string[] = [];
    for (const label of leafLabels) {
      if (!/[a-z]/.test(label)) continue; // not Title Case
      const name = despace(label).toUpperCase();
      if (excel.has(name) && !TITLECASE_EXCEL_ALLOW.has(name)) {
        bad.push(`leaf "${label}" despaces to real Excel ${name} — either ALL-CAPS it or rename`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
