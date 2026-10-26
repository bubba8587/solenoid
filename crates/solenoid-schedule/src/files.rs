// [[D68]] importUnsupportedIsNamed
//! What the plan-file readers share: the file a reader returns, how a file's
//! format is told, dates, unique names and the weekend codes.

use crate::calendar::CalendarSpec;
use crate::dates;
use crate::num::{is_js_space, js_lower, js_trim};
use crate::PlanTask;
use std::collections::HashSet;

/// A plan file read into the engine's model. Every field the reader saw but cannot model is named in
/// `unsupported`, so a divergence is visible.
#[derive(Clone, Debug, Default)]
pub struct PlanFile {
    pub title: String,
    pub start: Option<f64>,
    pub calendar: CalendarSpec,
    pub tasks: Vec<PlanTask>,
    pub unsupported: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanFormat {
    Mspdi,
    Xer,
    Gan,
}

fn skip_space(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

fn opens_project(s: &str) -> bool {
    skip_space(s).strip_prefix("<Project").and_then(|r| r.chars().next()).is_some_and(|c| c == '>' || is_js_space(c))
}

/// `(<!--…-->\s*)*<Project[\s>]`: one comment may as well run to the last `-->` before the element, since a comment's
/// body can hold anything.
fn comments_then_project(s: &str) -> bool {
    if opens_project(s) {
        return true;
    }
    let Some(body) = skip_space(s).strip_prefix("<!--") else { return false };
    body.match_indices("-->").any(|(k, _)| opens_project(&body[k + 3..]))
}

fn is_mspdi(text: &str) -> bool {
    let s = skip_space(text);
    if s.starts_with("<?xml") {
        if let Some(gt) = s.find('>') {
            if comments_then_project(&s[gt + 1..]) {
                return true;
            }
        }
    }
    comments_then_project(s)
}

fn is_xer(text: &str) -> bool {
    text.starts_with("ERMHDR\t")
        || text.split(['\n', '\r', '\u{2028}', '\u{2029}']).any(|l| l.starts_with("%T\tPROJECT"))
}

fn is_gan(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower
        .match_indices("<project")
        .find_map(|(k, _)| {
            lower[k + 8..].chars().next().filter(|c| *c == '>' || is_js_space(*c)).map(|c| k + 8 + c.len_utf8())
        })
        .is_some_and(|at| lower[at..].contains("<tasks"))
}

/// The format a file's text is in, by its content: Project XML, then Primavera XER, then GanttProject.
pub fn sniff(text: &str) -> Option<PlanFormat> {
    if is_mspdi(text) {
        Some(PlanFormat::Mspdi)
    } else if is_xer(text) {
        Some(PlanFormat::Xer)
    } else if is_gan(text) {
        Some(PlanFormat::Gan)
    } else {
        None
    }
}

/// The serial of the `YYYY-MM-DD` a timestamp starts with.
pub fn iso_to_serial(s: Option<&str>) -> Option<f64> {
    let b = js_trim(s.filter(|s| !s.is_empty())?).as_bytes();
    let digits = |r: std::ops::Range<usize>| {
        b.get(r.clone())
            .filter(|d| d.iter().all(u8::is_ascii_digit))
            .map(|d| d.iter().fold(0u32, |n, c| n * 10 + u32::from(c - b'0')))
    };
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
        return None;
    }
    Some(dates::serial(i64::from(digits(0..4)?), digits(5..7)?, digits(8..10)?))
}

/// A namer that gives a repeated task name a " (2)", " (3)" suffix, since the engine keys tasks by name.
#[derive(Default)]
pub struct UniqueNames(HashSet<String>);

impl UniqueNames {
    pub fn name(&mut self, n: &str) -> String {
        let mut k = n.to_string();
        let mut i = 2;
        while self.0.contains(js_lower(&k).as_ref()) {
            k = format!("{n} ({i})");
            i += 1;
        }
        self.0.insert(js_lower(&k).into_owned());
        k
    }
}

/// The `WORKDAY.INTL` code of a set of days off (0 is Sunday); `None` for a pattern no code expresses.
pub fn weekend_code(off: &[f64]) -> Option<f64> {
    let mut days: Vec<f64> = Vec::new();
    for d in off {
        if !days.contains(d) {
            days.push(*d);
        }
    }
    days.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Some(match days[..] {
        [] | [0.0, 6.0] => 1.0,
        [0.0, 1.0] => 2.0,
        [a, b] if b == a + 1.0 && (1.0..=5.0).contains(&a) && a.fract() == 0.0 => a + 2.0,
        [d] if (0.0..=6.0).contains(&d) && d.fract() == 0.0 => d + 11.0,
        _ => return None,
    })
}

/// The days off as the file's own list reads, for a message.
pub fn day_list(off: &[f64]) -> String {
    let mut days: Vec<f64> = Vec::new();
    for d in off {
        if !days.contains(d) {
            days.push(*d);
        }
    }
    days.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    days.iter().map(|d| crate::num::number_to_string(*d)).collect::<Vec<_>>().join(",")
}

/// A week with no day off counts every day: the engine has no weekend code for none, and holidays only apply to a
/// working-day calendar, so they are named as not carried over.
pub fn seven_day_week(cal: &mut CalendarSpec, unsupported: &mut Vec<String>) {
    if cal.working_days {
        return;
    }
    if cal.holidays.as_ref().is_some_and(|h| !h.is_empty()) {
        unsupported.push("holidays on a seven-day week".into());
    }
    cal.holidays = None;
}

/// The list without repeats, first mention first.
pub fn dedupe(list: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    list.into_iter().filter(|s| seen.insert(s.clone())).collect()
}
