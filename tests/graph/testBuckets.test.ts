// Every test file belongs to one bucket (tests/buckets.mjs), so `node scripts/test-bucket.mjs <tier|domain>` runs all
// of a layer's tests and none goes missing from every bucket.
import { it, expect } from "vitest";
import { globSync } from "node:fs";
import * as path from "node:path";
// @ts-expect-error a plain ES module the runner script reads too
import { TIERS, domainOf, tierOf } from "../buckets.mjs";

const ROOT = path.resolve(__dirname, "../..");

it("every test file sits in a domain, and every domain in one tier", () => {
  const files = ["tests/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"]
    .flatMap((g) => globSync(g, { cwd: ROOT }))
    .filter((f) => !f.includes("node_modules"));
  expect(files.filter((f) => !domainOf(f)), "add a rule to tests/buckets.mjs").toEqual([]);
  const domains = Object.values(TIERS as Record<string, string[]>).flat();
  expect(new Set(domains).size, "a domain sits in exactly one tier").toBe(domains.length);
  for (const f of files) expect(tierOf(domainOf(f)), f).toBeDefined();
});
