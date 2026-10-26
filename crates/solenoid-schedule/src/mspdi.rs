// [[C44]] dateSerials, [[D68]] importUnsupportedIsNamed
//! Microsoft Project XML (MSPDI, pj14) read.

use crate::calendar::{CalendarSpec, Interval};
use crate::files::{day_list, dedupe, iso_to_serial, seven_day_week, weekend_code, PlanFile, UniqueNames};
use crate::num::{js_lower, js_trim, math_min, math_round, string_to_number};
use crate::xml::{self, XmlNode};
use crate::{Dependency, LinkType, PlanTask, ScheduleError, TaskCalendar};
use std::collections::HashMap;

/// The dates and slack the file itself stores for a task, for a parity test.
#[derive(Clone, Debug, PartialEq)]
pub struct Golden {
    pub name: String,
    pub start: Option<f64>,
    pub finish: Option<f64>,
    pub early_start: Option<f64>,
    pub early_finish: Option<f64>,
    pub late_start: Option<f64>,
    pub late_finish: Option<f64>,
    pub total_slack: Option<f64>,
    pub free_slack: Option<f64>,
    pub critical: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct MspdiPlan {
    /// Its start is always set: the file's `StartDate`, else the earliest stored task start, else serial 0.
    pub file: PlanFile,
    pub hours_per_day: f64,
    pub golden: Vec<Golden>,
}

/// The elapsed duration and lag formats (`ed` and its kin).
const ELAPSED_FORMATS: [f64; 18] =
    [4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 36.0, 38.0, 40.0, 42.0, 44.0, 46.0, 48.0, 50.0, 52.0];

fn link_type(code: &str) -> LinkType {
    match code {
        "0" => LinkType::FF,
        "2" => LinkType::SF,
        "3" => LinkType::SS,
        _ => LinkType::FS,
    }
}

/// A number then `unit` off the front of `rest`; 0 when they are not there.
fn component(rest: &mut &str, unit: char) -> f64 {
    let int = rest.bytes().take_while(u8::is_ascii_digit).count();
    if int == 0 {
        return 0.0;
    }
    let frac = match rest[int..].strip_prefix('.') {
        Some(f) if f.starts_with(|c: char| c.is_ascii_digit()) => 1 + f.bytes().take_while(u8::is_ascii_digit).count(),
        _ => 0,
    };
    match rest[int + frac..].strip_prefix(unit) {
        Some(after) => {
            let v = rest[..int + frac].parse().unwrap_or(0.0);
            *rest = after;
            v
        }
        None => 0.0,
    }
}

/// An XSD duration (`PT8H0M0S`, `P1DT4H`) in hours; a leading minus is read past.
pub fn xsd_duration_to_hours(s: Option<&str>) -> Option<f64> {
    let t = js_trim(s.filter(|s| !s.is_empty())?);
    let mut rest = t.strip_prefix('-').unwrap_or(t).strip_prefix('P')?;
    let d = component(&mut rest, 'D');
    let (mut h, mut m, mut sec) = (0.0, 0.0, 0.0);
    if let Some(after) = rest.strip_prefix('T') {
        rest = after;
        h = component(&mut rest, 'H');
        m = component(&mut rest, 'M');
        sec = component(&mut rest, 'S');
    }
    rest.is_empty().then_some(d * 24.0 + h + m / 60.0 + sec / 3600.0)
}

fn num(s: Option<&str>) -> Option<f64> {
    let v = string_to_number(s.filter(|s| !s.is_empty())?);
    v.is_finite().then_some(v)
}

fn flag(s: Option<&str>) -> Option<bool> {
    s.map(|s| s == "1" || js_lower(s) == "true")
}

fn clock_minutes(s: Option<&str>) -> Option<f64> {
    let b = js_trim(s?).as_bytes();
    let digits = |r: &[u8]| r.iter().fold(0.0, |n, c| n * 10.0 + f64::from(c - b'0'));
    [2, 1].into_iter().find_map(|k| {
        let (h, rest) = (b.get(..k)?, b.get(k..)?);
        let m = rest.strip_prefix(b":")?.get(..2)?;
        (h.iter().chain(m).all(u8::is_ascii_digit)).then(|| digits(h) * 60.0 + digits(m))
    })
}

fn day_range(from: Option<f64>, to: Option<f64>, into: &mut Vec<Option<f64>>) {
    if let (Some(from), Some(to)) = (from, to) {
        let mut s = from;
        while s <= to {
            into.push(Some(s));
            s += 1.0;
        }
    }
}

fn read_calendar(root: &XmlNode, unsupported: &mut Vec<String>, want_uid: Option<&str>) -> CalendarSpec {
    let list: Vec<&XmlNode> = root.child("Calendars").map(|c| c.children("Calendar").collect()).unwrap_or_default();
    let uid = want_uid.or_else(|| root.text_of("CalendarUID"));
    let found = list.iter().find(|c| c.text_of("UID") == uid).or_else(|| match want_uid {
        Some(_) => None,
        None => list.iter().find(|c| c.text_of("IsBaseCalendar") == Some("1")).or(list.first()),
    });
    let Some(&cal) = found else { return CalendarSpec { working_days: true, ..CalendarSpec::default() } };
    let base = cal
        .text_of("BaseCalendarUID")
        .filter(|b| !b.is_empty() && *b != "-1")
        .and_then(|b| list.iter().find(|c| c.text_of("UID") == Some(b)));
    let week = cal.child("WeekDays").or_else(|| base.and_then(|b| b.child("WeekDays")));
    let mut off: Vec<f64> = Vec::new();
    let mut working_types: Vec<f64> = Vec::new();
    let mut holidays: Vec<Option<f64>> = Vec::new();
    let mut intervals: Option<Vec<Interval>> = None;
    for day in week.into_iter().flat_map(|w| w.children("WeekDay")) {
        let ty = num(day.text_of("DayType"));
        let working = flag(day.text_of("DayWorking"));
        if let Some(t) = ty.filter(|t| (1.0..=7.0).contains(t)) {
            match working {
                Some(false) => off.push(t - 1.0),
                Some(true) if !working_types.contains(&t) => working_types.push(t),
                _ => {}
            }
        }
        if ty == Some(0.0) && working == Some(false) {
            let period = day.child("TimePeriod");
            let at = |f: &str| iso_to_serial(period.and_then(|p| p.text_of(f)));
            day_range(at("FromDate"), at("ToDate"), &mut holidays);
        }
        if let Some(times) = day.child("WorkingTimes").filter(|_| working != Some(false) && intervals.is_none()) {
            let iv: Vec<Interval> = times
                .children("WorkingTime")
                .filter_map(|w| Some((clock_minutes(w.text_of("FromTime"))?, clock_minutes(w.text_of("ToTime"))?)))
                .filter(|(a, b)| b > a)
                .collect();
            if !iv.is_empty() {
                intervals = Some(iv);
            }
        }
    }
    for e in cal.child("Exceptions").into_iter().flat_map(|x| x.children("Exception")) {
        if flag(e.text_of("DayWorking")) != Some(false) {
            unsupported.push("working exceptions".into());
            continue;
        }
        let period = e.child("TimePeriod");
        let at = |f: &str| iso_to_serial(period.and_then(|p| p.text_of(f)));
        day_range(at("FromDate"), at("ToDate"), &mut holidays);
    }
    let code = weekend_code(&off).unwrap_or_else(|| {
        unsupported.push(format!("weekend pattern [{}] is not a WORKDAY.INTL code", day_list(&off)));
        1.0
    });
    let mut spec = CalendarSpec {
        working_days: !(off.is_empty() && working_types.len() == 7),
        weekend_code: Some(code),
        holidays: Some(holidays),
        intervals,
        ..CalendarSpec::default()
    };
    seven_day_week(&mut spec, unsupported);
    spec
}

fn slack_days(s: Option<&str>, hours_per_day: f64) -> Option<f64> {
    num(s).map(|v| math_round(v / 10.0 / 60.0 / hours_per_day))
}

struct Rec {
    task: PlanTask,
    level: f64,
}

pub fn read_mspdi(text: &str) -> Result<MspdiPlan, ScheduleError> {
    let root = xml::parse(text)?;
    if root.name != "Project" {
        return Err(ScheduleError::new("Not an MSPDI file: the root element is not <Project>"));
    }
    let mut unsupported: Vec<String> = Vec::new();
    let hours_per_day = num(root.text_of("MinutesPerDay")).unwrap_or(480.0) / 60.0;
    let calendar = read_calendar(&root, &mut unsupported, None);
    let start = iso_to_serial(root.text_of("StartDate"));
    let mut by_uid: HashMap<&str, String> = HashMap::new();
    let mut recs: Vec<Rec> = Vec::new();
    let mut golden: Vec<Golden> = Vec::new();
    let mut names = UniqueNames::default();
    for el in root.child("Tasks").into_iter().flat_map(|t| t.children("Task")) {
        let text = |f: &str| el.text_of(f);
        let uid = text("UID").unwrap_or("");
        let given = js_trim(text("Name").unwrap_or(""));
        let given = if given.is_empty() { format!("Task {uid}") } else { given.to_string() };
        let level = num(text("OutlineLevel")).unwrap_or(1.0);
        if level == 0.0 || text("IsNull") == Some("1") {
            continue;
        }
        if flag(text("Active")) == Some(false) {
            unsupported.push(format!("inactive task \"{given}\""));
            continue;
        }
        let name = names.name(&given);
        if el.child("Recurring").is_some() && flag(text("Recurring")) == Some(true) {
            unsupported.push(format!("recurring task \"{name}\""));
        }
        by_uid.insert(uid, name.clone());
        let hours = xsd_duration_to_hours(text("Duration")).unwrap_or(0.0);
        let milestone = flag(text("Milestone")) == Some(true);
        let duration_text = text("Duration").unwrap_or("");
        let elapsed = (duration_text.starts_with('P') || duration_text.starts_with("-P"))
            && !duration_text.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
            && ELAPSED_FORMATS.contains(&num(text("DurationFormat")).unwrap_or(-1.0));
        let duration = if milestone && hours == 0.0 {
            0.0
        } else {
            (hours / if elapsed { 24.0 } else { hours_per_day } - 1e-9).ceil()
        };
        let manual = flag(text("Manual")) == Some(true);
        let ct = num(text("ConstraintType"));
        let cd = iso_to_serial(text("ConstraintDate"));
        let mut task = PlanTask {
            name: name.clone(),
            duration: Some(duration),
            row: Some(recs.len() as f64 + 1.0),
            ..PlanTask::default()
        };
        if let (Some(cd), Some(ct)) = (cd, ct) {
            match ct {
                4.0 => task.start = Some(cd),
                2.0 => {
                    task.start = Some(cd);
                    task.manual = true;
                }
                3.0 => {
                    task.finish = Some(cd);
                    task.manual = true;
                    task.start = if manual { iso_to_serial(text("Start")) } else { None };
                    unsupported.push(format!("must-finish-on for \"{name}\" pins the start from the file"));
                }
                5.0 | 7.0 => task.finish = Some(cd),
                6.0 => unsupported.push(format!("finish-no-earlier-than on \"{name}\"")),
                1.0 => task.alap = true,
                _ => {}
            }
        }
        if ct == Some(1.0) && cd.is_none() {
            task.alap = true;
        }
        if manual {
            task.manual = true;
            task.start = iso_to_serial(text("ManualStart").or(text("Start")));
            task.finish = iso_to_serial(text("ManualFinish").or(text("Finish")));
        }
        task.deadline = iso_to_serial(text("Deadline"));
        task.actual_start = iso_to_serial(text("ActualStart"));
        task.elapsed = elapsed;
        if let Some(own) =
            text("CalendarUID").filter(|u| !u.is_empty() && *u != "-1" && Some(*u) != root.text_of("CalendarUID"))
        {
            let own = read_calendar(&root, &mut unsupported, Some(own));
            task.calendar =
                Some(TaskCalendar { weekend_code: own.weekend_code, holidays: own.holidays, intervals: own.intervals });
        }
        task.complete = num(text("PercentComplete")).filter(|p| *p > 0.0);
        for link in el.children("PredecessorLink") {
            let lag_tenths = num(link.text_of("LinkLag")).unwrap_or(0.0);
            let lag_format = num(link.text_of("LagFormat"));
            let elapsed = lag_format.is_some_and(|f| ELAPSED_FORMATS.contains(&f));
            let mut lag = lag_tenths / 10.0 / 60.0 / if elapsed { 24.0 } else { hours_per_day };
            if matches!(lag_format, Some(19.0 | 51.0 | 20.0 | 52.0)) {
                let d = task.duration.filter(|d| *d != 0.0 && !d.is_nan()).unwrap_or(1.0);
                lag = lag_tenths / 100.0 * d;
            }
            task.predecessors.push(Dependency {
                task: link.text_of("PredecessorUID").unwrap_or("").to_string(),
                ty: link_type(link.text_of("Type").unwrap_or("1")),
                lag: math_round(lag * 1000.0) / 1000.0,
                elapsed: elapsed.then_some(true),
            });
        }
        let at = |f: &str| iso_to_serial(text(f));
        golden.push(Golden {
            name,
            start: at("Start"),
            finish: at("Finish"),
            early_start: at("EarlyStart"),
            early_finish: at("EarlyFinish"),
            late_start: at("LateStart"),
            late_finish: at("LateFinish"),
            total_slack: slack_days(text("TotalSlack"), hours_per_day),
            free_slack: slack_days(text("FreeSlack"), hours_per_day),
            critical: flag(text("Critical")),
        });
        recs.push(Rec { task, level });
    }
    for r in &mut recs {
        let name = r.task.name.clone();
        r.task.predecessors.retain_mut(|p| match by_uid.get(p.task.as_str()) {
            Some(n) => {
                p.task = n.clone();
                true
            }
            None => {
                unsupported.push(format!("link to a missing task {} on \"{name}\"", p.task));
                false
            }
        });
    }
    let start = start.or_else(|| golden.iter().filter_map(|g| g.start).reduce(math_min)).unwrap_or(0.0);
    let title = root.text_of("Title").or(root.text_of("Name")).unwrap_or("").to_string();
    let tasks = nest(recs);
    Ok(MspdiPlan {
        file: PlanFile { title, start: Some(start), calendar, tasks, unsupported: dedupe(unsupported) },
        hours_per_day,
        golden,
    })
}

/// Nests the tasks by outline level: a task is the child of the nearest earlier task at a lower level.
fn nest(recs: Vec<Rec>) -> Vec<PlanTask> {
    let mut roots: Vec<PlanTask> = Vec::new();
    let mut stack: Vec<(PlanTask, f64)> = Vec::new();
    let close = |stack: &mut Vec<(PlanTask, f64)>, roots: &mut Vec<PlanTask>| {
        let (done, _) = stack.pop().unwrap();
        match stack.last_mut() {
            Some((parent, _)) => parent.children.get_or_insert_with(Vec::new).push(done),
            None => roots.push(done),
        }
    };
    for r in recs {
        while stack.last().is_some_and(|(_, l)| *l >= r.level) {
            close(&mut stack, &mut roots);
        }
        stack.push((r.task, r.level));
    }
    while !stack.is_empty() {
        close(&mut stack, &mut roots);
    }
    roots
}
