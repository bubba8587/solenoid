import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readMspdi, schedule, parseXml, xsdDurationToHours, isoToSerial } from "./index";

const DIR = join(__dirname, "../../../fixtures/schedule");
const iso = (s: number | null) => (s == null ? null : new Date((s - 25569) * 86400000).toISOString().slice(0, 10));
const divergences = JSON.parse(readFileSync(join(DIR, "divergences.json"), "utf8")) as Record<string, Record<string, Record<string, string>>>;

describe("xml + xsd helpers", () => {
  it("parses elements, text, entities, CDATA and comments; converts durations and dates", () => {
    const root = parseXml('<?xml version="1.0"?><A><!-- c --><B>x &amp; y</B><C><![CDATA[<raw>]]></C><D/></A>');
    expect(root.name).toBe("A");
    expect(root.children.map((c) => c.name)).toEqual(["B", "C", "D"]);
    expect(root.children[0].text).toBe("x & y");
    expect(root.children[1].text).toBe("<raw>");
    expect(xsdDurationToHours("PT8H0M0S")).toBe(8);
    expect(xsdDurationToHours("P1DT4H")).toBe(28);
    expect(xsdDurationToHours("nope")).toBeNull();
    expect(iso(isoToSerial("2026-01-05T08:00:00"))).toBe("2026-01-05");
  });
});

describe("MSPDI read", () => {
  it("reads the authored remodel: nesting by OutlineLevel, link codes and lag tenths, SNET as a floor, the calendar", () => {
    const plan = readMspdi(readFileSync(join(DIR, "authored-remodel.mspdi.xml"), "utf8"));
    expect(plan.title).toBe("Kitchen remodel");
    expect(iso(plan.start)).toBe("2026-01-05");
    expect(plan.hoursPerDay).toBe(8);
    expect(plan.calendar).toEqual({ workingDays: true, weekendCode: 1, holidays: [isoToSerial("2026-01-19")] });
    expect(plan.tasks.map((t) => t.name)).toEqual(["Demolition", "Rough-in", "Drywall", "Paint", "Cabinets", "Countertops", "Appliances", "Final inspection"]);
    expect(plan.tasks[1].children?.map((t) => t.name)).toEqual(["Plumbing rough-in", "Electrical rough-in"]);
    expect(plan.tasks[2].predecessors).toEqual([{ task: "Rough-in", type: "FS", lag: 0 }]);
    expect(plan.tasks[6].predecessors).toEqual([{ task: "Cabinets", type: "SS", lag: 1 }]);
    expect(iso(plan.tasks[6].start!)).toBe("2026-01-26");
    expect(plan.tasks[7].duration).toBe(0);
    expect(iso(plan.tasks[7].deadline!)).toBe("2026-01-30");
    expect(plan.unsupported).toEqual([]);
    expect(plan.golden.find((g) => g.name === "Paint")?.totalSlack).toBe(2);
  });

  it("every fixture's stored dates match the engine, except the named divergences", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".mspdi.xml"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const plan = readMspdi(readFileSync(join(DIR, f), "utf8"));
      const out = schedule({ tasks: plan.tasks, start: plan.start, calendar: plan.calendar });
      const skip = divergences[f] ?? {};
      for (const g of plan.golden) {
        const t = out.tasks.find((x) => x.name === g.name);
        expect(t, `${f}: ${g.name} missing from the engine's output`).toBeDefined();
        const check = (field: string, ours: unknown, theirs: unknown) => {
          if (theirs == null || skip[g.name]?.[field]) return;
          expect(ours, `${f}: ${g.name}.${field}`).toEqual(theirs);
        };
        check("start", iso(t!.start), iso(g.start));
        check("finish", iso(t!.finish), iso(g.finish));
        check("totalSlack", t!.float, g.totalSlack);
        check("critical", t!.critical, g.critical);
      }
    }
  });
});
