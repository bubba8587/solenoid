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

// ─── The Wrap Rule (DESIGN.md §3) ────────────────────────────────────────────
// `text-wrap` is a shorthand over `text-wrap-mode` + `text-wrap-style`, so
// `text-wrap: pretty` on an element that also carries `white-space: nowrap`
// resets the mode back to `wrap` and quietly turns a one-line ellipsis-clipped
// label into a wrapping block. The longhand can only ever change the style, so
// the rule is: only the longhand ships, and only with a style value.
describe("wrap styles use the text-wrap-style longhand (DESIGN.md §3)", () => {
  const ALLOWED = new Set(["balance", "pretty"]);

  it("no stylesheet uses the text-wrap shorthand", () => {
    const bad: string[] = [];
    for (const file of cssFiles(SRC)) {
      postcss.parse(fs.readFileSync(file, "utf8"), { from: file }).walkDecls(
        /^text-wrap$/i,
        (d) => {
          bad.push(`${path.relative(SRC, file)}: ${d.prop}: ${d.value}`);
        },
      );
    }
    expect(
      bad,
      "The `text-wrap` shorthand also resets text-wrap-mode, which can undo a " +
        `white-space: nowrap. Use text-wrap-style:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every text-wrap-style is balance or pretty", () => {
    const bad: string[] = [];
    for (const file of cssFiles(SRC)) {
      postcss.parse(fs.readFileSync(file, "utf8"), { from: file }).walkDecls(
        /^text-wrap-style$/i,
        (d) => {
          if (!ALLOWED.has(d.value.trim().toLowerCase())) {
            bad.push(`${path.relative(SRC, file)}: ${d.prop}: ${d.value}`);
          }
        },
      );
    }
    expect(
      bad,
      `Only balance and pretty are in the design system:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });
});
