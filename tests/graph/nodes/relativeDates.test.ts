import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseDate, parseDateToSerial, isRelativeDateText } from "../../../src/graph/nodes/dateSerial";
import { DateInputNode } from "../../../src/graph/nodes/control";
import { settingsStore } from "../../../src/graph/settingsStore";
import { alertStore } from "../../../src/graph/alertStore";

// Relative dates are an OPT-IN (Settings ▸ Data ▸ Relative dates, author-requested 2026-08-21):
// off, every phrase stays unparseable (a stored date is a fixed calendar day); on, the Date
// Input resolves it against now on every pass and Alerts when the resolved day moves.
const d = (s: string) => parseDateToSerial(s);
const wed = new Date(2026, 2, 18, 15, 0, 0); // Wed 18 Mar 2026, local

describe("parseDate with relative phrases", () => {
  it("refuses them by default (unchanged)", () => {
    for (const t of ["today", "tomorrow", "next friday", "in 3 days", "3 days ago"]) {
      expect(isRelativeDateText(t)).toBe(true);
      expect(parseDate(t)).toBeNaN();
    }
    expect(isRelativeDateText("15 March 1996")).toBe(false);
  });
  it("resolves them against `now` when asked, as whole days", () => {
    expect(parseDate("today", { relative: true, now: wed })).toBe(d("2026-03-18"));
    expect(parseDate("tomorrow", { relative: true, now: wed })).toBe(d("2026-03-19"));
    expect(parseDate("yesterday", { relative: true, now: wed })).toBe(d("2026-03-17"));
    expect(parseDate("in 3 days", { relative: true, now: wed })).toBe(d("2026-03-21"));
    expect(parseDate("3 days ago", { relative: true, now: wed })).toBe(d("2026-03-15"));
    expect(parseDate("friday", { relative: true, now: wed })).toBe(d("2026-03-20"));      // the coming Friday (forward-looking)
    expect(parseDate("next friday", { relative: true, now: wed })).toBe(d("2026-03-27")); // chrono: the Friday of NEXT week
    expect(parseDate("next week", { relative: true, now: wed })).toBe(d("2026-03-25"));
    expect(parseDate("in 2 weeks", { relative: true, now: wed })).toBe(d("2026-04-01"));
    expect(parseDate("nonsense today foo", { relative: true, now: wed })).toBeNaN(); // trailing noise still fails
    expect(parseDate("15 March 1996", { relative: true, now: wed })).toBe(d("1996-03-15")); // absolute text unaffected
  });
});

describe("Date Input under the opt-in", () => {
  const prev = settingsStore.get("relativeDates");
  beforeEach(() => { alertStore.clear(); });
  afterEach(() => { settingsStore.set("relativeDates", prev); });

  it("off: a relative phrase is a blank, not a date", () => {
    settingsStore.set("relativeDates", false);
    const n = new DateInputNode({ date: "tomorrow" });
    expect(n.data().result).toBeNull();
  });
  it("on: it resolves, and an Alert fires only when the resolved day MOVES between passes", () => {
    settingsStore.set("relativeDates", true);
    const n = new DateInputNode({ date: "today" });
    const first = n.data().result as number;
    expect(typeof first).toBe("number");
    expect(first).toBe(Math.floor(parseDate("today", { relative: true }) as number));
    n.data(); // same day → no alert
    expect(alertStore.list().filter((e) => e.nodeId === n.id)).toHaveLength(0);
    // Simulate the clock crossing midnight by moving the remembered day back one.
    (n as unknown as { lastRelativeSerial: number }).lastRelativeSerial = first - 1;
    n.data();
    const fired = alertStore.list().filter((e) => e.nodeId === n.id);
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe("warning");
    expect(fired[0].message).toContain("now resolves to");
  });
  it("an absolute date keeps its fixed serial regardless of the setting", () => {
    settingsStore.set("relativeDates", true);
    expect(new DateInputNode({ date: "15-Mar-2026" }).data().result).toBe(d("2026-03-15"));
  });
});
