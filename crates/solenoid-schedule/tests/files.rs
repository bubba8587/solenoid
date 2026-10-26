// [[C69]] ganttPackages, [[D68]] importUnsupportedIsNamed
//! The plan-file readers over the corpus in `corpus/`
//! and the GanttProject and XER samples: what they read, and that the engine reproduces the dates a file stores.

use solenoid_schedule::dates::{iso, serial};
use solenoid_schedule::{
    read_gan, read_mspdi, read_xer, schedule, sniff, write_mspdi, xsd_duration_to_hours, CalendarSpec, Dependency,
    LinkType, MspdiOptions, PlanFormat, PlanTask, ScheduleInput,
};
use std::collections::HashSet;
use std::path::PathBuf;

fn corpus() -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let mut files: Vec<(String, String)> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.to_string_lossy().ends_with(".mspdi.xml"))
        .map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), std::fs::read_to_string(&p).unwrap()))
        .collect();
    files.sort();
    assert!(!files.is_empty());
    files
}

fn file(name: &str) -> String {
    std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus").join(name)).unwrap()
}

fn dep(task: &str, ty: LinkType, lag: f64) -> Dependency {
    Dependency { task: task.into(), ty, lag, elapsed: None }
}

fn names(tasks: &[PlanTask]) -> Vec<&str> {
    tasks.iter().map(|t| t.name.as_str()).collect()
}

fn run(tasks: &[PlanTask], start: f64, calendar: CalendarSpec) -> solenoid_schedule::ScheduleOutput {
    schedule(&ScheduleInput { tasks: tasks.to_vec(), start, calendar, ..ScheduleInput::default() }).unwrap()
}

#[test]
fn xsd_durations() {
    assert_eq!(xsd_duration_to_hours(Some("PT8H0M0S")), Some(8.0));
    assert_eq!(xsd_duration_to_hours(Some("P1DT4H")), Some(28.0));
    assert_eq!(xsd_duration_to_hours(Some("PT0H30M0S")), Some(0.5));
    assert_eq!(xsd_duration_to_hours(Some("nope")), None);
}

#[test]
fn reads_the_authored_remodel() {
    let plan = read_mspdi(&file("authored-remodel.mspdi.xml")).unwrap();
    let f = &plan.file;
    assert_eq!(f.title, "Kitchen remodel");
    assert_eq!(iso(f.start.unwrap()), "2026-01-05");
    assert_eq!(plan.hours_per_day, 8.0);
    assert!(f.calendar.working_days);
    assert_eq!(f.calendar.weekend_code, Some(1.0));
    assert_eq!(f.calendar.holidays, Some(vec![Some(serial(2026, 1, 19))]));
    assert_eq!(f.calendar.intervals, Some(vec![(480.0, 720.0), (780.0, 1020.0)]));
    assert_eq!(
        names(&f.tasks),
        ["Demolition", "Rough-in", "Drywall", "Paint", "Cabinets", "Countertops", "Appliances", "Final inspection"]
    );
    assert_eq!(names(f.tasks[1].children.as_ref().unwrap()), ["Plumbing rough-in", "Electrical rough-in"]);
    assert_eq!(f.tasks[2].predecessors, [dep("Rough-in", LinkType::FS, 0.0)]);
    assert_eq!(f.tasks[6].predecessors, [dep("Cabinets", LinkType::SS, 1.0)]);
    assert_eq!(iso(f.tasks[6].start.unwrap()), "2026-01-26");
    assert_eq!(f.tasks[7].duration, Some(0.0));
    assert_eq!(iso(f.tasks[7].deadline.unwrap()), "2026-01-30");
    assert!(f.unsupported.is_empty());
    assert_eq!(plan.golden.iter().find(|g| g.name == "Paint").unwrap().total_slack, Some(2.0));
}

