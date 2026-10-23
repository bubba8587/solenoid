//! What a schedule reports: `diagnostics.ts` (the DCMA-style checks, [[B14]] oneDesignSystem), `mermaid.ts` (a
//! `gantt` block, [[B1]] obsidianBet), `formats.ts`'s MSPDI writer and `predecessors.ts`'s link text.

use super::{Dependency, Diagnostic, LinkType, ScheduleLink, ScheduleOutput, ScheduledTask};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_round, number_to_string};
use std::collections::{HashMap, HashSet};

const HIGH_FLOAT_DAYS: f64 = 44.0;

pub fn diagnose(tasks: &[ScheduledTask], links: &[ScheduleLink], status_date: Option<f64>, long_task: f64) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut push = |check: &str, task: &str, detail: String| out.push(Diagnostic { check: check.into(), task: task.into(), detail });
    let lower = |s: &str| js_lower(s).into_owned();
    let with_ancestors = |name: &str| -> Vec<String> {
        let i = tasks.iter().position(|t| t.name == name);
        let mut names = vec![lower(name)];
        let mut level = i.map_or(0.0, |i| tasks[i].level);
        let mut j = i.map_or(-1, |i| i as isize - 1);
        while j >= 0 && level > 0.0 {
            let t = &tasks[j as usize];
            if t.level < level {
                names.push(lower(&t.name));
                level = t.level;
            }
            j -= 1;
        }
        names
    };
    let linked_to: HashSet<String> = links.iter().map(|l| lower(&l.to)).collect();
    let linked_from: HashSet<String> = links.iter().map(|l| lower(&l.from)).collect();
    let mut has_pred = HashSet::new();
    let mut has_succ = HashSet::new();
    for t in tasks {
        let chain = with_ancestors(&t.name);
        if chain.iter().any(|n| linked_to.contains(n)) {
            has_pred.insert(lower(&t.name));
        }
        if chain.iter().any(|n| linked_from.contains(n)) {
            has_succ.insert(lower(&t.name));
        }
    }
    let leaves: Vec<&ScheduledTask> = tasks.iter().filter(|t| !t.summary).collect();
    let days = |n: f64| format!("{} day{}", number_to_string(n), if n == 1.0 { "" } else { "s" });
    for t in &leaves {
        let k = lower(&t.name);
        if t.manual {
            push("Manual", &t.name, "Pinned to its typed dates; its predecessors are ignored".into());
        } else {
            if !has_pred.contains(&k) && leaves.len() > 1 {
                push("No predecessor", &t.name, "Starts on the project start; nothing holds it".into());
            }
            if !has_succ.contains(&k) && leaves.len() > 1 {
                push("No successor", &t.name, "Nothing waits on it; a slip moves nothing".into());
            }
        }
        if t.floored {
            push("Held by a typed start", &t.name, "Its Start is later than its predecessors need".into());
        }
        if t.float < 0.0 {
            push("Negative float", &t.name, format!("{} short of its Finish or Deadline", days(-t.float)));
        } else if t.float > HIGH_FLOAT_DAYS {
            push("High float", &t.name, format!("{} of slack; check its links", days(t.float)));
        }
        if t.late {
            push("Past deadline", &t.name, "Finishes after its Deadline".into());
        }
        if t.duration > long_task {
            push("Long task", &t.name, format!("{}; consider splitting it", days(t.duration)));
        }
        if let Some(s) = status_date {
            if t.complete <= 0.0 && t.start <= s {
                push("Should have started", &t.name, "Starts before the status date with no progress".into());
            }
            if t.complete < 100.0 && t.finish < s {
                push("Should have finished", &t.name, "Finishes before the status date but is not complete".into());
            }
            if t.complete >= 100.0 && t.finish > s {
                push("Finished early", &t.name, "Complete before its scheduled finish".into());
            }
        }
    }
    for l in links {
        if l.lag < 0.0 {
            push("Lead", &l.to, format!("{} before {} {}", days(-l.lag), l.from, if l.ty == LinkType::FS { "finishes" } else { "starts" }));
        } else if l.lag > 0.0 {
            push("Lag", &l.to, format!("{} after {}", days(l.lag), l.from));
        }
        if l.ty != LinkType::FS {
            push("Link type", &l.to, format!("{} from {}", l.ty.as_str(), l.from));
        }
        if l.violated {
            push("Broken link", &l.to, format!("Starts before {} allows", l.from));
        }
    }
    out
}

/// `label`: `[:#;,]` to a space, each whitespace run to one space, trimmed.
fn label(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if matches!(c, ':' | '#' | ';' | ',') || is_js_space(c) {
            space = true;
        } else {
            if space {
                out.push(' ');
                space = false;
            }
            out.push(c);
        }
    }
    let t = js_trim(&out);
    if t.is_empty() { "task".into() } else { t.to_string() }
}

const WEEKDAY_NAMES: [&str; 7] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

