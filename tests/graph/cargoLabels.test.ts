// scripts/cargo-test.mjs names what each Rust test binary checks; a test file without a name would read as its bare
// file name in every run's summary.
import { it, expect } from "vitest";
import { readdirSync } from "node:fs";
// @ts-expect-error a plain ES module the cargo wrapper runs too
import { LABELS } from "../../scripts/cargo-test.mjs";

it("every Rust test file of the core and the graph core has a plain-English name", () => {
  const missing: string[] = [];
  for (const crate of ["solenoid-core", "solenoid-graph"]) {
    const labels = (LABELS as Record<string, Record<string, string>>)[crate];
    for (const f of readdirSync(`crates/${crate}/tests`).filter((x) => x.endsWith(".rs"))) {
      if (!labels[f.replace(/\.rs$/, "")]) missing.push(`${crate}/tests/${f}`);
    }
  }
  expect(missing, "add a line to LABELS in scripts/cargo-test.mjs").toEqual([]);
});