/// Every fixture's stored dates match the engine in both modes, except the divergences `divergences.json` names.
#[test]
fn the_engine_reproduces_every_stored_date() {
    let divergences: serde_json::Value = serde_json::from_str(&file("divergences.json")).unwrap();
    for minutes in [false, true] {
        for (name, text) in corpus() {
            let plan = read_mspdi(&text).unwrap();
            let f = &plan.file;
            let out = run(&f.tasks, f.start.unwrap(), CalendarSpec { minutes, ..f.calendar.clone() });
            for g in &plan.golden {
                let t = out.tasks.iter().find(|x| x.name == g.name).unwrap();
                let skip = |field: &str| divergences[&name][&g.name][field].is_string();
                let at =
                    |field: &str| format!("{name}: {}.{field} ({})", g.name, if minutes { "minutes" } else { "days" });
                if let Some(s) = g.start.filter(|_| !skip("start")) {
                    assert_eq!(iso(t.start), iso(s), "{}", at("start"));
                }
                if let Some(s) = g.finish.filter(|_| !skip("finish")) {
                    assert_eq!(iso(t.finish - if minutes { 1e-9 } else { 0.0 }), iso(s), "{}", at("finish"));
                }
                if let Some(s) = g.total_slack.filter(|_| !skip("totalSlack")) {
                    assert_eq!(t.float, s, "{}", at("totalSlack"));
                }
                if let Some(c) = g.critical.filter(|_| !skip("critical")) {
                    assert_eq!(t.critical, c, "{}", at("critical"));
                }
            }
        }
    }
}

/// No negative float, no broken link, every task linked, durations under 44 days, and the critical path reaches the
/// finish: the DCMA invariants a well-formed plan holds.
#[test]
fn dcma_invariants_over_the_corpus() {
    for (name, text) in corpus() {
        let plan = read_mspdi(&text).unwrap();
        let f = &plan.file;
        let o = run(&f.tasks, f.start.unwrap(), f.calendar.clone());
        let checks: Vec<&str> = o.diagnostics.iter().map(|d| d.check.as_str()).collect();
        for bad in ["Negative float", "Broken link", "Long task"] {
            assert!(!checks.contains(&bad), "{name}: {bad}");
        }
        let mut flat: Vec<&PlanTask> = Vec::new();
        fn walk<'a>(list: &'a [PlanTask], into: &mut Vec<&'a PlanTask>) {
            for x in list {
                into.push(x);
                walk(x.children.as_deref().unwrap_or(&[]), into);
            }
        }
        walk(&f.tasks, &mut flat);
        let preds: HashSet<String> =
            flat.iter().flat_map(|x| x.predecessors.iter().map(|d| d.task.to_lowercase())).collect();
        for d in &o.diagnostics {
            if d.check == "No successor" {
                assert!(!preds.contains(&d.task.to_lowercase()), "{name}: {} has a successor", d.task);
            }
            if d.check == "No predecessor" {
                assert!(flat.iter().find(|x| x.name == d.task).unwrap().predecessors.is_empty(), "{name}: {}", d.task);
            }
        }
        for x in &o.tasks {
            assert!(x.finish >= x.start - 1e-9);
        }
        assert!(o.tasks.iter().any(|x| x.critical && x.finish >= o.project_finish - 1e-9), "{name}");
    }
}

fn mspdi_file(tasks: &str) -> String {
    format!("<?xml version=\"1.0\"?><Project xmlns=\"http://schemas.microsoft.com/project\"><Tasks>{tasks}</Tasks></Project>")
}

fn mspdi_task(uid: u32, name: &str, dur: &str, fmt: u32, extra: &str) -> String {
    format!(
        "<Task><UID>{uid}</UID><Name>{name}</Name><OutlineLevel>1</OutlineLevel><Duration>{dur}</Duration><DurationFormat>{fmt}</DurationFormat><Start>2026-01-05T08:00:00</Start>{extra}</Task>"
    )
}

#[test]
fn an_elapsed_duration_counts_24_hour_days() {
    let plan = read_mspdi(&mspdi_file(&mspdi_task(1, "Cure", "PT48H0M0S", 8, ""))).unwrap();
    assert_eq!(plan.file.tasks[0].duration, Some(2.0));
    assert!(plan.file.tasks[0].elapsed);
}

/// An elapsed lag is an even format code; 20 and 52 are elapsed percent lags, 19 a plain percent.
#[test]
fn lag_formats() {
    let link = |fmt: u32, tenths: u32| {
        format!("<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>{tenths}</LinkLag><LagFormat>{fmt}</LagFormat></PredecessorLink>")
    };
    let plan = read_mspdi(&mspdi_file(
        &[
            mspdi_task(1, "A", "PT8H0M0S", 7, ""),
            mspdi_task(2, "B", "PT16H0M0S", 7, &link(8, 2 * 24 * 60 * 10)),
            mspdi_task(3, "C", "PT16H0M0S", 7, &link(19, 50)),
            mspdi_task(4, "D", "PT16H0M0S", 7, &link(39, 8 * 60 * 10)),
        ]
        .concat(),
    ))
    .unwrap();
    let t = &plan.file.tasks;
    assert_eq!(t[1].predecessors, [Dependency { elapsed: Some(true), ..dep("A", LinkType::FS, 2.0) }]);
    assert_eq!(t[2].predecessors, [dep("A", LinkType::FS, 1.0)]);
    assert_eq!(t[3].predecessors, [dep("A", LinkType::FS, 1.0)]);
}

