// [[C24]] arraySemantics, [[value-semantics#Reading an input]]
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// `??` or `||`, with any whitespace (a line break included) before the literal read.
const SWALLOW = /(\?\?|\|\|)\s*(this|node)\.(string)?[Ll]iterals/g;

// Blanks comments out but keeps the line numbers.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, p: string) => p);
}

function offenders(): { file: string; lines: number[] }[] {
  const root = path.resolve(__dirname, "../../..");
  const dir = path.join(root, "src/graph/nodes");
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
  // The scaffolder's class templates are where new nodes start.
  files.push(path.join(root, "scripts/new-node.mjs"));
  const out: { file: string; lines: number[] }[] = [];
  for (const file of files) {
    const f = path.relative(root, file);
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const lines: number[] = [];
    for (const m of src.matchAll(SWALLOW)) {
      lines.push(src.slice(0, m.index).split("\n").length);
    }
    if (lines.length) out.push({ file: f, lines });
  }
  return out;
}

describe("wired-null swallow — swept, and stays swept", () => {
  it("no node reads an input with `?? literal`", () => {
    const found = offenders();
    expect(
      found.map((o) => `${o.file}:${o.lines.join(",")}`),
      `A wired-null swallow is back:\n` +
        found.map((o) => `  ${o.file} lines ${o.lines.join(", ")}`).join("\n") +
        `\n\nRead the input with \`readInput(inputs.x, this.literals.x ?? default)\` instead\n` +
        `of \`inputs.x?.[0] ?? this.literals.x\`, so a WIRED blank takes its role's\n` +
        `disposition rather than being replaced by whatever is typed in the node's box.\n` +
        `Omit the \`?? default\` when the input has a genuine OMITTED reading — readInput\n` +
        `then hands back undefined for that and null for a blank cable.\n` +
        `Spec: [[value-semantics#Reading an input]]. Worked examples of every\n` +
        `role: nodes/wiredNull.test.ts.`,
    ).toEqual([]);
  });
});
