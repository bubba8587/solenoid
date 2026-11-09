// [[B14]] oneDesignSystem
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every dropdown wears the app's own chevron, sat in from its edge, never the browser's stock arrow pinned to it
// (DESIGN.md): each class a <select> carries must have a rule that turns `appearance` off.

const ROOT = join(__dirname, "../../src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(ROOT);
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n");
/** A select laid invisibly over a drawn label, so it shows no arrow of its own at all. */
const INVISIBLE = new Set(["table-popup__statselect"]);

describe("every dropdown wears the app chevron", () => {
  const classes = new Set<string>();
  for (const f of files.filter((p) => p.endsWith(".tsx"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<(?:select|LazySelect)\b[^>]*?className="([^"]+)"/gs)) classes.add(m[1].split(/\s+/)[0]);
    for (const m of src.matchAll(/<select\b[^>]*?className=\{`([a-z0-9_-]+)/gs)) classes.add(m[1]);
  }
  it("finds the dropdowns", () => expect(classes.size).toBeGreaterThan(5));
  for (const cls of [...classes].filter((c) => !INVISIBLE.has(c)).sort()) {
    it(cls, () => {
      const rules = [...css.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[1]);
      expect(rules.some((body) => /(^|[\s;])appearance:\s*none/.test(body)), `.${cls} keeps the native arrow`).toBe(true);
    });
  }
});
