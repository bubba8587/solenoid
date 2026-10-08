// [[D86]] blankRoles
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ARG_ROLES, type InputRole } from "../../src/graph/inputRoles";

// docs/settings-audit.md is the author's review sheet for ARG_ROLES; its formula table must say what the code does
// until the sheet is reviewed and archived (then this test goes with it).
it("the settings audit's formula table matches ARG_ROLES, function by function", () => {
  const doc = readFileSync("docs/settings-audit.md", "utf8");
  const from = doc.indexOf("## Formula functions");
  const table = doc.slice(from, doc.indexOf("\n## ", from + 5));
  const rows = new Map<string, string>();
  for (const line of table.split("\n")) {
    const m = /^\| ([A-Z0-9.]+) \| (.*) \|$/.exec(line);
    if (m && m[1] !== "SORTBY") rows.set(m[1], m[2].split("; ").map((p) => p.replace(/^(`[^`]*`|the rest) → /, "")).join("; "));
  }
  const read = (r: InputRole) =>
    r.kind === "required" ? "#SYNTAX!"
    : r.kind === "picks" ? (r.required ? "pick, none left = #SYNTAX!" : "pick")
    : r.blank === undefined ? "omitted" : typeof r.blank === "string" ? JSON.stringify(r.blank) : String(r.blank);
  const code = new Map<string, string>();
  for (const [fn, roles] of Object.entries(ARG_ROLES)) {
    if (fn === "SORTBY") continue; // 127 generated sort_order settings; the sheet sums them up in one row
    const byIndex = Object.keys(roles).filter((k) => k !== "rest").map(Number).sort((a, b) => a - b).map((k) => roles[k]);
    code.set(fn, [...byIndex, ...(roles.rest ? [roles.rest] : [])].map(read).join("; "));
  }
  expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(code));
});
