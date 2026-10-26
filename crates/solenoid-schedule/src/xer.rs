// [[D68]] importUnsupportedIsNamed
//! Primavera XER read: tab-separated `%T` tables, `%F` fields and `%R` rows.

use crate::calendar::{CalendarSpec, Interval};
use crate::files::{day_list, dedupe, iso_to_serial, seven_day_week, weekend_code, PlanFile, UniqueNames};
use crate::num::{js_trim, math_round, string_to_number};
use crate::{Dependency, LinkType, PlanTask};
use std::collections::{HashMap, HashSet};

type Row = HashMap<String, String>;

fn tables(text: &str) -> HashMap<Option<String>, Vec<Row>> {
    let mut out: HashMap<Option<String>, Vec<Row>> = HashMap::new();
    let mut table: Option<Option<String>> = None;
    let mut fields: Vec<&str> = Vec::new();
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let cells: Vec<&str> = line.split('\t').collect();
        match cells[0] {
            "%T" => {
                let name = cells.get(1).map(|s| s.to_string());
                out.insert(name.clone(), Vec::new());
                table = Some(name);
                fields.clear();
            }
            "%F" => fields = cells[1..].to_vec(),
            "%R" => {
                let row: Row = fields
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (f.to_string(), cells.get(i + 1).unwrap_or(&"").to_string()))
                    .collect();
                if let Some(rows) = table.as_ref().and_then(|t| out.get_mut(t)) {
                    rows.push(row);
                }
            }
            _ => {}
        }
    }
    out
}

fn link_type(code: Option<&str>) -> LinkType {
    match code {
        Some("PR_SS") => LinkType::SS,
        Some("PR_FF") => LinkType::FF,
        Some("PR_SF") => LinkType::SF,
        _ => LinkType::FS,
    }
}

/// `Number(row[f] ?? 0) || or`: a blank, missing or unreadable field falls back.
fn number_or(row: &Row, f: &str, or: f64) -> f64 {
    let v = row.get(f).map_or(0.0, |s| string_to_number(s));
    if v == 0.0 || v.is_nan() {
        or
    } else {
        v
    }
}

fn field<'a>(row: Option<&'a Row>, f: &str) -> Option<&'a str> {
    row.and_then(|r| r.get(f)).map(String::as_str)
}

struct Node {
    task: PlanTask,
    /// A WBS node's children; `None` for an activity.
    children: Option<Vec<usize>>,
}

/// The tree under `roots`, a WBS with nothing beneath it dropped.
fn build(arena: &[Node], list: &[usize], path: &mut HashSet<usize>) -> Vec<PlanTask> {
    let mut out = Vec::new();
    for &i in list {
        let Node { task, children } = &arena[i];
        let mut t = task.clone();
        if let Some(kids) = children {
            if !path.insert(i) {
                continue;
            }
            let built = build(arena, kids, path);
            path.remove(&i);
            if built.is_empty() {
                continue;
            }
            t.children = Some(built);
        }
        out.push(t);
    }
    out
}

