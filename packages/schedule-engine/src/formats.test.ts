// [[C69]] ganttPackages
import { describe, it, expect } from "vitest";
import { readGan, isGanText, readXer, isXerText, writeMspdi, readMspdi, schedule, isoToSerial } from "./index";

const iso = (s: number) => new Date(Math.round((Math.floor(s + 1e-9) - 25569) * 86400000)).toISOString().slice(0, 10);

const GAN = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Shed" company="" webLink="" view-date="2026-03-02" view-index="0" gantt-divider-location="300" resource-divider-location="300" version="3.2" locale="en_US">
  <calendars>
    <day-types>
      <day-type id="0"/><day-type id="1"/>
      <default-week id="1" name="default" sun="1" mon="0" tue="0" wed="0" thu="0" fri="0" sat="1"/>
    </day-types>
    <date year="2026" month="3" date="9" type="HOLIDAY"/>
  </calendars>
  <tasks empty-milestones="true">
    <task id="0" name="Build" color="#8cb6ce" meeting="false" start="2026-03-02" duration="5" complete="40" expand="true">
      <task id="1" name="Foundation" meeting="false" start="2026-03-02" duration="2" complete="100" expand="true">
        <depend id="2" type="2" difference="0" hardness="Strong"/>
      </task>
      <task id="2" name="Frame &amp; roof" meeting="false" start="2026-03-04" duration="3" complete="0" expand="true">
        <depend id="3" type="1" difference="1" hardness="Strong"/>
      </task>
    </task>
    <task id="3" name="Paint" meeting="false" start="2026-03-05" duration="2" complete="0" expand="true"/>
    <task id="4" name="Done" meeting="true" start="2026-03-10" duration="0" complete="0" expand="true"/>
  </tasks>
