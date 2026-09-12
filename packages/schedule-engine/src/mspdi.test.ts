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
    expect(plan.calendar).toEqual({ workingDays: true, weekendCode: 1, holidays: [isoToSerial("2026-01-19")], intervals: [[480, 720], [780, 1020]] });
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

  it.each(["days", "minutes"] as const)("every fixture's stored dates match the engine in %s mode, except the named divergences", (precision) => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".mspdi.xml"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const plan = readMspdi(readFileSync(join(DIR, f), "utf8"));
      const out = schedule({ tasks: plan.tasks, start: plan.start, calendar: { ...plan.calendar, precision } });
      const skip = divergences[f] ?? {};
      for (const g of plan.golden) {
        const t = out.tasks.find((x) => x.name === g.name);
        expect(t, `${f}: ${g.name} missing from the engine's output`).toBeDefined();
        const check = (field: string, ours: unknown, theirs: unknown) => {
          if (theirs == null || skip[g.name]?.[field]) return;
          expect(ours, `${f}: ${g.name}.${field}`).toEqual(theirs);
        };
        check("start", iso(t!.start), iso(g.start));
        check("finish", iso(t!.finish - (precision === "minutes" ? 1e-9 : 0)), iso(g.finish));
        check("totalSlack", t!.float, g.totalSlack);
        check("critical", t!.critical, g.critical);
      }
    }
  });
});

describe("review pins: elapsed durations and lags, a missing StartDate", () => {
  const file = (tasks: string, head = "") => `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project">${head}<Tasks>${tasks}</Tasks></Project>`;
  const task = (uid: number, name: string, dur: string, fmt: number, extra = "") =>
    `<Task><UID>${uid}</UID><Name>${name}</Name><OutlineLevel>1</OutlineLevel><Duration>${dur}</Duration><DurationFormat>${fmt}</DurationFormat><Start>2026-01-05T08:00:00</Start>${extra}</Task>`;

  it("an elapsed-duration task (ed) is measured in 24-hour days", () => {
    const plan = readMspdi(file(task(1, "Cure", "PT48H0M0S", 8)));
    expect(plan.tasks[0].duration).toBe(2);
    expect(plan.tasks[0].elapsed).toBe(true);
  });

  it("an elapsed lag is the even format code; 20 / 52 are elapsed percent lags; 19 is a plain percent", () => {
    const link = (fmt: number, tenths: number) => `<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>${tenths}</LinkLag><LagFormat>${fmt}</LagFormat></PredecessorLink>`;
    const plan = readMspdi(file(task(1, "A", "PT8H0M0S", 7) + task(2, "B", "PT16H0M0S", 7, link(8, 2 * 24 * 60 * 10)) + task(3, "C", "PT16H0M0S", 7, link(19, 50)) + task(4, "D", "PT16H0M0S", 7, link(39, 8 * 60 * 10))));
    expect(plan.tasks[1].predecessors[0]).toEqual({ task: "A", type: "FS", lag: 2, elapsed: true });
    expect(plan.tasks[2].predecessors[0]).toEqual({ task: "A", type: "FS", lag: 1 });
    expect(plan.tasks[3].predecessors[0]).toEqual({ task: "A", type: "FS", lag: 1 }); // 39 = estimated days, not elapsed
  });

  it("a file with no StartDate starts at its earliest stored task start", () => {
    const plan = readMspdi(file(task(1, "A", "PT8H0M0S", 7)));
    expect(iso(plan.start)).toBe("2026-01-05");
  });
});
