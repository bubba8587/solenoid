import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Guard against raw control bytes in source (v1.0 audit, quality): a literal
// NUL in a .ts file makes git treat it as BINARY and grep/ripgrep skip it —
// including the repo's own agent-driven maintenance sweeps, which silently
// missed two tricky-subsystem files. Write the backslash-u0000 escape instead
// (identical at runtime).

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|rs|json|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe("source hygiene", () => {
  it("no source file contains a raw NUL byte", () => {
    const offenders: string[] = [];
    for (const f of [...walk("src"), ...walk("src-tauri/src")]) {
      if (readFileSync(f).includes(0)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
