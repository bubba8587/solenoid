// [[composite-nodes#Packs]], [[C25]] firstClassUnits, [[C24]] arraySemantics

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numOut, strIn, anyComboIn, numListOut, frameOut } from "./shared";
import type { FrameValue } from "../frame";
import { cardShapeOnCore, type Shape } from "../frameShape";
import { type SolError } from "../errorValue";
import { ELEMENTS, ELEMENT_BY_SYMBOL, type ElementMeta } from "./chemistryOps";
import type { FormatAnnotation } from "../formatAnnotationStore";

/** Rows 1–7 are the main body, row 8 the visual gap, rows 9–10 the detached f-block. */
export function elementCell(n: number): { row: number; col: number } {
  if (n === 1) return { row: 1, col: 1 };
  if (n === 2) return { row: 1, col: 18 };
  if (n <= 4) return { row: 2, col: n - 2 };          // Li, Be
  if (n <= 10) return { row: 2, col: n + 8 };         // B … Ne
  if (n <= 12) return { row: 3, col: n - 10 };        // Na, Mg
  if (n <= 18) return { row: 3, col: n };             // Al … Ar
  if (n <= 36) return { row: 4, col: n - 18 };        // K … Kr
  if (n <= 54) return { row: 5, col: n - 36 };        // Rb … Xe
  if (n <= 56) return { row: 6, col: n - 54 };        // Cs, Ba
  if (n <= 71) return { row: 9, col: n - 53 };        // La … Lu (f-block)
  if (n <= 86) return { row: 6, col: n - 68 };        // Hf … Rn
  if (n <= 88) return { row: 7, col: n - 86 };        // Fr, Ra
  if (n <= 103) return { row: 10, col: n - 85 };      // Ac … Lr (f-block)
  return { row: 7, col: n - 100 };                    // Rf … Og
}

export function searchElements(query: string): ElementMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return ELEMENTS;
  const scored: Array<[number, ElementMeta]> = [];
  for (const e of ELEMENTS) {
    const sym = e.symbol.toLowerCase();
    const name = e.name.toLowerCase();
    let score: number | null = null;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 3;
    else if (String(e.n) === q) score = 4;
    if (score !== null) scored.push([score, e]);
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].n - y[1].n).map(([, e]) => e);
}

/** One element, or one per wired symbol, name or atomic number: its weight, its atomic number, and every property
 *  as a row of the Elements frame ([[C24]] arraySemantics). */
export class ElementNode extends GraphNode {
  label: string;
  /** The card's own pick, read while nothing is wired. */
  symbol: string;
  /** The row the tile shows, 0-based; view state. */
  row = 0;
  cachedResult: FrameValue | SolError | null = null;
  width = 300;
  height = 330;

  constructor(init?: { label?: string; symbol?: string }) {
    super("Element");
    this.symbol = init?.symbol && ELEMENT_BY_SYMBOL.has(init.symbol) ? init.symbol : "H";
    this.label = init?.label ?? "Element";
    this.addInput("symbol", anyComboIn("Element"));
    this.addOutput("mass", numListOut("g/mol"));
    this.addOutput("number", numListOut("Z"));
    this.addOutput("elements", frameOut("Elements"));
  }

  frameShape(): Shape | null {
    return cardShapeOnCore(this, "elements", {});
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "mass" ? { format: "auto", unit: "custom", customUnit: " g/mol" } : undefined;
  }
}

export class MolarMassNode extends GraphNode {
  label: string;
  stringLiterals: Record<string, string> = {};
  cachedResult: number | SolError | null = null;
  width = 210;
  height = 140;

  constructor(init?: { label?: string }) {
    super("MolarMass");
    this.label = init?.label ?? "Molar Mass";
    this.addInput("formula", strIn("Formula"));
    this.addOutput("result", numOut("g/mol"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}
