// [[D68]] importUnsupportedIsNamed
//! GanttProject `.gan` read: the data sits in attributes, tasks nest by element,
//! and a link sits under its predecessor.

use crate::calendar::CalendarSpec;
use crate::files::{day_list, dedupe, iso_to_serial, seven_day_week, weekend_code, PlanFile, UniqueNames};
use crate::num::{js_trim, number_to_string, string_to_number};
use crate::xml::{self, XmlNode};
use crate::{Dependency, LinkType, PlanTask, ScheduleError};
use std::collections::HashMap;

fn link_type(code: &str) -> LinkType {
    match code {
        "1" => LinkType::SS,
        "3" => LinkType::FF,
        "4" => LinkType::SF,
        _ => LinkType::FS,
    }
}

/// `Number(attr ?? 0)`.
fn number(el: &XmlNode, name: &str) -> f64 {
    el.attr(name).map_or(0.0, string_to_number)
}

struct Link {
    from: String,
    to: String,
    ty: LinkType,
    lag: f64,
}

struct Reader {
    arena: Vec<(PlanTask, Vec<usize>)>,
    by_id: HashMap<String, usize>,
    links: Vec<Link>,
    names: UniqueNames,
    unsupported: Vec<String>,
}

impl Reader {
    fn task(&mut self, el: &XmlNode) -> usize {
        let id = el.attr("id").unwrap_or("").to_string();
        let given = el.attr("name").map_or_else(|| format!("Task {id}"), str::to_string);
        let name = self.names.name(js_trim(&given));
        let days = number(el, "duration");
        let complete = number(el, "complete");
        let mut t = PlanTask {
            name: name.clone(),
            duration: Some(if days.is_finite() { days } else { 0.0 }),
            complete: (complete > 0.0).then_some(complete),
            ..PlanTask::default()
        };
        if el.attr("meeting") == Some("true") {
            t.duration = Some(0.0);
        }
        let third = el.attr("thirdDate").filter(|d| !d.is_empty());
        if third.is_some() && el.attr("thirdDate-constraint") == Some("1") && iso_to_serial(el.attr("start")).is_some()
        {
            t.start = iso_to_serial(third);
        }
        let at = self.arena.len();
        self.arena.push((t, Vec::new()));
        self.by_id.insert(id.clone(), at);
        for d in el.children("depend") {
            let lag = number(d, "difference");
            self.links.push(Link {
                from: id.clone(),
                to: d.attr("id").unwrap_or("").to_string(),
                ty: link_type(d.attr("type").unwrap_or("2")),
                lag: if lag.is_nan() { 0.0 } else { lag },
            });
            if d.attr("hardness") == Some("Rubber") {
                self.unsupported.push(format!("a rubber link on \"{name}\""));
            }
        }
        let kids: Vec<usize> = el.children("task").map(|c| self.task(c)).collect();
        self.arena[at].1 = kids;
        at
    }

    fn build(&self, i: usize) -> PlanTask {
        let (t, kids) = &self.arena[i];
        let mut t = t.clone();
        if !kids.is_empty() {
            t.children = Some(kids.iter().map(|&k| self.build(k)).collect());
        }
        t
    }
}

fn calendar(root: &XmlNode, unsupported: &mut Vec<String>) -> CalendarSpec {
    let mut cal = CalendarSpec { working_days: true, weekend_code: Some(1.0), ..CalendarSpec::default() };
    let Some(cals) = root.child("calendars") else { return cal };
    if let Some(week) = cals.child("day-types").and_then(|d| d.child("default-week")) {
        let off: Vec<f64> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
            .iter()
            .enumerate()
            .filter(|(_, d)| week.attr(d) == Some("1"))
            .map(|(i, _)| i as f64)
            .collect();
        match weekend_code(&off) {
            Some(code) => cal.weekend_code = Some(code),
            None => unsupported.push(format!("weekend pattern [{}]", day_list(&off))),
        }
        if off.is_empty() {
            cal.working_days = false;
        }
    }
    let mut holidays: Vec<Option<f64>> = Vec::new();
    for d in cals.children("date").filter(|d| d.attr("type") == Some("HOLIDAY")) {
        let part = |name: &str| d.attr(name).map_or(f64::NAN, string_to_number);
        let (y, mo, da) = (part("year"), part("month"), part("date"));
        if [y, mo, da].iter().all(|v| *v != 0.0 && !v.is_nan()) {
            let pad = |v: f64| format!("{:0>2}", number_to_string(v));
            holidays.push(iso_to_serial(Some(&format!("{}-{}-{}", number_to_string(y), pad(mo), pad(da)))));
        } else {
            unsupported.push("a yearly recurring holiday (no year)".into());
        }
    }
    if !holidays.is_empty() {
        cal.holidays = Some(holidays);
    }
    seven_day_week(&mut cal, unsupported);
    cal
}

pub fn read_gan(text: &str) -> Result<PlanFile, ScheduleError> {
    let root = xml::parse(text)?;
    if root.name != "project" {
        return Err(ScheduleError::new("Not a GanttProject file: the root element is not <project>"));
    }
    let mut r = Reader {
        arena: Vec::new(),
        by_id: HashMap::new(),
        links: Vec::new(),
        names: UniqueNames::default(),
        unsupported: Vec::new(),
    };
    let tasks_el = root.child("tasks");
    let tops: Vec<usize> = tasks_el.into_iter().flat_map(|t| t.children("task")).map(|c| r.task(c)).collect();
    for l in std::mem::take(&mut r.links) {
        match (r.by_id.get(&l.to), r.by_id.get(&l.from)) {
            (Some(&to), Some(&from)) => {
                let task = r.arena[from].0.name.clone();
                r.arena[to].0.predecessors.push(Dependency { task, ty: l.ty, lag: l.lag, elapsed: None });
            }
            _ => r.unsupported.push(format!("a link to a missing task {}", l.to)),
        }
    }
    let calendar = calendar(&root, &mut r.unsupported);
    let start = iso_to_serial(tasks_el.and_then(|t| t.child("task")).and_then(|t| t.attr("start")));
    Ok(PlanFile {
        title: root.attr("name").unwrap_or("").to_string(),
        start,
        calendar,
        tasks: tops.iter().map(|&i| r.build(i)).collect(),
        unsupported: dedupe(r.unsupported),
    })
}
