// [[C69]] ganttPackages, [[D99]] rustIsSpec, [[D68]] importUnsupportedIsNamed
// The plan-file readers held to their frozen answers (fixtures/core/plan-readers.json.gz, the TS readers' before they
// moved to crates/solenoid-schedule): the corpus, seeded MSPDI files that walk every field the reader looks at,
// GanttProject and XER variations, telling the format, and predecessor text. A key left out and one set null read
// the same.
import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { frozen } from "./coreFixtures";
import { readPlanFile, parsePredecessors } from "../../src/graph/engineWasm/solenoid_graph.js";

type Case = { kind: "mspdi" | "gan" | "xer" | "sniff" | "pred"; text: string; names?: string[]; want?: unknown };

/** The core's read as the TS reader answered: the plan without its format, or `!` and the error. */
function read(kind: string, text: string): unknown {
  const got = JSON.parse(readPlanFile(text, kind)) as Record<string, unknown>;
  if ("error" in got) return `!${got.error as string}`;
  delete got.format;
  return got;
}

/** The format a sniff names; the TS answered with its three sniffers' verdicts, read Project XML first, then XER. */
const sniffed = (w: unknown) => (Array.isArray(w) ? (w[0] ? "mspdi" : w[2] ? "xer" : w[1] ? "gan" : null) : w);

const noNulls = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(noNulls) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, noNulls(x)])) : v;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A seeded MSPDI file: a calendar (maybe based, with weekdays off, working times and exceptions), tasks across
 *  outline levels with every constraint, flag and duration format, and links of every type and lag format. */
