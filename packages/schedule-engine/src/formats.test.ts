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
  "%T\tCALENDAR", "%F\tclndr_id\tday_hr_cnt\tclndr_data", "%R\t5\t8\t(0||CalendarData()(...))",
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
    expect(p.unsupported.some((u) => u.includes("clndr_data"))).toBe(true);
    const o = schedule({ tasks: p.tasks, start: p.start!, calendar: p.calendar });
    expect(iso(o.tasks.find((t) => t.name === "Paint")!.start)).toBe("2026-03-09");
  });
});

describe("MSPDI write", () => {
  it("round-trips through the reader to the same schedule, in both modes", () => {
    const tasks = readGan(GAN).tasks;
    for (const precision of ["days", "minutes"] as const) {
      const cal = { workingDays: true, holidays: [isoToSerial("2026-03-09")!], precision };
      const o = schedule({ tasks, start: isoToSerial("2026-03-02")!, calendar: cal });
      const xml = writeMspdi(o, { title: "Shed", formatIso: iso, minutes: precision === "minutes", holidays: cal.holidays });
      expect(xml).toContain("<Task>");
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