pub fn read_xer(text: &str) -> PlanFile {
    let tables = tables(text);
    let table = |name: &str| tables.get(&Some(name.to_string())).map_or(&[][..], Vec::as_slice);
    let mut unsupported: Vec<String> = Vec::new();
    let project = table("PROJECT").first();
    let clndr = table("CALENDAR").iter().find(|c| field(Some(c), "clndr_id") == field(project, "clndr_id"));
    let hours_per_day = clndr.map_or(8.0, |c| number_or(c, "day_hr_cnt", 8.0));
    let mut wbs: Vec<&Row> = table("PROJWBS").iter().collect();
    let seq = |r: &Row| r.get("seq_num").map_or(0.0, |s| string_to_number(s));
    wbs.sort_by(|a, b| seq(a).partial_cmp(&seq(b)).unwrap_or(std::cmp::Ordering::Equal));
    let mut names = UniqueNames::default();
    let mut arena: Vec<Node> = Vec::new();
    let mut nodes: HashMap<&str, usize> = HashMap::new();
    let mut roots: Vec<usize> = Vec::new();
    let named = |r: &Row, keys: [&str; 3]| keys.iter().find_map(|k| r.get(*k)).map_or("", |s| js_trim(s)).to_string();
    for w in &wbs {
        let name = names.name(&named(w, ["wbs_name", "wbs_short_name", "wbs_id"]));
        nodes.insert(field(Some(w), "wbs_id").unwrap_or(""), arena.len());
        arena.push(Node {
            task: PlanTask { name, duration: Some(0.0), ..PlanTask::default() },
            children: Some(Vec::new()),
        });
    }
    let attach = |arena: &mut Vec<Node>, roots: &mut Vec<usize>, parent: Option<usize>, i: usize| match parent {
        Some(p) => arena[p].children.get_or_insert_with(Vec::new).push(i),
        None => roots.push(i),
    };
    for w in &wbs {
        let i = nodes[field(Some(w), "wbs_id").unwrap_or("")];
        let parent = field(Some(w), "parent_wbs_id").filter(|p| !p.is_empty()).and_then(|p| nodes.get(p).copied());
        attach(&mut arena, &mut roots, parent, i);
    }
    let mut by_task: HashMap<&str, usize> = HashMap::new();
    for r in
        table("TASK").iter().filter(|t| project.is_none() || field(Some(t), "proj_id") == field(project, "proj_id"))
    {
        let hours = number_or(r, "target_drtn_hr_cnt", 0.0);
        let name = names.name(&named(r, ["task_name", "task_code", "task_id"]));
        let kind = field(Some(r), "task_type");
        let mut t = PlanTask {
            duration: Some(if matches!(kind, Some("TT_Mile" | "TT_FinMile")) {
                0.0
            } else {
                math_round(hours / hours_per_day * 1000.0) / 1000.0
            }),
            ..PlanTask::default()
        };
        let pct = r.get("phys_complete_pct").map_or(0.0, |s| string_to_number(s));
        t.complete = (pct > 0.0).then_some(pct);
        t.actual_start = iso_to_serial(field(Some(r), "act_start_date"));
        let cstr = field(Some(r), "cstr_type").unwrap_or("");
        if let Some(cdate) = iso_to_serial(field(Some(r), "cstr_date")) {
            match cstr {
                "CS_MSO" | "CS_MEO" => {
                    t.start = Some(cdate);
                    t.manual = true;
                }
                "CS_MSOA" => t.start = Some(cdate),
                "CS_MEOB" | "CS_MSOB" => t.finish = Some(cdate),
                "CS_ALAP" => t.alap = true,
                _ => unsupported.push(format!("constraint {cstr} on \"{name}\"")),
            }
        } else if cstr == "CS_ALAP" {
            t.alap = true;
        }
        if matches!(kind, Some("TT_LOE" | "TT_WBS")) {
            unsupported.push(format!("level-of-effort task \"{name}\""));
        }
        t.name = name;
        by_task.insert(field(Some(r), "task_id").unwrap_or(""), arena.len());
        let parent = field(Some(r), "wbs_id").and_then(|w| nodes.get(w).copied());
        let i = arena.len();
        arena.push(Node { task: t, children: None });
        attach(&mut arena, &mut roots, parent, i);
    }
    for p in table("TASKPRED") {
        let (Some(&to), Some(&from)) = (
            by_task.get(field(Some(p), "task_id").unwrap_or("")),
            by_task.get(field(Some(p), "pred_task_id").unwrap_or("")),
        ) else {
            continue;
        };
        let lag = number_or(p, "lag_hr_cnt", 0.0);
        let task = arena[from].task.name.clone();
        arena[to].task.predecessors.push(Dependency {
            task,
            ty: link_type(field(Some(p), "pred_type")),
            lag: math_round(lag / hours_per_day * 1000.0) / 1000.0,
            elapsed: None,
        });
    }
    let tasks = build(&arena, &roots, &mut HashSet::new());
    let calendar = match clndr.and_then(|c| c.get("clndr_data")).filter(|d| !d.is_empty()) {
        Some(blob) => calendar(blob, &mut unsupported),
        None => CalendarSpec { working_days: true, weekend_code: Some(1.0), ..CalendarSpec::default() },
    };
    PlanFile {
        title: field(project, "proj_short_name").unwrap_or("").to_string(),
        start: iso_to_serial(field(project, "plan_start_date")),
        calendar,
        tasks,
        unsupported: dedupe(unsupported),
    }
}

/// The inside of the balanced group that opens at `open`, or the rest when it never closes.
fn paren_body(s: &str, open: usize) -> &str {
    let mut depth = 0;
    for (i, c) in s.bytes().enumerate().skip(open) {
        if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
            if depth == 0 {
                return &s[open + 1..i];
            }
        }
    }
    s.get(open + 1..).unwrap_or("")
}

