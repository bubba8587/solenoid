import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── implReteFree: the formula path must not pull in rete or the socket lattice ──────
// The headless evaluator (run-graph, the Expression host) loads excelFormula →
// excelFunctions → the shared op modules. None of that may reach rete or
// sockets.ts: the shared-impl modules exist precisely so both surfaces call one
// implementation WITHOUT the formula surface loading the editor (rules.md implReteFree —
// previously UNENFORCED, and violated twice: excelFunctions reached rete through
// nodes/date.ts and nodes/convert.ts until the serial layer and the unit table
// were extracted to dateSerial.ts / convertUnits.ts).
//
// Walk the RELATIVE import graph from the formula roots and assert no visited
// module imports rete or sockets. The walk is static (import statements only),
// which is exactly the property that matters — a type-only import still loads
// the module at runtime under Vite unless marked `import type`, so plain
// `import ... from "rete"` anywhere in the closure fails here.

const SRC = path.resolve(__dirname, "../../src/graph");
const ROOTS = ["excelFormula.ts", "excelFunctions.ts"];
const BANNED = /^rete($|-)/;
const BANNED_LOCAL = new Set(["sockets"]); // the lattice — nodes/shared.ts imports it, so shared is transitively banned too

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

describe("implReteFree — the formula path is rete-free", () => {
  it("no module reachable from excelFormula/excelFunctions imports rete or sockets", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const queue: Array<{ file: string; via: string }> = ROOTS.map((r) => ({ file: path.join(SRC, r), via: r }));
    while (queue.length) {
      const { file, via } = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        const short = path.relative(SRC, file);
        if (BANNED.test(spec)) offenders.push(`${via} → ${short} imports "${spec}"`);
        const local = resolveLocal(file, spec);
        if (!local) continue;
        const stem = path.basename(local).replace(/\.tsx?$/, "");
        if (BANNED_LOCAL.has(stem)) offenders.push(`${via} → ${short} imports "${spec}" (the socket lattice)`);
        queue.push({ file: local, via: `${via} → ${short}` });
      }
    }
    expect(seen.size).toBeGreaterThan(5); // the walk actually walked
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