pub fn mermaid_gantt(out: &ScheduleOutput, format_iso: impl Fn(f64) -> String) -> String {
    let mut lines: Vec<String> = vec!["gantt".into(), "    dateFormat YYYY-MM-DD".into(), "    axisFormat %d %b".into()];
    if !out.weekend.is_empty() {
        let std = out.weekend.len() == 2 && out.weekend.contains(&0.0) && out.weekend.contains(&6.0);
        let mut days: Vec<String> = if std { vec!["weekends".into()] } else { out.weekend.iter().map(|d| WEEKDAY_NAMES[*d as usize].to_string()).collect() };
        days.extend(out.holidays.iter().map(|h| format_iso(*h)));
        lines.push(format!("    excludes {}", days.join(", ")));
    }
    let mut sections: Vec<(Option<&str>, Vec<usize>)> = Vec::new();
    for (i, t) in out.tasks.iter().enumerate() {
        let k = t.group.as_deref();
        match sections.iter_mut().find(|(g, _)| *g == k) {
            Some((_, idxs)) => idxs.push(i),
            None => sections.push((k, vec![i])),
        }
    }
    for (group, idxs) in &sections {
        if let Some(g) = group {
            lines.push(format!("    section {}", label(g)));
        }
        for &i in idxs {
            let t = &out.tasks[i];
            if t.summary {
                continue;
            }
            let tags: Vec<&str> = [
                if t.milestone { "milestone" } else { "" },
                if t.complete >= 100.0 { "done" } else if t.complete > 0.0 { "active" } else { "" },
                if t.critical { "crit" } else { "" },
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
            let start_iso = format_iso(t.start);
            let span = if t.milestone { "0d".to_string() } else { format_iso(t.finish + 1.0) };
            let indent = "  ".repeat(t.level as usize);
            let tagged = if tags.is_empty() { String::new() } else { format!("{}, ", tags.join(", ")) };
            lines.push(format!("    {indent}{} :{tagged}t{i}, {start_iso}, {span}", label(&t.name)));
        }
    }
    lines.join("\n")
}

pub fn predecessor_text(deps: &[Dependency]) -> String {
    deps.iter()
        .map(|d| {
            let ty = if d.ty == LinkType::FS { String::new() } else { format!(" {}", d.ty.as_str()) };
            let lag = if d.lag == 0.0 {
                String::new()
            } else {
                format!(
                    "{}{}{}{}",
                    if ty.is_empty() { " FS" } else { "" },
                    if d.lag > 0.0 { "+" } else { "" },
                    number_to_string(d.lag),
                    if d.elapsed == Some(true) { "ed" } else { "" }
                )
            };
            format!("{}{ty}{lag}", d.task)
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn link_code(t: LinkType) -> u8 {
    match t {
        LinkType::FF => 0,
        LinkType::FS => 1,
        LinkType::SF => 2,
        LinkType::SS => 3,
    }
}

pub struct MspdiOptions<'a> {
    pub title: Option<&'a str>,
    pub hours_per_day: Option<f64>,
    pub format_iso: &'a dyn Fn(f64) -> String,
    pub minutes: bool,
    /// `opts.holidays`, which stands in for the schedule's own where given.
    pub holidays: Option<&'a [Option<f64>]>,
}

fn pad2(n: f64) -> String {
    let s = number_to_string(n);
    if s.len() < 2 { format!("0{s}") } else { s }
}

pub fn write_mspdi(out: &ScheduleOutput, opts: &MspdiOptions) -> String {
    let given: Vec<f64> = match opts.holidays {
        Some(h) => h.iter().flatten().copied().collect(),
        None => out.holidays.clone(),
    };
    let mut holidays: Vec<f64> = Vec::new();
    for h in given.into_iter().filter(|h| h.is_finite()).map(|h| (h + 1e-9).floor() + 0.0) {
        if !holidays.contains(&h) {
            holidays.push(h);
        }
    }
    holidays.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let h = opts.hours_per_day.unwrap_or(8.0);
    let iso = opts.format_iso;
    let stamp = |serial: f64, end: bool| -> String {
        let day = (serial + 1e-9).floor();
        let frac = serial - day;
        if opts.minutes && frac > 0.0 {
            let mins = math_round(frac * 1440.0);
            return format!("{}T{}:{}:00", iso(day), pad2((mins / 60.0).floor()), pad2(mins % 60.0));
        }
        let on_day = if opts.minutes && end && frac == 0.0 { day - 1.0 } else { day };
        format!("{}T{}", iso(on_day), if end { "17:00:00" } else { "08:00:00" })
    };
    let dur = |days: f64| format!("PT{}H0M0S", number_to_string(math_round(days * h)));
    let mut uid_of: HashMap<String, usize> = HashMap::new();
    for (i, t) in out.tasks.iter().enumerate() {
        uid_of.insert(js_lower(&t.name).into_owned(), i + 1);
    }
    let title = esc(opts.title.unwrap_or("Schedule"));
    let mut lines: Vec<String> = vec![
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#.into(),
        r#"<Project xmlns="http://schemas.microsoft.com/project">"#.into(),
        format!("  <Title>{title}</Title>"),
        format!("  <StartDate>{}</StartDate>", stamp(out.project_start, false)),
        format!("  <FinishDate>{}</FinishDate>", stamp(out.project_finish, true)),
        format!("  <MinutesPerDay>{}</MinutesPerDay>", number_to_string(h * 60.0)),
        format!("  <MinutesPerWeek>{}</MinutesPerWeek>", number_to_string(h * 60.0 * 5.0)),
        "  <CalendarUID>1</CalendarUID>".into(),
        "  <Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>".into(),
    ];
    for d in 1..=7 {
        let off = out.weekend.contains(&f64::from(d - 1));
        lines.push(format!("    <WeekDay><DayType>{d}</DayType><DayWorking>{}</DayWorking></WeekDay>", if off { 0 } else { 1 }));
    }
    lines.push("  </WeekDays>".into());
    if !holidays.is_empty() {
        lines.push("  <Exceptions>".into());
        for (i, d) in holidays.iter().enumerate() {
            let day = iso(*d);
            lines.push(format!(
                "    <Exception><Name>Holiday {}</Name><DayWorking>0</DayWorking><TimePeriod><FromDate>{day}T00:00:00</FromDate><ToDate>{day}T23:59:00</ToDate></TimePeriod></Exception>",
                i + 1
            ));
        }
        lines.push("  </Exceptions>".into());
    }
    lines.push("  </Calendar></Calendars>".into());
    lines.push("  <Tasks>".into());
    lines.push(format!("    <Task><UID>0</UID><ID>0</ID><Name>{title}</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>"));
    for (i, t) in out.tasks.iter().enumerate() {
        let uid = i + 1;
        let tenths = |days: f64| number_to_string(math_round(days * h * 60.0 * 10.0));
        let constraint = if t.alap { 1 } else if t.manual { 2 } else if t.start_floor.is_some() { 4 } else { 0 };
        let mut f: Vec<String> = vec![
            format!("<UID>{uid}</UID>"),
            format!("<ID>{uid}</ID>"),
            format!("<Name>{}</Name>", esc(&t.name)),
            format!("<OutlineLevel>{}</OutlineLevel>", number_to_string(t.level + 1.0)),
            format!("<OutlineNumber>{}</OutlineNumber>", t.wbs),
            format!("<Summary>{}</Summary>", u8::from(t.summary)),
            format!("<Milestone>{}</Milestone>", u8::from(t.milestone)),
            format!("<Duration>{}</Duration>", dur(t.duration)),
            "<DurationFormat>7</DurationFormat>".into(),
            format!("<Start>{}</Start>", stamp(t.start, false)),
            format!("<Finish>{}</Finish>", stamp(t.finish, true)),
            format!("<EarlyStart>{}</EarlyStart>", stamp(t.early_start, false)),
            format!("<EarlyFinish>{}</EarlyFinish>", stamp(t.early_finish, true)),
            format!("<LateStart>{}</LateStart>", stamp(t.late_start, false)),
            format!("<LateFinish>{}</LateFinish>", stamp(t.late_finish, true)),
            format!("<TotalSlack>{}</TotalSlack>", tenths(t.float)),
            format!("<FreeSlack>{}</FreeSlack>", tenths(t.free_float)),
            format!("<Critical>{}</Critical>", u8::from(t.critical)),
            format!("<PercentComplete>{}</PercentComplete>", number_to_string(math_round(t.complete))),
            format!("<ConstraintType>{constraint}</ConstraintType>"),
        ];
        if let (false, false, Some(floor)) = (t.alap, t.manual, t.start_floor) {
            f.push(format!("<ConstraintDate>{}</ConstraintDate>", stamp(floor, false)));
        }
        f.push(format!("<Manual>{}</Manual>", u8::from(t.manual)));
        if let Some(d) = t.deadline {
            f.push(format!("<Deadline>{}</Deadline>", stamp(d, true)));
        }
        for d in &t.predecessors {
            let Some(puid) = uid_of.get(js_lower(&d.task).as_ref()) else { continue };
            let elapsed = d.elapsed == Some(true);
            let lag_tenths = math_round(d.lag * if elapsed { 24.0 } else { h } * 60.0 * 10.0);
            f.push(format!(
                "<PredecessorLink><PredecessorUID>{puid}</PredecessorUID><Type>{}</Type><CrossProject>0</CrossProject><LinkLag>{}</LinkLag><LagFormat>{}</LagFormat></PredecessorLink>",
                link_code(d.ty),
                number_to_string(lag_tenths),
                if elapsed { 8 } else { 7 }
            ));
        }
        lines.push(format!("    <Task>{}</Task>", f.concat()));
    }
    lines.push("  </Tasks>".into());
    lines.push("</Project>".into());
    lines.push(String::new());
    lines.join("\n")
}