#[test]
fn repeated_names_read_as_distinct_and_links_follow_the_uid() {
    let link = "<PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type></PredecessorLink>";
    let plan = read_mspdi(&mspdi_file(
        &[
            mspdi_task(1, "Review", "PT8H0M0S", 7, ""),
            mspdi_task(2, "Review", "PT8H0M0S", 7, ""),
            mspdi_task(3, "Ship", "PT8H0M0S", 7, link),
        ]
        .concat(),
    ))
    .unwrap();
    assert_eq!(names(&plan.file.tasks), ["Review", "Review (2)", "Ship"]);
    assert_eq!(plan.file.tasks[2].predecessors[0].task, "Review (2)");
    run(&plan.file.tasks, plan.file.start.unwrap(), plan.file.calendar.clone());
}

#[test]
fn no_start_date_starts_at_the_earliest_stored_start() {
    let plan = read_mspdi(&mspdi_file(&mspdi_task(1, "A", "PT8H0M0S", 7, ""))).unwrap();
    assert_eq!(iso(plan.file.start.unwrap()), "2026-01-05");
}

#[test]
fn entities_cdata_and_comments_read_as_text() {
    let plan = read_mspdi(&mspdi_file(
        "<!-- c --><Task><UID>1</UID><Name>Wire &amp; plumb &#x41;</Name></Task><Task><UID>2</UID><Name><![CDATA[Clean <up>]]></Name></Task>",
    ))
    .unwrap();
    assert_eq!(names(&plan.file.tasks), ["Wire & plumb A", "Clean <up>"]);
    assert!(read_mspdi("<Project><Tasks><Task></Project>").unwrap_err().message.contains("unexpected </Project>"));
    assert!(read_mspdi("<Plan/>").is_err());
}

const GAN: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
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
</project>"##;

fn xer() -> String {
    [
        "ERMHDR\t19.12\t2026-03-02\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD",
        "%T\tPROJECT", "%F\tproj_id\tproj_short_name\tclndr_id\tplan_start_date", "%R\t1\tSHED\t5\t2026-03-02 08:00",
        "%T\tCALENDAR", "%F\tclndr_id\tday_hr_cnt\tclndr_data",
        "%R\t5\t8\t(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||3()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||4()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||5()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||6()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))(0||7()())))(0||Exceptions()((0||0(d|46090)())))))",
        "%T\tPROJWBS", "%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\twbs_name", "%R\t10\t1\t\t1\tSHED", "%R\t11\t1\t10\t2\tBuild", "%R\t12\t1\t10\t3\tFinish",
        "%T\tTASK", "%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tphys_complete_pct\tcstr_type\tcstr_date\tact_start_date",
        "%R\t100\t1\t11\tA1000\tFoundation\tTT_Task\t16\t100\t\t\t2026-03-02 08:00",
        "%R\t101\t1\t11\tA1010\tFrame\tTT_Task\t24\t0\t\t\t",
        "%R\t102\t1\t12\tA1020\tPaint\tTT_Task\t16\t0\tCS_MSOA\t2026-03-09 08:00\t",
        "%R\t103\t1\t12\tA1030\tDone\tTT_FinMile\t0\t0\t\t\t",
        "%T\tTASKPRED", "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt", "%R\t1\t101\t100\tPR_FS\t0", "%R\t2\t102\t101\tPR_SS\t8", "%R\t3\t103\t102\tPR_FS\t0",
    ]
    .join("\n")
}

