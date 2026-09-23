// [[C62]] paletteAllOrNone, [[B14]] oneDesignSystem
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("theme tokens", () => {
  it("every var(--token) the app reads is defined somewhere, in CSS or written from code", () => {
    const files = walk("src").map((f) => ({ f, s: readFileSync(f, "utf8") }));
    const defined = new Set<string>();
    for (const { s } of files) {
      for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
      for (const m of s.matchAll(/["'`](--[\w-]+)/g)) defined.add(m[1]);
    }
    for (const d of [...defined]) if (d.startsWith("--sock-")) defined.add(`${d}-ring`);
    const undefinedUses: string[] = [];
    for (const { f, s } of files) {
      for (const m of s.matchAll(/var\(\s*(--[\w-]+)(\$\{)?/g)) {
        if (m[2] || m[1].endsWith("-")) continue; // a name built in a template literal, or a family written as --sock-*
        if (!defined.has(m[1])) undefinedUses.push(`${f}: ${m[1]}`);
      }
    }
    // A fallback-only token hides a typo: --accent-contrast drew white on a gold accent where --accent-ink is dark.
    expect(undefinedUses).toEqual([]);
  });
});
