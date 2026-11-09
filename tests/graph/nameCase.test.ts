// [[B16]] oneFormulaSurface, [[formula-language#Excel names on nodes]]
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import { formulaFunctionNames, FRAME_SURFACE_NAMES } from "../../src/graph/excelFunctions";
import { EXCEL_NAMES } from "./fixtures/excelNames";
import { NODE_OPS } from "../../src/graph/nodeOps";
import { despace } from "../../src/graph/formulaNodeParity";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "../../src/graph/AddNodeMenu";

const ALLCAPS_ALLOW = new Set(["BMI", "TDEE", "SVG", "KPI", "ISNULL"]);
const TITLECASE_EXCEL_ALLOW = new Set(["CONVERT"]);

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";
// On the label as written: despace() uppercases, so "Value Input" would read as all-caps.
const isAllCapsTok = (s: string) => /^[A-Z][A-Z0-9.]*$/.test(s);
const strip = (s: string) => s.replace(/\s+/g, "");
const tokens = (label: string) => label.split(/[/,]/).map((t) => strip(t)).filter(Boolean);

describe("[[B16]] oneFormulaSurface — ALL CAPS ⟺ callable function name", () => {
  initPackFormulas();
  const callable = new Set([...formulaFunctionNames(), ...Object.keys(FRAME_SURFACE_NAMES)].map((n) => n.toUpperCase()));
  const excel = EXCEL_NAMES; // real Excel names, as Formula.js listed them

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
