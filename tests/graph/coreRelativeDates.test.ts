// [[C44]] dateSerials, [[D99]] rustIsSpec
// Relative date phrases as a date entry reads them (`relative_date.rs`): frozen from chrono-node 2.10.3's answers to
// `parseDate(text, { relative: true, now })` in each case's zone, one Node process per zone, when the reading moved to
// the core. `want` is the day's serial, null for no date, "throws" where chrono threw, "absolute" for text that isn't a
// relative phrase. The same cases replay natively (`crates/solenoid-core/tests/relative_dates.rs`).
// FREEZE_CORE=relative-dates re-records the core's answers after a deliberate change.
import { it, expect } from "vitest";
import { frozen, sameJson } from "./coreFixtures";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { relativeDateCorpus, type RelativeCase } from "./relativeDateCorpus";

interface Case extends RelativeCase { want: unknown }

const coreReading = (c: RelativeCase): unknown => {
  const r = wasmInvokeSync<unknown>("engine_parse_date", { text: c.text.trim(), relative: true, now: c.now, zone: c.zone });
  return r !== null && typeof r === "object" && "relative" in r ? (r as { relative: unknown }).relative : "absolute";
};

it("reads relative phrases as chrono-node read them", () => {
  const cases = frozen<Case>("relative-dates", () => relativeDateCorpus().map((c) => ({ ...c, want: coreReading(c) })));
  expect(cases.length).toBeGreaterThan(40_000);
  const bad = cases.filter((c) => !sameJson(coreReading(c), c.want));
  expect(bad.slice(0, 5).map((c) => ({ ...c, got: coreReading(c) }))).toEqual([]);
}, 30_000);