fn two_digits(b: &[u8]) -> Option<f64> {
    (b.len() >= 2 && b[..2].iter().all(u8::is_ascii_digit)).then(|| f64::from((b[0] - b'0') * 10 + (b[1] - b'0')))
}

/// Every `s|HH:MM|f|HH:MM` work time in a day's group, in minutes from midnight.
fn work_times(body: &str) -> Vec<Interval> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(k) = body[i..].find("s|").map(|k| k + i) {
        let at = |o: usize| b.get(k + o..).unwrap_or(&[]);
        let time = |o: usize| {
            Some(two_digits(at(o))? * 60.0 + two_digits(at(o + 3)).filter(|_| at(o + 2).first() == Some(&b':'))?)
        };
        match (time(2), at(7).starts_with(b"|f|"), time(10)) {
            (Some(s), true, Some(f)) => {
                out.push((s, f));
                i = k + 15;
            }
            _ => i = k + 1,
        }
    }
    out
}

/// A `clndr_data` blob: a weekday with no work times is off (P6 numbers Sunday 1), an exception with no work times
/// is a holiday, and work times are the intervals. The blob nests parentheses, so it is walked as balanced groups.
fn calendar(blob: &str, unsupported: &mut Vec<String>) -> CalendarSpec {
    let mut cal = CalendarSpec { working_days: true, weekend_code: Some(1.0), ..CalendarSpec::default() };
    if let Some(at) = blob.find("DaysOfWeek()(") {
        let week = paren_body(blob, at + "DaysOfWeek()".len());
        let wb = week.as_bytes();
        let (mut off, mut seen, mut intervals) = (Vec::new(), 0, None::<Vec<Interval>>);
        let mut i = 0;
        while let Some(k) = week[i..].find("(0||").map(|k| k + i) {
            let day = wb.get(k + 4).filter(|d| (b'1'..=b'7').contains(d));
            match day.filter(|_| wb.get(k + 5..k + 8) == Some(b"()(")) {
                Some(d) => {
                    let times = work_times(paren_body(week, k + 7));
                    seen += 1;
                    if times.is_empty() {
                        off.push(f64::from(d - b'1'));
                    } else if intervals.is_none() {
                        intervals = Some(times);
                    }
                    i = k + 8;
                }
                None => i = k + 1,
            }
        }
        if off.is_empty() && seen >= 7 {
            cal.working_days = false;
        }
        match weekend_code(&off) {
            Some(code) => cal.weekend_code = Some(code),
            None => unsupported.push(format!("weekend pattern [{}] is not a WORKDAY.INTL code", day_list(&off))),
        }
        if let Some(iv) = intervals.filter(|iv| !(iv.len() == 2 && iv[0].0 == 480.0 && iv[1].1 == 1020.0)) {
            cal.intervals = Some(iv);
        }
    }
    if let Some(at) = blob.find("(0||Exceptions()(") {
        let rest = &blob[at + "(0||Exceptions()(".len()..];
        let mut holidays: Vec<f64> = Vec::new();
        let mut i = 0;
        while let Some(k) = rest[i..].find("(0||").map(|k| k + i) {
            i = k + 1;
            let r = &rest[k + 4..];
            let n = r.bytes().take_while(u8::is_ascii_digit).count();
            let Some(r) = r.get(n..).filter(|_| n > 0).and_then(|r| r.strip_prefix("(d|")) else { continue };
            let m = r.bytes().take_while(u8::is_ascii_digit).count();
            let Some(body) = r.get(m..).filter(|_| m > 0).and_then(|b| b.strip_prefix(")(")) else { continue };
            let Some(end) = body.find("))") else { continue };
            if !has_time(&body[..end]) {
                holidays.push(r[..m].parse().unwrap_or(f64::NAN));
            }
            i = rest.len() - body.len() + end + 2;
        }
        if !holidays.is_empty() {
            holidays.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            cal.holidays = Some(holidays.into_iter().map(Some).collect());
        }
    }
    seven_day_week(&mut cal, unsupported);
    cal
}

/// `s|\d{2}:\d{2}`.
fn has_time(body: &str) -> bool {
    body.match_indices("s|").any(|(k, _)| {
        let b = &body.as_bytes()[k + 2..];
        two_digits(b).is_some() && b.get(2) == Some(&b':') && two_digits(&b[3.min(b.len())..]).is_some()
    })
}
