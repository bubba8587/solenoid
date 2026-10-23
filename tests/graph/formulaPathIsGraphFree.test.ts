// [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── [[C17]] shareImpl: the formula path never pulls in the graph model or the socket lattice ──────
// The headless evaluator (run-graph, the Expression host) loads excelFormula → excelFunctions → the shared op
// modules. Walk the relative import graph from those roots (every pack's packs/*Formulas.ts included) and fail on
// any module that imports the graph model or sockets.ts. `import type` is skipped: only a value import loads the
// module at run time (tree/specs/floors/engineering.md § The formula path is graph-free).

const SRC = path.resolve(__dirname, "../../src/graph");
const PACK_FORMULAS = fs.readdirSync(path.join(SRC, "packs")).filter((f) => f.endsWith("Formulas.ts")).map((f) => `packs/${f}`);
const ROOTS = ["excelFormula.ts", "excelFunctions.ts", ...PACK_FORMULAS];
const BANNED_LOCAL = new Set(["sockets", "graphModel", "graphEditor", "dataflowEngine"]);

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  // `import ... from "x"` / `export ... from "x"`, skipping `import type`.
  for (const m of src.matchAll(/^(import|export)\s+([^;]*?)from\s+["']([^"']+)["']/gms)) {
    if (/^type\s/.test(m[2].trim())) continue;
    out.push(m[3]);
  }
  return out;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

describe("[[C17]] shareImpl — the formula path is graph-free", () => {
  it("no module reachable from excelFormula/excelFunctions/packs/*Formulas imports the graph model or sockets", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const queue: Array<{ file: string; via: string }> = ROOTS.map((r) => ({ file: path.join(SRC, r), via: r }));
    while (queue.length) {
      const { file, via } = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        const short = path.relative(SRC, file);
        const local = resolveLocal(file, spec);
        if (!local) continue;
        const stem = path.basename(local).replace(/\.tsx?$/, "");
        if (BANNED_LOCAL.has(stem)) offenders.push(`${via} → ${short} imports "${spec}"`);
        queue.push({ file: local, via: `${via} → ${short}` });
      }
    }
    expect(PACK_FORMULAS.length).toBeGreaterThan(0); // the pack roots were found
    expect(seen.size).toBeGreaterThan(5); // the walk actually walked
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
