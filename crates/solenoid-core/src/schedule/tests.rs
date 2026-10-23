//! [[C70]] oneScheduleRule. The engine's own tests, from `packages/schedule-engine/src/{engine,minutes,rules,regressions}.test.ts`.

use super::calendar::{day_of_week, intervals_for_hours, Calendar, CalendarSpec};
use super::*;
use crate::date_serial::{days_from_civil, format_date_serial};

fn s(y: i64, m: u32, d: u32) -> f64 {
    days_from_civil(y, m, d) as f64 + 25569.0
}

fn mon() -> f64 {
    s(2026, 1, 5)
}

fn iso(x: f64) -> String {
    format_date_serial(x, "YYYY-MM-DD")
}

fn stamp(x: f64) -> String {
    format_date_serial(x, "YYYY-MM-DD HH:mm")
}

enum P {
    N(&'static str),
    L(&'static str, LinkType, f64),
}

fn t(name: &str, duration: f64, preds: &[P]) -> PlanTask {
    PlanTask {
        name: name.into(),
        duration: Some(duration),
        predecessors: preds
            .iter()
            .map(|p| match p {
                P::N(n) => Dependency::fs(n),
                P::L(n, ty, lag) => Dependency { task: n.to_string(), ty: *ty, lag: *lag, elapsed: None },
            })
            .collect(),
        ..PlanTask::default()
    }
}

fn after(name: &str, duration: f64, preds: &[&'static str]) -> PlanTask {
    t(name, duration, &preds.iter().map(|p| P::N(p)).collect::<Vec<_>>())
}

fn parent(name: &str, preds: &[&'static str], children: Vec<PlanTask>) -> PlanTask {
    PlanTask { children: Some(children), ..after(name, 0.0, preds) }
}

fn working() -> CalendarSpec {
    CalendarSpec { working_days: true, ..CalendarSpec::default() }
}

fn minutes() -> CalendarSpec {
    CalendarSpec { working_days: true, minutes: true, ..CalendarSpec::default() }
}

fn input(tasks: Vec<PlanTask>) -> ScheduleInput {
    ScheduleInput { tasks, start: mon(), calendar: working(), ..ScheduleInput::default() }
}

fn run(tasks: Vec<PlanTask>) -> ScheduleOutput {
    schedule(&input(tasks)).unwrap()
}

fn run_with(i: ScheduleInput) -> ScheduleOutput {
    schedule(&i).unwrap()
}

fn by<'a>(o: &'a ScheduleOutput, name: &str) -> &'a ScheduledTask {
    o.tasks.iter().find(|x| x.name == name).unwrap()
}

fn isos(o: &ScheduleOutput, f: impl Fn(&ScheduledTask) -> f64) -> Vec<String> {
    o.tasks.iter().map(|x| iso(f(x))).collect()
}

fn has(o: &ScheduleOutput, check: &str, task: &str) -> bool {
    o.diagnostics.iter().any(|d| d.check == check && d.task == task)
}

fn holidays(days: &[f64]) -> Option<Vec<Option<f64>>> {
    Some(days.iter().map(|d| Some(*d)).collect())
}

#[test]
fn calendar_skips_weekends_and_holidays_in_index_space() {
    assert_eq!(day_of_week(mon()), 1.0);
    assert_eq!(day_of_week(s(1970, 1, 1)), 4.0);
    let c = Calendar::new(mon(), &CalendarSpec { holidays: holidays(&[s(2026, 1, 7)]), ..working() });
    let ds: Vec<String> = (0..6).map(|k| iso(c.date(k as f64).unwrap())).collect();
    assert_eq!(ds, ["2026-01-05", "2026-01-06", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13"]);
    assert_eq!(c.index_ceil(s(2026, 1, 7)).unwrap(), 2.0);
    assert_eq!(c.index_floor(s(2026, 1, 7)).unwrap(), 1.0);
    assert_eq!(c.index_ceil(s(2026, 1, 10)).unwrap(), 4.0);
    assert_eq!(iso(c.date(-1.0).unwrap()), "2026-01-02");
    assert_eq!(iso(c.date(-2.0).unwrap()), "2026-01-01");
    assert_eq!(c.index_ceil(s(2026, 1, 3)).unwrap(), 0.0);
    assert_eq!(c.index_floor(s(2026, 1, 3)).unwrap(), -1.0);
    assert_eq!(c.count_between(mon(), s(2026, 1, 9)).unwrap(), 4.0);
    assert_eq!(
        c.non_working_spans(mon(), s(2026, 1, 13)),
        vec![(s(2026, 1, 7), s(2026, 1, 7)), (s(2026, 1, 10), s(2026, 1, 11))]
    );
}

#[test]
fn calendar_takes_the_weekend_code_and_calendar_mode_counts_every_day() {
    let c = Calendar::new(mon(), &CalendarSpec { weekend_code: Some(7.0), ..working() });
    assert_eq!(iso(c.date(4.0).unwrap()), "2026-01-11");
    let all = Calendar::new(mon(), &CalendarSpec::default());
    assert_eq!(iso(all.date(6.0).unwrap()), "2026-01-11");
    assert!(all.non_working_spans(mon(), mon() + 30.0).is_empty());
    Calendar::new(mon(), &CalendarSpec { weekend_code: Some(99.0), ..working() });
}

#[test]
fn a_chain_starts_the_next_working_day_with_float_and_critical() {
    let o = run(vec![after("A", 2.0, &[]), after("B", 3.0, &["A"])]);
    assert_eq!(isos(&o, |x| x.start), ["2026-01-05", "2026-01-07"]);
    assert_eq!(isos(&o, |x| x.finish), ["2026-01-06", "2026-01-09"]);
    assert!(o.tasks.iter().all(|x| x.float == 0.0 && x.critical));
    assert_eq!(iso(o.project_finish), "2026-01-09");
    assert_eq!(by(&o, "B").driving.as_deref(), Some("A"));
    let l = &o.links[0];
    assert_eq!(
        (l.from.as_str(), l.to.as_str(), l.ty, l.lag, l.driving, l.critical, l.violated),
        ("A", "B", LinkType::FS, 0.0, true, true, false)
    );
    assert_eq!(o.links.len(), 1);
}

#[test]
fn the_kitchen_diamond_with_a_holiday() {
    let o = run_with(ScheduleInput {
        calendar: CalendarSpec { holidays: holidays(&[s(2026, 1, 19)]), ..working() },
        ..input(vec![
            after("Demolition", 2.0, &[]),
            after("Plumbing rough-in", 3.0, &["Demolition"]),
            after("Electrical rough-in", 2.0, &["Demolition"]),
            after("Drywall", 2.0, &["Plumbing rough-in", "Electrical rough-in"]),
            after("Paint", 2.0, &["Drywall"]),
            after("Cabinets", 4.0, &["Drywall"]),
            after("Countertops", 5.0, &["Cabinets", "Paint"]),
            after("Final inspection", 0.0, &["Countertops"]),
        ])
    });
    assert_eq!(
        isos(&o, |x| x.start),
        [
            "2026-01-05",
            "2026-01-07",
            "2026-01-07",
            "2026-01-12",
            "2026-01-14",
            "2026-01-14",
            "2026-01-21",
            "2026-01-27"
        ]
    );
    assert_eq!(
        isos(&o, |x| x.finish),
        [
            "2026-01-06",
            "2026-01-09",
            "2026-01-08",
            "2026-01-13",
            "2026-01-15",
            "2026-01-20",
            "2026-01-27",
            "2026-01-27"
        ]
    );
    assert_eq!(o.tasks.iter().map(|x| x.float).collect::<Vec<_>>(), [0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 0.0]);
    assert_eq!(
        o.tasks.iter().map(|x| x.critical).collect::<Vec<_>>(),
        [true, true, false, true, false, true, true, true]
    );
    assert_eq!(by(&o, "Electrical rough-in").free_float, 1.0);
    assert_eq!(by(&o, "Drywall").driving.as_deref(), Some("Plumbing rough-in"));
    assert_eq!(o.holidays, [s(2026, 1, 19)]);
    assert!(o.non_working.len() > 2);
    assert!(by(&o, "Final inspection").milestone);
}

#[test]
fn link_types_ss_ff_and_sf_with_lags_and_a_lead() {
    let o = run(vec![
        after("A", 4.0, &[]),
        t("B", 2.0, &[P::L("A", LinkType::SS, 1.0)]),
        t("C", 2.0, &[P::L("A", LinkType::FF, 0.0)]),
        t("D", 1.0, &[P::L("A", LinkType::SF, 2.0)]),
        t("E", 2.0, &[P::L("A", LinkType::FS, -2.0)]),
    ]);
    assert_eq!(iso(by(&o, "B").start), "2026-01-06");
    assert_eq!(iso(by(&o, "C").finish), "2026-01-08");
    assert_eq!(iso(by(&o, "C").start), "2026-01-07");
    assert_eq!(iso(by(&o, "D").finish), "2026-01-06");
    assert_eq!(iso(by(&o, "E").start), "2026-01-07");
    assert!(has(&o, "Lead", "E"));
    assert!(has(&o, "Link type", "B"));
}

#[test]
fn a_long_lead_puts_the_successor_before_the_project_start() {
    let o = run(vec![after("A", 1.0, &[]), t("B", 1.0, &[P::L("A", LinkType::FS, -3.0)])]);
    assert_eq!(iso(by(&o, "B").start), "2026-01-01");
    assert_eq!(iso(o.project_start), "2026-01-01");
}

#[test]
fn start_is_a_floor_finish_a_ceiling_deadline_a_flag() {
    let o = run(vec![
        after("A", 2.0, &[]),
        PlanTask { start: Some(s(2026, 1, 12)), ..after("B", 2.0, &["A"]) },
        PlanTask { start: Some(s(2026, 1, 1)), ..after("C", 2.0, &["A"]) },
    ]);
    assert_eq!(iso(by(&o, "B").start), "2026-01-12");
    assert!(by(&o, "B").floored);
    assert_eq!(by(&o, "B").driving, None);
    assert_eq!(iso(by(&o, "C").start), "2026-01-07");
    assert!(!by(&o, "C").floored);
    assert!(has(&o, "Held by a typed start", "B"));

    let c = run(vec![PlanTask { finish: Some(s(2026, 1, 6)), ..after("A", 3.0, &[]) }]);
    assert_eq!(iso(by(&c, "A").finish), "2026-01-07");
    assert_eq!(by(&c, "A").float, -1.0);
    assert!(by(&c, "A").critical);
    assert!(c.diagnostics.iter().any(|d| d.check == "Negative float"));

    let d = run(vec![
        PlanTask { deadline: Some(s(2026, 1, 6)), ..after("A", 3.0, &[]) },
        PlanTask { deadline: Some(s(2026, 1, 30)), ..after("B", 1.0, &["A"]) },
    ]);
    assert!(by(&d, "A").late);
    assert_eq!(by(&d, "A").float, -1.0);
    assert!(!by(&d, "B").late);
    assert_eq!(by(&d, "B").float, 0.0);
    assert!(has(&d, "Past deadline", "A"));
}

#[test]
fn manual_pins_and_still_drives_and_a_broken_link_is_flagged() {
    let o = run(vec![
        after("A", 5.0, &[]),
        PlanTask { manual: true, start: Some(s(2026, 1, 6)), ..after("B", 2.0, &["A"]) },
        after("C", 1.0, &["B"]),
    ]);
    assert_eq!(iso(by(&o, "B").start), "2026-01-06");
    assert_eq!(iso(by(&o, "B").finish), "2026-01-07");
    assert_eq!(iso(by(&o, "C").start), "2026-01-08");
    assert!(o.links.iter().find(|l| l.to == "B").unwrap().violated);
    assert!(has(&o, "Broken link", "B"));
    assert!(has(&o, "Manual", "B"));
    let p =
        run(vec![PlanTask { manual: true, start: Some(mon()), finish: Some(s(2026, 1, 9)), ..after("A", 1.0, &[]) }]);
    assert_eq!(by(&p, "A").duration, 1.0);
    assert_eq!(iso(by(&p, "A").finish), "2026-01-09");
}

#[test]
fn nesting_rolls_up_and_links_to_a_parent_bound_every_leaf() {
    let o = run(vec![
        parent("Phase 1", &[], vec![after("A", 2.0, &[]), after("B", 3.0, &["A"])]),
        after("C", 1.0, &["Phase 1"]),
        parent("Phase 2", &["C"], vec![after("D", 1.0, &[]), after("E", 2.0, &[])]),
    ]);
    assert_eq!(
        o.tasks.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(),
        ["Phase 1", "A", "B", "C", "Phase 2", "D", "E"]
    );
    assert_eq!(o.tasks.iter().map(|x| x.level).collect::<Vec<_>>(), [0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0]);
    assert_eq!(o.tasks.iter().map(|x| x.wbs.as_str()).collect::<Vec<_>>(), ["1", "1.1", "1.2", "2", "3", "3.1", "3.2"]);
    let p1 = by(&o, "Phase 1");
    assert!(p1.summary);
    assert_eq!(iso(p1.start), "2026-01-05");
    assert_eq!(iso(p1.finish), "2026-01-09");
    assert_eq!(p1.duration, 5.0);
    assert_eq!(iso(by(&o, "C").start), "2026-01-12");
    assert_eq!(iso(by(&o, "D").start), "2026-01-13");
    assert_eq!(iso(by(&o, "E").start), "2026-01-13");
    assert_eq!(by(&o, "D").float, 1.0);
    assert!(by(&o, "Phase 2").critical);
    assert_eq!(by(&o, "Phase 2").float, 0.0);
    assert_eq!(
        o.links.iter().map(|l| format!("{}→{}", l.from, l.to)).collect::<Vec<_>>(),
        ["A→B", "Phase 1→C", "C→Phase 2"]
    );
    assert!(o.links[2].driving);
}

#[test]
fn a_finished_task_is_never_critical() {
    let o = run_with(ScheduleInput {
        status_date: Some(s(2026, 1, 8)),
        ..input(vec![
            PlanTask { complete: Some(50.0), ..after("A", 4.0, &[]) },
            after("B", 2.0, &["A"]),
            PlanTask { complete: Some(100.0), ..after("C", 1.0, &[]) },
        ])
    });
    assert!(!by(&o, "C").critical);
    assert_eq!(by(&o, "C").free_float, 0.0);
    assert!(!o.diagnostics.iter().any(|d| d.check == "Should have finished"));
}

#[test]
fn a_summary_ss_successor_bounds_the_summary_float() {
    let o = run(vec![
        parent("Phase", &[], vec![after("A", 2.0, &[]), after("B", 3.0, &["A"])]),
        PlanTask { finish: Some(s(2026, 1, 7)), ..t("T", 3.0, &[P::L("Phase", LinkType::SS, 0.0)]) },
        after("Tail", 1.0, &["Phase"]),
    ]);
    for name in ["T", "B", "A", "Phase"] {
        assert_eq!(by(&o, name).float, 0.0, "{name}");
    }
    let bad = run(vec![
        parent("Phase", &[], vec![after("A", 2.0, &[]), after("B", 3.0, &["A"])]),
        PlanTask { finish: Some(s(2026, 1, 6)), ..t("T", 3.0, &[P::L("Phase", LinkType::SS, 0.0)]) },
        after("Tail", 5.0, &["Phase"]),
    ]);
    assert_eq!(by(&bad, "Phase").float, -1.0);
    assert_eq!(by(&bad, "A").float, 0.0);
    assert!(by(&bad, "Phase").critical);
}

#[test]
fn multiple_critical_paths() {
    let tasks = || vec![after("A", 5.0, &[]), after("B", 1.0, &[]), after("C", 1.0, &["B"])];
    let one = run(tasks());
    assert_eq!(one.tasks.iter().map(|x| x.critical).collect::<Vec<_>>(), [true, false, false]);
    assert_eq!(by(&one, "C").float, 3.0);
    let many = run_with(ScheduleInput { multiple_critical_paths: true, ..input(tasks()) });
    assert!(many.tasks.iter().all(|x| x.critical));
    assert_eq!(by(&many, "C").float, 0.0);
    assert_eq!(many.project_finish, one.project_finish);
}

#[test]
fn structural_failures_name_a_member() {
    let err = |tasks: Vec<PlanTask>| schedule(&input(tasks)).unwrap_err().message;
    assert!(err(vec![after("A", 1.0, &["B"]), after("B", 1.0, &["A"])]).contains("loop"));
    assert!(err(vec![after("A", 1.0, &["Z"])]).contains("\"Z\""));
    assert!(err(vec![after("A", 1.0, &[]), after(" a ", 1.0, &[])]).contains("twice"));
    assert!(err(vec![after("A", -1.0, &[])]).contains("\"A\""));
    assert!(err(vec![parent("P", &[], vec![after("A", 1.0, &["P"])])]).contains("loop"));
}

#[test]
fn an_empty_plan_a_weekend_start_and_a_milestone() {
    assert!(run(vec![]).tasks.is_empty());
    let o = run_with(ScheduleInput {
        start: s(2026, 1, 10),
        ..input(vec![after("Kickoff", 0.0, &[]), after("A", 1.0, &["Kickoff"])])
    });
    assert_eq!(isos(&o, |x| x.start), ["2026-01-12", "2026-01-12"]);
    assert_eq!(isos(&o, |x| x.finish), ["2026-01-12", "2026-01-12"]);
}

#[test]
fn properties_on_a_random_dag() {
    let mut seed: f64 = 7.0;
    let mut rnd = || {
        seed = (seed * 48271.0) % 2147483647.0;
        seed / 2147483647.0
    };
    let types = [LinkType::FS, LinkType::SS, LinkType::FF, LinkType::SF];
    for _ in 0..40 {
        let n = 3 + (rnd() * 12.0).floor() as usize;
        let mut tasks = Vec::new();
        for i in 0..n {
            let mut preds = Vec::new();
            for j in 0..i {
                if rnd() < 0.3 {
                    let ty = types[(rnd() * 4.0).floor() as usize];
                    preds.push(Dependency {
                        task: format!("T{j}"),
                        ty,
                        lag: (rnd() * 5.0).floor() - 1.0,
                        elapsed: None,
                    });
                }
            }
            tasks.push(PlanTask {
                name: format!("T{i}"),
                duration: Some((rnd() * 6.0).floor()),
                predecessors: preds,
                ..PlanTask::default()
            });
        }
        let working_days = rnd() < 0.5;
        let o = run_with(ScheduleInput {
            calendar: CalendarSpec { working_days, holidays: holidays(&[s(2026, 1, 19)]), ..CalendarSpec::default() },
            ..input(tasks)
        });
        for l in &o.links {
            let (a, b) = (by(&o, &l.from), by(&o, &l.to));
            assert!(!l.violated);
            if l.ty == LinkType::FS && a.duration > 0.0 && b.duration > 0.0 && l.lag >= 0.0 {
                assert!(b.start > a.finish);
            }
        }
        for x in &o.tasks {
            assert!(x.float >= 0.0);
            assert!(x.free_float <= x.float);
        }
        assert!(o.tasks.iter().any(|x| x.critical));
    }
}

#[test]
fn predecessor_text_writes_types_lags_and_elapsed() {
    let deps = [
        Dependency::fs("A"),
        Dependency { task: "B".into(), ty: LinkType::SS, lag: 2.0, elapsed: None },
        Dependency { task: "C".into(), ty: LinkType::FS, lag: -1.0, elapsed: None },
    ];
    assert_eq!(predecessor_text(&deps), "A, B SS+2, C FS-1");
    assert_eq!(
        predecessor_text(&[Dependency { task: "A".into(), ty: LinkType::FS, lag: 2.0, elapsed: Some(true) }]),
        "A FS+2ed"
    );
}

#[test]
fn mermaid_excludes_sections_tags_and_exclusive_ends() {
    let o = run_with(ScheduleInput {
        calendar: CalendarSpec { holidays: holidays(&[s(2026, 1, 6)]), ..working() },
        ..input(vec![
            PlanTask { group: Some("Prep".into()), ..after("A", 2.0, &[]) },
            PlanTask { group: Some("Prep".into()), complete: Some(100.0), ..after("B", 1.0, &["A"]) },
            PlanTask { group: Some("Wrap".into()), ..after("Done", 0.0, &["B"]) },
        ])
    });
    assert_eq!(
        mermaid_gantt(&o, iso).split('\n').collect::<Vec<_>>(),
        [
            "gantt",
            "    dateFormat YYYY-MM-DD",
            "    axisFormat %d %b",
            "    excludes weekends, 2026-01-06",
            "    section Prep",
            "    A :crit, t0, 2026-01-05, 2026-01-08",
            "    B :done, t1, 2026-01-08, 2026-01-09",
            "    section Wrap",
            "    Done :milestone, crit, t2, 2026-01-08, 0d",
        ]
    );
}

#[test]
fn a_milestone_with_a_typed_start_inside_a_phase_sits_on_it() {
    let wed = s(2026, 1, 14);
    let out = run(vec![parent(
        "Phase",
        &[],
        vec![after("A", 3.0, &[]), PlanTask { start: Some(wed), ..after("M", 0.0, &[]) }],
    )]);
    assert_eq!(iso(by(&out, "M").start), "2026-01-14");
    assert_eq!(iso(by(&out, "M").finish), "2026-01-14");
}

#[test]
fn a_done_part_that_rounds_to_nothing_moves_whole() {
    let out = run_with(ScheduleInput {
        status_date: Some(mon() + 7.0),
        split_in_progress: Some(true),
        ..input(vec![PlanTask { complete: Some(10.0), ..after("A", 3.0, &[]) }])
    });
    let a = by(&out, "A");
    assert!(a.segments.is_none());
    assert!(a.start > mon() + 7.0);
    assert!(a.finish >= a.start);
}

#[test]
fn a_zero_float_milestone_has_its_date_as_every_date() {
    let out = run(vec![after("A", 2.0, &[]), after("M", 0.0, &["A"])]);
    let m = by(&out, "M");
    assert_eq!(m.float, 0.0);
    assert_eq!([m.early_start, m.early_finish, m.late_start, m.late_finish], [m.start, m.finish, m.start, m.finish]);
}

// ─── Minutes mode (minutes.test.ts) ─────────────────────────────────────────────────────────────────────────────────

#[test]
fn minutes_map_through_the_working_day_and_back() {
    let c = Calendar::new(mon(), &minutes());
    assert_eq!(c.units_per_day, 480.0);
    assert_eq!(stamp(c.date(0.0).unwrap()), "2026-01-05 08:00");
    assert_eq!(stamp(c.date(239.0).unwrap()), "2026-01-05 11:59");
    assert_eq!(stamp(c.date(240.0).unwrap()), "2026-01-05 13:00");
    assert_eq!(stamp(c.date_end(479.0).unwrap()), "2026-01-05 17:00");
    assert_eq!(stamp(c.date(480.0).unwrap()), "2026-01-06 08:00");
    assert_eq!(c.index_ceil(mon()).unwrap(), 0.0);
    assert_eq!(c.index_ceil(mon() + 12.5 / 24.0).unwrap(), 240.0);
    assert_eq!(c.index_ceil(mon() + 17.0 / 24.0).unwrap(), 480.0);
    assert_eq!(c.index_floor(mon()).unwrap(), 479.0);
    assert_eq!(c.index_floor(mon() + 17.0 / 24.0).unwrap(), 479.0);
    assert_eq!(c.index_floor(mon() + 12.5 / 24.0).unwrap(), 239.0);
    assert_eq!(c.index_ceil(s(2026, 1, 10)).unwrap(), 5.0 * 480.0);
    assert_eq!(intervals_for_hours(8.0), [(480.0, 720.0), (780.0, 1020.0)]);
    assert_eq!(intervals_for_hours(6.0), [(480.0, 720.0), (780.0, 900.0)]);
    assert_eq!(intervals_for_hours(10.0), [(480.0, 1080.0)]);
    assert_eq!(intervals_for_hours(20.0), [(240.0, 1440.0)]);
    assert_eq!(intervals_for_hours(24.0), [(0.0, 1440.0)]);
    assert_eq!(
        Calendar::new(mon(), &CalendarSpec { intervals: Some(vec![(540.0, 780.0)]), ..minutes() }).units_per_day,
        240.0
    );
}

fn run_minutes(tasks: Vec<PlanTask>) -> ScheduleOutput {
    run_with(ScheduleInput { calendar: minutes(), ..input(tasks) })
}

#[test]
fn minutes_an_fs_successor_starts_the_same_afternoon() {
    let o = run_minutes(vec![after("A", 0.5, &[]), after("B", 1.0, &["A"]), after("C", 0.25, &["B"])]);
    assert_eq!(stamp(by(&o, "A").start), "2026-01-05 08:00");
    assert_eq!(stamp(by(&o, "A").finish), "2026-01-05 12:00");
    assert_eq!(stamp(by(&o, "B").start), "2026-01-05 13:00");
    assert_eq!(stamp(by(&o, "B").finish), "2026-01-06 12:00");
    assert_eq!(stamp(by(&o, "C").start), "2026-01-06 13:00");
    assert_eq!(stamp(by(&o, "C").finish), "2026-01-06 15:00");
    assert!(o.tasks.iter().all(|x| x.float == 0.0));
}

#[test]
fn minutes_whole_day_tasks_agree_with_days_mode() {
    let tasks =
        || vec![after("A", 2.0, &[]), after("B", 3.0, &["A"]), after("C", 1.0, &["A"]), after("M", 0.0, &["B", "C"])];
    let m = run_minutes(tasks());
    let d = run(tasks());
    for x in &d.tasks {
        let y = by(&m, &x.name);
        assert_eq!(y.start.floor(), x.start);
        assert_eq!((y.finish - 1e-9).floor(), x.finish);
        assert_eq!(y.float, x.float);
        assert_eq!(y.critical, x.critical);
    }
    assert_eq!(stamp(by(&m, "M").start), "2026-01-09 17:00");
    assert_eq!(by(&m, "C").float, 2.0);
}

#[test]
fn minutes_a_half_day_lag_a_clock_deadline_and_the_status_date() {
    let o = run_minutes(vec![
        after("A", 1.0, &[]),
        PlanTask { deadline: Some(mon() + 1.0 + 15.0 / 24.0), ..t("B", 1.0, &[P::L("A", LinkType::FS, 0.5)]) },
    ]);
    assert_eq!(stamp(by(&o, "B").start), "2026-01-06 13:00");
    assert_eq!(stamp(by(&o, "B").finish), "2026-01-07 12:00");
    assert!(by(&o, "B").late);
    assert_eq!(by(&o, "B").float, -0.75);
    let st = run_with(ScheduleInput {
        calendar: minutes(),
        status_date: Some(s(2026, 1, 6)),
        ..input(vec![PlanTask { complete: Some(50.0), ..after("A", 2.0, &[]) }])
    });
    assert_eq!(stamp(by(&st, "A").finish), "2026-01-07 17:00");
}

// ─── Rules (rules.test.ts) ──────────────────────────────────────────────────────────────────────────────────────────

fn own(cal: TaskCalendar, task: PlanTask) -> PlanTask {
    PlanTask { calendar: Some(cal), ..task }
}

#[test]
fn a_task_on_its_own_week_and_links_across_calendars_by_instant() {
    let o = run(vec![
        after("A", 4.0, &[]),
        own(TaskCalendar { weekend_code: Some(7.0), ..TaskCalendar::default() }, after("B", 2.0, &["A"])),
    ]);
    assert_eq!(iso(by(&o, "A").finish), "2026-01-08");
    assert_eq!(iso(by(&o, "B").start), "2026-01-11");
    assert_eq!(iso(by(&o, "B").finish), "2026-01-12");
    assert_eq!(o.tasks.iter().map(|x| x.float).collect::<Vec<_>>(), [1.0, 0.0]);
}

#[test]
fn a_task_holiday_is_its_own() {
    let o = run(vec![
        own(TaskCalendar { holidays: holidays(&[s(2026, 1, 6)]), ..TaskCalendar::default() }, after("A", 3.0, &[])),
        after("B", 3.0, &[]),
    ]);
    assert_eq!(iso(by(&o, "A").finish), "2026-01-08");
    assert_eq!(iso(by(&o, "B").finish), "2026-01-07");
}

#[test]
fn elapsed_durations_and_lags_count_every_day() {
    let o = run_with(ScheduleInput {
        start: s(2026, 1, 9),
        ..input(vec![
            PlanTask { elapsed: true, ..after("Cure", 3.0, &[]) },
            after("A", 1.0, &["Cure"]),
            PlanTask {
                predecessors: vec![Dependency { task: "A".into(), ty: LinkType::FS, lag: 2.0, elapsed: Some(true) }],
                ..after("B", 1.0, &[])
            },
        ])
    });
    assert_eq!(iso(by(&o, "Cure").start), "2026-01-09");
    assert_eq!(iso(by(&o, "Cure").finish), "2026-01-11");
    assert_eq!(iso(by(&o, "A").start), "2026-01-12");
    assert_eq!(iso(by(&o, "B").start), "2026-01-15");
}

#[test]
fn per_task_hours_in_minutes_mode() {
    let o = run_minutes(vec![
        own(
            TaskCalendar { intervals: Some(vec![(480.0, 720.0)]), ..TaskCalendar::default() },
            after("Short", 1.0, &[]),
        ),
        after("Next", 0.5, &["Short"]),
    ]);
    assert_eq!(stamp(by(&o, "Short").finish), "2026-01-05 12:00");
    assert_eq!(stamp(by(&o, "Next").start), "2026-01-05 13:00");
    assert_eq!(stamp(by(&o, "Next").finish), "2026-01-05 17:00");
}

#[test]
fn alap_starts_late_is_critical_and_a_deadline_pulls_it_earlier() {
    let o = run(vec![
        after("A", 5.0, &[]),
        PlanTask { alap: true, ..after("Order", 1.0, &[]) },
        after("Install", 1.0, &["A", "Order"]),
    ]);
    assert_eq!(iso(by(&o, "Order").start), "2026-01-09");
    assert!(by(&o, "Order").critical);
    assert!(by(&o, "Order").alap);
    let d = run(vec![
        after("A", 5.0, &[]),
        PlanTask { alap: true, deadline: Some(s(2026, 1, 7)), ..after("Order", 1.0, &[]) },
        after("Install", 1.0, &["A", "Order"]),
    ]);
    assert_eq!(iso(by(&d, "Order").start), "2026-01-07");
    assert!(!by(&d, "Order").late);
    let asap = run(vec![after("A", 5.0, &[]), after("Order", 1.0, &[]), after("Install", 1.0, &["A", "Order"])]);
    assert_eq!(iso(by(&asap, "Order").start), "2026-01-05");
    assert!(!by(&asap, "Order").critical);
}

#[test]
fn longest_path_marks_the_driving_chain() {
    let tasks = || {
        vec![
            after("A", 1.0, &[]),
            PlanTask { start: Some(s(2026, 1, 12)), ..after("B", 2.0, &["A"]) },
            after("C", 3.0, &[]),
            after("End", 0.0, &["B", "C"]),
        ]
    };
    let crit = |o: &ScheduleOutput| o.tasks.iter().map(|x| x.critical).collect::<Vec<_>>();
    assert_eq!(crit(&run(tasks())), [false, true, false, true]);
    assert_eq!(crit(&run_with(ScheduleInput { longest_path: true, ..input(tasks()) })), [false, true, false, true]);
    let due = || {
        vec![
            after("A", 1.0, &[]),
            PlanTask { deadline: Some(s(2026, 1, 6)), ..after("B", 1.0, &["A"]) },
            after("C", 5.0, &[]),
        ]
    };
    assert_eq!(crit(&run(due())), [true, true, true]);
    assert_eq!(crit(&run_with(ScheduleInput { longest_path: true, ..input(due()) })), [false, false, true]);
}

#[test]
fn work_over_units_gives_the_duration() {
    let o = run(vec![
        PlanTask { duration: None, work: Some(40.0), units: Some(1.0), ..after("A", 0.0, &[]) },
        PlanTask { duration: None, work: Some(40.0), units: Some(2.0), ..after("B", 0.0, &[]) },
    ]);
    assert_eq!(by(&o, "A").duration, 5.0);
    assert_eq!(by(&o, "B").duration, 2.5);
    assert_eq!(iso(by(&o, "B").finish), "2026-01-07");
}

#[test]
fn work_divides_by_the_calendar_hours() {
    let ten = CalendarSpec { intervals: Some(vec![(420.0, 1020.0)]), ..working() };
    let o = run_with(ScheduleInput {
        calendar: ten,
        ..input(vec![
            PlanTask { duration: None, work: Some(40.0), ..after("A", 0.0, &[]) },
            own(
                TaskCalendar { intervals: Some(vec![(480.0, 720.0)]), ..TaskCalendar::default() },
                PlanTask { duration: None, work: Some(40.0), ..after("B", 0.0, &[]) },
            ),
        ])
    });
    assert_eq!(by(&o, "A").duration, 4.0);
    assert_eq!(by(&o, "B").duration, 10.0);
}

#[test]
fn progress_splits_a_started_task_around_the_status_date() {
    let tasks = || vec![PlanTask { complete: Some(50.0), ..after("A", 4.0, &[]) }, after("B", 1.0, &["A"])];
    let o = run_with(ScheduleInput { status_date: Some(s(2026, 1, 8)), ..input(tasks()) });
    let a = by(&o, "A");
    assert_eq!(iso(a.start), "2026-01-05");
    assert_eq!(iso(a.finish), "2026-01-12");
    let segs: Vec<(String, String)> = a.segments.as_ref().unwrap().iter().map(|(x, y)| (iso(*x), iso(*y))).collect();
    assert_eq!(segs, [("2026-01-05".into(), "2026-01-06".into()), ("2026-01-09".into(), "2026-01-12".into())]);
    assert_eq!(iso(by(&o, "B").start), "2026-01-13");
    let c =
        run_with(ScheduleInput { status_date: Some(s(2026, 1, 8)), split_in_progress: Some(false), ..input(tasks()) });
    assert!(by(&c, "A").segments.is_none());
    assert_eq!(iso(by(&c, "A").start), "2026-01-07");
    assert_eq!(iso(by(&c, "A").finish), "2026-01-12");
}

#[test]
fn an_actual_start_pins_the_early_start() {
    let o = run_with(ScheduleInput {
        status_date: Some(s(2026, 1, 6)),
        ..input(vec![
            after("A", 3.0, &[]),
            PlanTask { actual_start: Some(s(2026, 1, 6)), complete: Some(50.0), ..after("B", 2.0, &["A"]) },
        ])
    });
    assert_eq!(iso(by(&o, "B").start), "2026-01-06");
    assert!(o.links[0].violated);
    assert_eq!(iso(by(&o, "B").finish), "2026-01-07");
}

#[test]
fn unstarted_and_finished_tasks_ignore_the_status_date() {
    let o = run_with(ScheduleInput {
        status_date: Some(s(2026, 1, 20)),
        ..input(vec![PlanTask { complete: Some(100.0), ..after("A", 2.0, &[]) }, after("B", 2.0, &["A"])])
    });
    assert_eq!(iso(by(&o, "A").finish), "2026-01-06");
    assert!(by(&o, "A").segments.is_none());
    assert_eq!(iso(by(&o, "B").start), "2026-01-07");
}

// ─── Regressions (regressions.test.ts) ──────────────────────────────────────────────────────────────────────────────

#[test]
fn serials_stay_whole_days_across_a_dst_switch() {
    let o = run_with(ScheduleInput {
        start: s(2026, 3, 2),
        ..input(vec![after("A", 10.0, &[]), after("B", 10.0, &["A"]), after("C", 10.0, &["B"])])
    });
    assert!(o.tasks.iter().all(|x| x.start.fract() == 0.0 && x.finish.fract() == 0.0));
    assert_eq!(iso(o.tasks[2].finish), "2026-04-10");
}

#[test]
fn a_lag_honours_the_calendar() {
    let o = run_with(ScheduleInput {
        start: s(2026, 1, 9),
        ..input(vec![after("A", 1.0, &[]), t("B", 1.0, &[P::L("A", LinkType::FS, 2.0)])])
    });
    assert_eq!(iso(o.tasks[1].start), "2026-01-14");
}

#[test]
fn a_parent_of_milestones_is_a_zero_span_summary() {
    let o = run(vec![parent("Gate", &[], vec![after("M1", 0.0, &[]), after("M2", 0.0, &["M1"])])]);
    assert!(o.tasks[0].summary);
    assert_eq!(o.tasks[0].duration, 0.0);
    assert_eq!(iso(o.tasks[0].start), "2026-01-05");
}

#[test]
fn a_circular_link_is_refused_by_name() {
    let loops = |tasks: Vec<PlanTask>| schedule(&input(tasks)).unwrap_err().message.contains("loop");
    assert!(loops(vec![after("A", 1.0, &["C"]), after("B", 1.0, &["A"]), after("C", 1.0, &["B"])]));
    assert!(loops(vec![parent("P", &["X"], vec![after("X", 1.0, &[])])]));
}

#[test]
fn mermaid_ends_are_exclusive() {
    let o = run(vec![after("A", 5.0, &[])]);
    assert!(mermaid_gantt(&o, iso).contains("A :crit, t0, 2026-01-05, 2026-01-10"));
}

#[test]
fn a_walk_past_the_date_range_is_an_error_at_once() {
    for tasks in [
        vec![after("A", 3e6, &[])],
        vec![after("A", 1e9, &[])],
        vec![after("A", 1.0, &[]), t("B", 1.0, &[P::L("A", LinkType::FS, -1e9)])],
    ] {
        assert!(schedule(&input(tasks)).is_err());
    }
}

// ─── MSPDI (formats.test.ts) ────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn mspdi_writes_a_midnight_minutes_finish_on_the_day_it_ended() {
    let o = run_minutes(vec![after("A", 1.0, &[])]);
    let xml = write_mspdi(
        &o,
        &MspdiOptions { title: Some("T"), hours_per_day: None, format_iso: &iso, minutes: true, holidays: None },
    );
    assert!(xml.contains("<Finish>2026-01-05T17:00:00</Finish>"));
    assert!(xml.contains("<Start>2026-01-05T08:00:00</Start>"));
}

#[test]
fn mspdi_writes_a_start_floor_with_its_date() {
    let floor = s(2026, 3, 11);
    for minutes_mode in [false, true] {
        let o = run_with(ScheduleInput {
            start: s(2026, 3, 2),
            calendar: CalendarSpec { minutes: minutes_mode, ..working() },
            ..input(vec![after("A", 2.0, &[]), PlanTask { start: Some(floor), ..after("B", 1.0, &["A"]) }])
        });
        assert!(o.tasks[1].floored);
        let xml = write_mspdi(
            &o,
            &MspdiOptions { title: None, hours_per_day: None, format_iso: &iso, minutes: minutes_mode, holidays: None },
        );
        assert!(xml.contains("<ConstraintType>4</ConstraintType><ConstraintDate>2026-03-11T08:00:00</ConstraintDate>"));
    }
    let o = run_with(ScheduleInput {
        start: s(2026, 3, 2),
        ..input(vec![after("A", 5.0, &[]), PlanTask { start: Some(s(2026, 3, 3)), ..after("B", 1.0, &["A"]) }])
    });
    assert!(!o.tasks[1].floored);
    let xml = write_mspdi(
        &o,
        &MspdiOptions { title: None, hours_per_day: None, format_iso: &iso, minutes: false, holidays: None },
    );
    assert!(xml.contains("<ConstraintDate>2026-03-03T08:00:00</ConstraintDate>"));
}
