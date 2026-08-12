import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import postcss from "postcss";

// ─── Every stylesheet parses (the deploy-only failure class) ──────────────────
// Nothing local checks CSS syntax: tsc ignores it, the vitest env is node, and
// the dev server tolerates more than the production pipeline — so a malformed
// comment shipped in nodeCard.css (a paragraph whose opening `/*` was lost;
// postcss read SUMIFS' apostrophe as an unclosed string) and broke every Vercel
// deploy for seven hours while the suite stayed green. This runs the SAME
// parser the build uses over every stylesheet, so the failure moves from the
// deploy log to CI, named by file:line.

const SRC = path.resolve(__dirname, "..");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "pixi") continue; // deprecated renderer — not built
      cssFiles(p, out);
    } else if (e.name.endsWith(".css")) {
      out.push(p);
    }
  }
  return out;
}

describe("stylesheets parse with postcss (what `vite build` runs)", () => {
  it("every .css file under src/ parses", () => {
    const files = cssFiles(SRC);
    expect(files.length).toBeGreaterThan(3); // sweep sanity
    const broken: string[] = [];
    for (const file of files) {
      try {
        postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broken.push(`${path.relative(SRC, file)}: ${msg.split("\n")[0]}`);
      }
    }
    expect(
      broken,
      `CSS that will fail the production build (postcss):\n  ${broken.join("\n  ")}`,
    ).toEqual([]);
  });
});