function mspdi(seed: number): string {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const day = (d: number) => `2026-03-${String(1 + (d % 28)).padStart(2, "0")}T08:00:00`;
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((t) => {
    const working = r() < 0.75 ? 1 : 0;
    const times = working && r() < 0.4 ? `<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>${pick(["17:00:00", "16:30:00"])}</ToTime></WorkingTime></WorkingTimes>` : "";
    return `<WeekDay><DayType>${t}</DayType><DayWorking>${working}</DayWorking>${times}</WeekDay>`;
  });
  if (r() < 0.3) weekdays.push(`<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>${day(9)}</FromDate><ToDate>${day(10)}</ToDate></TimePeriod></WeekDay>`);
  const exceptions = r() < 0.5 ? `<Exceptions><Exception><DayWorking>${pick([0, 0, 1])}</DayWorking><TimePeriod><FromDate>${day(12)}</FromDate><ToDate>${day(pick([12, 13]))}</ToDate></TimePeriod></Exception></Exceptions>` : "";
  const based = r() < 0.3;
  const cal1 = `<Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar>${based ? "" : `<WeekDays>${weekdays.join("")}</WeekDays>`}${exceptions}</Calendar>`;
  const cal2 = `<Calendar><UID>2</UID><Name>Night</Name><BaseCalendarUID>${based ? 3 : -1}</BaseCalendarUID><WeekDays>${weekdays.slice().reverse().join("")}</WeekDays></Calendar>`;
  const cal3 = `<Calendar><UID>3</UID><Name>Base</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${weekdays.join("")}</WeekDays></Calendar>`;
  const n = 2 + Math.floor(r() * 8);
  const names = ["Dig", "Pour", "Frame", "Roof", "Paint", "Dig", "Wire &amp; plumb", "&#x41;udit", "<![CDATA[Clean <up>]]>", ""];
  const tasks: string[] = [];
  let level = 1;
  for (let i = 1; i <= n; i++) {
    level = Math.max(1, Math.min(4, level + pick([-1, 0, 0, 1])));
    const f: string[] = [`<UID>${i}</UID>`, `<Name>${pick(names)}</Name>`, `<OutlineLevel>${r() < 0.05 ? 0 : level}</OutlineLevel>`];
    const hours = pick([0, 4, 8, 12, 16, 40, 7.5]);
    f.push(`<Duration>${pick([`PT${hours}H0M0S`, `P${Math.floor(hours / 8)}DT${hours % 8}H0M0S`, "PT0H30M0S", "bogus"])}</Duration>`);
    if (r() < 0.6) f.push(`<DurationFormat>${pick([7, 5, 39, 8, 36, 20])}</DurationFormat>`);
    if (r() < 0.2) f.push(`<Milestone>${pick([1, 0, "true"])}</Milestone>`);
    if (r() < 0.2) f.push(`<Summary>1</Summary>`);
    if (r() < 0.15) f.push(`<Manual>1</Manual><ManualStart>${day(3)}</ManualStart>`);
    if (r() < 0.5) f.push(`<ConstraintType>${pick([0, 1, 2, 3, 4, 5, 6, 7])}</ConstraintType>`);
    if (r() < 0.5) f.push(`<ConstraintDate>${day(Math.floor(r() * 20))}</ConstraintDate>`);
    if (r() < 0.2) f.push(`<Deadline>${day(20)}</Deadline>`);
    if (r() < 0.2) f.push(`<ActualStart>${day(2)}</ActualStart>`);
    if (r() < 0.3) f.push(`<PercentComplete>${pick([0, 25, 100])}</PercentComplete>`);
    if (r() < 0.1) f.push(`<Active>0</Active>`);
    if (r() < 0.05) f.push(`<IsNull>1</IsNull>`);
    if (r() < 0.05) f.push(`<Recurring>1</Recurring>`);
    if (r() < 0.2) f.push(`<CalendarUID>${pick([-1, 1, 2, 3, 9])}</CalendarUID>`);
    f.push(`<Start>${day(i)}</Start><Finish>${day(i + 2)}</Finish><EarlyStart>${day(i)}</EarlyStart><EarlyFinish>${day(i + 1)}</EarlyFinish><LateStart>${day(i + 1)}</LateStart><LateFinish>${day(i + 3)}</LateFinish>`);
    f.push(`<TotalSlack>${pick([0, 4800, 9600])}</TotalSlack><FreeSlack>${pick([0, 4800])}</FreeSlack><Critical>${pick([0, 1])}</Critical>`);
    const links = Math.floor(r() * 3);
    for (let k = 0; k < links; k++) {
      f.push(`<PredecessorLink><PredecessorUID>${pick([i - 1, i - 2, 99, 0])}</PredecessorUID><Type>${pick([0, 1, 2, 3, 9])}</Type><LinkLag>${pick([0, 4800, -2400, 600])}</LinkLag><LagFormat>${pick([7, 8, 19, 20, 5, 6])}</LagFormat></PredecessorLink>`);
    }
    tasks.push(`<Task>${f.join("")}</Task>`);
  }
  const head = [`<Title>Plan ${seed}</Title>`, r() < 0.8 ? `<StartDate>${day(1)}</StartDate>` : "", r() < 0.5 ? `<MinutesPerDay>${pick([480, 450, 600])}</MinutesPerDay>` : "", `<CalendarUID>${pick([1, 1, 3, 7])}</CalendarUID>`];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- seed ${seed} -->\n<Project xmlns="http://schemas.microsoft.com/project">${head.join("")}<Calendars>${cal1}${cal2}${cal3}</Calendars><Tasks><Task><UID>0</UID><Name>Root</Name><OutlineLevel>0</OutlineLevel></Task>${tasks.join("")}</Tasks></Project>`;
}

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

const GAN_VARIANTS = [
  GAN, GAN.replace('sun="1"', 'sun="0"').replace('sat="1"', 'sat="0"'), GAN.replace('mon="0"', 'mon="1"'), GAN.replace('type="2"', 'type="4"'),
  GAN.replace('hardness="Strong"', 'hardness="Rubber"'), GAN.replace('year="2026" ', ""), GAN.replace('<depend id="3"', '<depend id="9"'),
  GAN.replace('name="Paint"', 'name="Build"'), GAN.replace('meeting="true"', 'meeting="false"'), GAN.replace("<tasks", "<notasks").replace("</tasks>", "</notasks>"),
  GAN.replace("<project", "<plan").replace("</project>", "</plan>"), GAN.replace('duration="3"', 'duration="x"'),
  GAN.replace('<task id="3" name="Paint"', '<task id="3" name="Paint" thirdDate="2026-03-11" thirdDate-constraint="1"'),
];
const XER_VARIANTS = [
  XER, XER.replace("TT_FinMile", "TT_LOE"), XER.replace("CS_MSOA", "CS_MSO"), XER.replace("CS_MSOA", "CS_MEOB"), XER.replace("CS_MSOA", "CS_ALAP"),
  XER.replace("CS_MSOA", "CS_XYZ"), XER.replace("CS_MSOA\t2026-03-09 08:00", "CS_ALAP\t"), XER.replace("PR_SS", "PR_FF"), XER.replace("\t8\t(0", "\t10\t(0"),
  XER.replace(/%R\t12\t1\t10\t3\tFinish/, "$&\n%R\t13\t1\t10\t4\tEmpty"), XER.replace("(0||1()())", "(0||1()((0||0(s|09:00|f|17:00)())))"),
  XER.replace("(0||Exceptions()((0||0(d|46090)())))", "(0||Exceptions()((0||0(d|46090)())(0||1(d|46095)((0||0(s|08:00|f|12:00)())))))"),
  XER.replace("ERMHDR", "NOTHDR"), XER.replace(/\n/g, "\r\n"), XER.split("\n").filter((l) => !l.includes("TASKPRED") && !l.includes("pred_task_id") && !/^%R\t\d\t10\d\t10\d\tPR/.test(l)).join("\n"),
];
const PREDS: [string, string[]][] = [
  ["3", ["A", "B", "C"]], ["1FS+2d, 2SS", ["A", "B"]], ["A, B FF -1.5", []], ["2 SF +3w", ["A", "B"]], ["1+4h; 2-2ed", ["A", "B"]],
  ["9", ["A"]], ["", []], [" ,, ;", []], ["Pour FS+1wk", []], ["1 XY", ["A"]], ["1FS+2x", ["A"]], ["Dig, , Pour", []], ["1 fs + 2 D", ["A"]],
];

describe("the plan-file readers hold to their frozen answers", () => {
  it("the corpus, seeded MSPDI files, GanttProject and XER variations, sniffing and predecessor text", () => {
    const dir = join(__dirname, "../../crates/solenoid-schedule/tests/corpus");
    const files = readdirSync(dir).filter((f) => f.endsWith(".xml")).map((f) => readFileSync(join(dir, f), "utf8"));
    const msp = [...files, ...Array.from({ length: 300 }, (_, i) => mspdi(i + 1)), "<Project></Project>", "<NotProject/>", "<Project><Tasks><Task></Project>", "", "<Project><Title>A &lt;b&gt; &#9731;</Title></Project>"];
    const fresh: Case[] = [
      ...msp.map((text) => ({ kind: "mspdi" as const, text, want: read("mspdi", text) })),
      ...GAN_VARIANTS.map((text) => ({ kind: "gan" as const, text, want: read("gan", text) })),
      ...XER_VARIANTS.map((text) => ({ kind: "xer" as const, text, want: read("xer", text) })),
      ...[...msp.slice(0, 5), ...GAN_VARIANTS, ...XER_VARIANTS, "plain text", "  <?xml?><Project>"].map((text) => {
        const format = (JSON.parse(readPlanFile(text, "")) as { format?: string } | null)?.format ?? null;
        return { kind: "sniff" as const, text, want: format };
      }),
      ...PREDS.map(([text, names]) => ({ kind: "pred" as const, text, names, want: JSON.parse(parsePredecessors(text, names)) as unknown })),
    ];
    const cases = frozen<Case>("plan-readers", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => (c.kind === "sniff" ? sniffed(c.want) !== fresh[i].want : !isDeepStrictEqual(noNulls(c.want), noNulls(fresh[i].want)))).map((c) => `${c.kind} ${c.text.slice(0, 50)}`);
    expect(bad).toEqual([]);
  });
});