</project>`;

const XER = [
  "ERMHDR\t19.12\t2026-03-02\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD",
  "%T\tPROJECT", "%F\tproj_id\tproj_short_name\tclndr_id\tplan_start_date", "%R\t1\tSHED\t5\t2026-03-02 08:00",
  "%T\tCALENDAR", "%F\tclndr_id\tday_hr_cnt\tclndr_data", "%R\t5\t8\t(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||3()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||4()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||5()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||6()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||7()())))(0||Exceptions()((0||0(d|46090)())))))",
  "%T\tPROJWBS", "%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\twbs_name", "%R\t10\t1\t\t1\tSHED", "%R\t11\t1\t10\t2\tBuild", "%R\t12\t1\t10\t3\tFinish",
  "%T\tTASK", "%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tphys_complete_pct\tcstr_type\tcstr_date\tact_start_date",
  "%R\t100\t1\t11\tA1000\tFoundation\tTT_Task\t16\t100\t\t\t2026-03-02 08:00",
  "%R\t101\t1\t11\tA1010\tFrame\tTT_Task\t24\t0\t\t\t",
  "%R\t102\t1\t12\tA1020\tPaint\tTT_Task\t16\t0\tCS_MSOA\t2026-03-09 08:00\t",
  "%R\t103\t1\t12\tA1030\tDone\tTT_FinMile\t0\t0\t\t\t",
  "%T\tTASKPRED", "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt", "%R\t1\t101\t100\tPR_FS\t0", "%R\t2\t102\t101\tPR_SS\t8", "%R\t3\t103\t102\tPR_FS\t0",
].join("\n");

describe("GanttProject .gan", () => {
  it("reads nested tasks, links under the predecessor, the week and holidays", () => {
    expect(isGanText(GAN)).toBe(true);
    const p = readGan(GAN);
    expect(p.title).toBe("Shed");
    expect(p.tasks.map((t) => t.name)).toEqual(["Build", "Paint", "Done"]);
    expect(p.tasks[0].children?.map((t) => t.name)).toEqual(["Foundation", "Frame & roof"]);
    expect(p.tasks[0].children![1].predecessors).toEqual([{ task: "Foundation", type: "FS", lag: 0 }]);
    expect(p.tasks[1].predecessors).toEqual([{ task: "Frame & roof", type: "SS", lag: 1 }]);
    expect(p.tasks[2].duration).toBe(0);
    expect(p.calendar).toEqual({ workingDays: true, weekendCode: 1, holidays: [isoToSerial("2026-03-09")] });
    const o = schedule({ tasks: p.tasks, start: p.start!, calendar: p.calendar });
    expect(iso(o.tasks.find((t) => t.name === "Frame & roof")!.start)).toBe("2026-03-04");
    expect(iso(o.tasks.find((t) => t.name === "Paint")!.start)).toBe("2026-03-05");
  });
});

describe("Primavera XER", () => {
  it("reads the WBS tree, tasks in hours, links, a floor constraint and an actual start", () => {
    expect(isXerText(XER)).toBe(true);
    const p = readXer(XER);
    expect(p.title).toBe("SHED");
    expect(iso(p.start!)).toBe("2026-03-02");
    expect(p.tasks.map((t) => t.name)).toEqual(["SHED"]);
    const shed = p.tasks[0].children!;
    expect(shed.map((t) => t.name)).toEqual(["Build", "Finish"]);
    expect(shed[0].children!.map((t) => [t.name, t.duration])).toEqual([["Foundation", 2], ["Frame", 3]]);
    expect(shed[1].children![0].predecessors).toEqual([{ task: "Frame", type: "SS", lag: 1 }]);
    expect(iso(shed[1].children![0].start!)).toBe("2026-03-09");
    expect(iso(shed[0].children![0].actualStart!)).toBe("2026-03-02");
    expect(shed[1].children![1].duration).toBe(0);
    expect(p.calendar).toEqual({ workingDays: true, weekendCode: 1, holidays: [46090] }); // 9 Mar 2026 off, the standard week
    const o = schedule({ tasks: p.tasks, start: p.start!, calendar: p.calendar });
    expect(iso(o.tasks.find((t) => t.name === "Paint")!.start)).toBe("2026-03-10"); // the floor on the holiday rolls to Tuesday
  });
});

describe("MSPDI write", () => {
  it("round-trips through the reader to the same schedule, in both modes", () => {
    const tasks = readGan(GAN).tasks;
    for (const precision of ["days", "minutes"] as const) {
      const cal = { workingDays: true, holidays: [isoToSerial("2026-03-09")!], precision };
      const o = schedule({ tasks, start: isoToSerial("2026-03-02")!, calendar: cal });
      const xml = writeMspdi(o, { title: "Shed", formatIso: iso, minutes: precision === "minutes", holidays: cal.holidays });
      const back = readMspdi(xml);
      expect(back.title).toBe("Shed");
      expect(back.calendar.holidays).toEqual([isoToSerial("2026-03-09")]);
      const again = schedule({ tasks: back.tasks, start: back.start, calendar: { ...back.calendar, precision } });
      for (const t of o.tasks) {
        const b = again.tasks.find((x) => x.name === t.name)!;
        expect([t.name, iso(b.start), iso(b.finish), b.float, b.critical]).toEqual([t.name, iso(t.start), iso(t.finish), t.float, t.critical]);
      }
      // The stored dates in the written file match what the reader's golden sees.
      for (const g of back.golden) expect(iso(g.start!)).toBe(iso(o.tasks.find((x) => x.name === g.name)!.start));
    }
  });
});

describe("MSPDI write: a typed start", () => {
  it("a start-no-earlier-than floor writes its date, so the re-read task keeps the floor", () => {
    const floor = isoToSerial("2026-03-11")!;
    for (const precision of ["days", "minutes"] as const) {
      const o = schedule({
        start: isoToSerial("2026-03-02")!, calendar: { workingDays: true, precision },
        tasks: [{ name: "A", duration: 2, predecessors: [] }, { name: "B", duration: 1, predecessors: [{ task: "A", type: "FS", lag: 0 }], start: floor }],
      });
      expect(o.tasks[1].floored).toBe(true);
      const back = readMspdi(writeMspdi(o, { formatIso: iso, minutes: precision === "minutes" }));
      expect(back.tasks[1].start == null ? null : iso(back.tasks[1].start)).toBe("2026-03-11");
    }
  });
});

describe("format border edge cases", () => {
  it("XER: a Sun-Thu week with 07:00-15:00 hours reads its weekend code and intervals", () => {
    const day = (n: number, on: boolean) => `(0||${n}()(${on ? "(0||0(s|07:00|f|15:00)())" : ""}))`;
    const blob = `(0||CalendarData()((0||DaysOfWeek()(${[1, 2, 3, 4, 5].map((n) => day(n, true)).join("")}${day(6, false)}${day(7, false)}))(0||Exceptions()())))`;
    const xer = XER.replace(/\(0\|\|CalendarData\(\)\(.*$/m, blob);
    const p = readXer(xer);
    expect(p.calendar.weekendCode).toBe(7);
    expect(p.calendar.intervals).toEqual([[420, 900]]);
  });

  it("GanttProject: two tasks with one name import as distinct tasks and the links follow", () => {
    const gan = GAN.replace(/name="Paint"/, 'name="Foundation"');
    const p = readGan(gan);
    const names = p.tasks.flatMap((t) => [t.name, ...(t.children ?? []).map((c) => c.name)]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Foundation (2)");
    expect(() => schedule({ tasks: p.tasks, start: p.start!, calendar: p.calendar })).not.toThrow();
  });

  it("MSPDI: a Minutes-mode finish on the stroke of midnight is written on the day it ended", () => {
    const o = schedule({ tasks: [{ name: "A", duration: 1, predecessors: [] }], start: isoToSerial("2026-03-02")!, calendar: { workingDays: true, precision: "minutes" } });
    const xml = writeMspdi(o, { title: "T", formatIso: iso, minutes: true });
    expect(xml).toContain("<Finish>2026-03-02T");
  });
});

describe("a seven-day week imports as every day counting", () => {
  const WORKDAY = "(0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())";
  const xerWeek = (days: number[]) => XER.replace(/\(0\|\|DaysOfWeek\(\)\([\s\S]*?\)\)\)\)\(0\|\|Exceptions/, () =>
    `(0||DaysOfWeek()(${[1, 2, 3, 4, 5, 6, 7].map((d) => `(0||${d}()(${days.includes(d) ? WORKDAY : ""}))`).join("")}))(0||Exceptions`);
  it("GanttProject with no day off", () => {
    const p = readGan(GAN.replace('sun="1"', 'sun="0"').replace('sat="1"', 'sat="0"'));
    expect(p.calendar.workingDays).toBe(false);
    expect(p.unsupported).toContain("holidays on a seven-day week");
  });
  it("P6 with work on all seven days, and a five-day P6 week stays Mon–Fri", () => {
    const seven = readXer(xerWeek([1, 2, 3, 4, 5, 6, 7]));
    expect(seven.calendar.workingDays).toBe(false);
    const five = readXer(xerWeek([2, 3, 4, 5, 6]));
    expect(five.calendar.workingDays).toBe(true);
    expect(five.calendar.weekendCode).toBe(1);
  });
  it("Project XML only when all seven days are listed as working; no WeekDays is still the standard week", () => {
    const day = (t: number) => `<WeekDay><DayType>${t}</DayType><DayWorking>1</DayWorking></WeekDay>`;
    const xml = (weekDays: string) => `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Calendars><Calendar><UID>1</UID><Name>Standard</Name>${weekDays}</Calendar></Calendars><Tasks><Task><UID>1</UID><Name>A</Name><Duration>PT8H0M0S</Duration></Task></Tasks></Project>`;
    expect(readMspdi(xml(`<WeekDays>${[1, 2, 3, 4, 5, 6, 7].map(day).join("")}</WeekDays>`)).calendar.workingDays).toBe(false);
    expect(readMspdi(xml("")).calendar.workingDays).toBe(true);
  });
});