#[test]
fn reads_a_gan_file() {
    assert_eq!(sniff(GAN), Some(PlanFormat::Gan));
    let p = read_gan(GAN).unwrap();
    assert_eq!(p.title, "Shed");
    assert_eq!(names(&p.tasks), ["Build", "Paint", "Done"]);
    let build = p.tasks[0].children.as_ref().unwrap();
    assert_eq!(names(build), ["Foundation", "Frame & roof"]);
    assert_eq!(build[1].predecessors, [dep("Foundation", LinkType::FS, 0.0)]);
    assert_eq!(p.tasks[1].predecessors, [dep("Frame & roof", LinkType::SS, 1.0)]);
    assert_eq!(p.tasks[2].duration, Some(0.0));
    assert!(p.calendar.working_days);
    assert_eq!(p.calendar.weekend_code, Some(1.0));
    assert_eq!(p.calendar.holidays, Some(vec![Some(serial(2026, 3, 9))]));
    let o = run(&p.tasks, p.start.unwrap(), p.calendar.clone());
    let at = |n: &str| iso(o.tasks.iter().find(|t| t.name == n).unwrap().start);
    assert_eq!(at("Frame & roof"), "2026-03-04");
    assert_eq!(at("Paint"), "2026-03-05");
}

#[test]
fn reads_an_xer_file() {
    let x = xer();
    assert_eq!(sniff(&x), Some(PlanFormat::Xer));
    let p = read_xer(&x);
    assert_eq!(p.title, "SHED");
    assert_eq!(iso(p.start.unwrap()), "2026-03-02");
    assert_eq!(names(&p.tasks), ["SHED"]);
    let shed = p.tasks[0].children.as_ref().unwrap();
    assert_eq!(names(shed), ["Build", "Finish"]);
    let build = shed[0].children.as_ref().unwrap();
    let finish = shed[1].children.as_ref().unwrap();
    assert_eq!(
        build.iter().map(|t| (t.name.as_str(), t.duration)).collect::<Vec<_>>(),
        [("Foundation", Some(2.0)), ("Frame", Some(3.0))]
    );
    assert_eq!(finish[0].predecessors, [dep("Frame", LinkType::SS, 1.0)]);
    assert_eq!(iso(finish[0].start.unwrap()), "2026-03-09");
    assert_eq!(iso(build[0].actual_start.unwrap()), "2026-03-02");
    assert_eq!(finish[1].duration, Some(0.0));
    assert_eq!(p.calendar.holidays, Some(vec![Some(46090.0)]));
    assert_eq!(p.calendar.intervals, None);
    let o = run(&p.tasks, p.start.unwrap(), p.calendar.clone());
    assert_eq!(iso(o.tasks.iter().find(|t| t.name == "Paint").unwrap().start), "2026-03-10");
}

#[test]
fn an_xer_wbs_with_no_tasks_is_dropped() {
    let x = xer().replace(
        "%R\t12\t1\t10\t3\tFinish",
        "%R\t12\t1\t10\t3\tFinish\n%R\t13\t1\t10\t4\tEmpty\n%R\t14\t1\t13\t5\tEmptier",
    );
    assert!(x.contains("Emptier"));
    assert_eq!(names(read_xer(&x).tasks[0].children.as_ref().unwrap()), ["Build", "Finish"]);
}

/// Written MSPDI reads back to the same schedule in both modes, and its stored dates are the schedule's.
#[test]
fn mspdi_round_trips() {
    let tasks = read_gan(GAN).unwrap().tasks;
    let holidays = vec![Some(serial(2026, 3, 9))];
    for minutes in [false, true] {
        let cal =
            CalendarSpec { working_days: true, holidays: Some(holidays.clone()), minutes, ..CalendarSpec::default() };
        let o = run(&tasks, serial(2026, 3, 2), cal);
        let xml = write_mspdi(
            &o,
            &MspdiOptions { title: Some("Shed"), hours_per_day: None, minutes, holidays: Some(&holidays) },
        );
        let back = read_mspdi(&xml).unwrap();
        assert_eq!(back.file.title, "Shed");
        assert_eq!(back.file.calendar.holidays, Some(holidays.clone()));
        let again =
            run(&back.file.tasks, back.file.start.unwrap(), CalendarSpec { minutes, ..back.file.calendar.clone() });
        for t in &o.tasks {
            let b = again.tasks.iter().find(|x| x.name == t.name).unwrap();
            assert_eq!(
                (iso(b.start), iso(b.finish), b.float, b.critical),
                (iso(t.start), iso(t.finish), t.float, t.critical),
                "{}",
                t.name
            );
        }
        for g in &back.golden {
            assert_eq!(iso(g.start.unwrap()), iso(o.tasks.iter().find(|x| x.name == g.name).unwrap().start));
        }
    }
}
