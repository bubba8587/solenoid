// [[D5]] searchWiderThanLabel, [[C19]] namingModel
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { runSearchSamples } from "../../scripts/search-samples";

// One query per kind of searchable row (card label, family name, op, Excel alias, retired name, keyword, typo…).
describe("Add-menu search samples", () => {
  const rows = runSearchSamples();
  if (process.env.SEARCH_SAMPLES_OUT) fs.writeFileSync(process.env.SEARCH_SAMPLES_OUT, JSON.stringify(rows, null, 2));

  it.each(rows.map((r) => [r.kind, r.query, r] as const))("%s: %s", (_kind, _query, r) => {
    expect(r.pass, `${r.query} → ${r.top.map((t) => t.label).join(" | ")}`).toBe(true);
  });
});
