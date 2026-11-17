//! [[A1]] visualGraphCalculator. The Dispatch Queue card: a day-by-day service queue per crew, the sequential step of
//! a field-service simulation (`tree/specs/computation/frame-verbs.md` § Dispatch Queue). Each crew's open incidents
//! wait in a queue; each day the crew serves the best of them, highest priority first, then the longest waiting, then
//! the nearest to where it last was, and moves there. Everything else a simulation needs (the incidents, the totals,
//! the runs) is ordinary tables.

use super::frames::{frame_in, frame_v, num_column, str_input, trimmed};
use super::scalar::{read_role, Role};
use super::{err, Answer, Call, Column, Cv, Frame};
use crate::error_value::ErrorCode;
use crate::excel_functions::{value_text, V};
use crate::jsnum::{lower_text, trim_space};
use std::collections::HashMap;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    match kind {
        "DispatchNode" => Some(dispatch(c)),
        _ => None,
    }
}

/// The mean Earth radius, in km: the Earth & Sky pack's Great-Circle Distance uses the same sphere.
const EARTH_KM: f64 = 6371.0088;
const LAT_NAMES: [&str; 2] = ["lat", "latitude"];
const LON_NAMES: [&str; 4] = ["lon", "lng", "long", "longitude"];
/// A run longer than this many days is refused rather than left to spin.
const MAX_DAYS: f64 = 100_000.0;

pub(crate) fn great_circle_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = std::f64::consts::PI / 180.0;
    let s1 = libm::sin((lat2 - lat1) * r / 2.0);
    let s2 = libm::sin((lon2 - lon1) * r / 2.0);
    let a = s1 * s1 + libm::cos(lat1 * r) * libm::cos(lat2 * r) * s2 * s2;
    2.0 * EARTH_KM * libm::asin(libm::sqrt(a))
}

fn key(s: &str) -> String {
    lower_text(trim_space(s)).into_owned()
}

fn position(f: &Frame, name: &str) -> Option<usize> {
    let want = key(name);
    f.columns.iter().position(|c| key(&c.name) == want)
}

fn place_columns(f: &Frame, what: &str) -> Result<(usize, usize), V> {
    let find = |names: &[&str]| names.iter().find_map(|n| position(f, n));
    match (find(&LAT_NAMES), find(&LON_NAMES)) {
        (Some(a), Some(b)) => Ok((a, b)),
        _ => Err(err(ErrorCode::Ref, format!("The {what} have no Latitude and Longitude columns"))),
    }
}

fn number(v: Option<&V>) -> Option<f64> {
    match v {
        Some(V::Num(n) | V::Date(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn text(v: Option<&V>) -> Option<String> {
    match v {
        None | Some(V::Null | V::Undef) => None,
        Some(v) => Some(value_text(v)).filter(|t| !trim_space(t).is_empty()),
    }
}

struct Incident {
    row: usize,
    day: f64,
    priority: f64,
    service: f64,
    lat: f64,
    lon: f64,
}

struct Job {
    row: usize,
    served: f64,
    wait: f64,
    km: Option<f64>,
    drive: f64,
    start: f64,
    back: Option<f64>,
    crew: usize,
    order: usize,
}

/// Which open incident a crew takes next.
#[derive(Clone, Copy, PartialEq)]
enum Rule {
    /// Highest priority, then the longest waiting, then the nearest.
    Priority,
    /// The nearest, then the highest priority, then the longest waiting.
    Nearest,
    /// The longest waiting, then the highest priority, then the nearest.
    Oldest,
}

/// The best open incident for a crew at `at` by `rule`; the first row breaks a full tie, so the pick never depends on
/// the order the queue happens to hold them in.
fn best(open: &[Incident], at: Option<(f64, f64)>, rule: Rule) -> usize {
    let dist = |i: &Incident| at.map_or(0.0, |(la, lo)| great_circle_km(la, lo, i.lat, i.lon));
    let key = |i: &Incident| {
        let (p, w, d) = (-i.priority, i.day, dist(i));
        match rule {
            Rule::Priority => [p, w, d],
            Rule::Nearest => [d, p, w],
            Rule::Oldest => [w, p, d],
        }
    };
    let mut pick = 0;
    let mut pick_key = key(&open[0]);
    for (k, i) in open.iter().enumerate().skip(1) {
        let ki = key(i);
        let order = ki.iter().zip(pick_key.iter()).map(|(a, b)| a.total_cmp(b)).find(|o| o.is_ne());
        if order == Some(std::cmp::Ordering::Less) || (order.is_none() && i.row < open[pick].row) {
            pick = k;
            pick_key = ki;
        }
    }
    pick
}

fn taken(f: &Frame, rows: &[usize]) -> Vec<Column> {
    f.columns
        .iter()
        .map(|col| Column {
            name: col.name.clone(),
            ty: col.ty,
            values: rows.iter().map(|&r| col.values.get(r).cloned().unwrap_or(V::Null)).collect(),
            unit: col.unit.clone(),
            format: col.format.clone(),
            raw: None,
        })
        .collect()
}

/// A setting's number: blank is `None`, anything but a finite number at or above `min` is `#NUM!` naming it.
fn setting(c: &Call, key: &str, dflt: V, min: f64) -> Result<Option<f64>, V> {
    match read_role(c, key, &Role::Setting(dflt)) {
        V::Undef | V::Null => Ok(None),
        V::Num(n) if n.is_finite() && n >= min => Ok(Some(n)),
        v if v.is_sol_error() => Err(v),
        _ => Err(err(ErrorCode::Domain, format!("{} takes a number of {min} or more", c.label(key)))),
    }
}

const KM_PER_MILE: f64 = 1.609344;
const ADDED: [&str; 6] = ["Served", "Wait", "Km", "Drive Min", "Start Min", "Back Km"];

fn dispatch(c: &mut Call) -> Answer {
    let out = |c: &mut Call, jobs: Cv, open: Cv| {
        c.show("cachedResult", jobs.clone());
        c.show("cachedOpen", open.clone());
        Ok(vec![("jobs".into(), jobs), ("open".into(), open)])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), Cv::V(e));
    let Some(f) = frame_in(c, "incidents") else { return out(c, Cv::NULL, Cv::NULL) };
    let names = (|| -> Result<[String; 4], V> {
        Ok([
            trimmed(&str_input(c, "crew", "Operator"), "The crew column")?,
            trimmed(&str_input(c, "day", "Day"), "The day column")?,
            trimmed(&str_input(c, "priority", ""), "The priority column")?,
            trimmed(&str_input(c, "service", ""), "The service time column")?,
        ])
    })();
    let [crew_name, day_name, pri_name, svc_name] = match names {
        Ok(n) => n,
        Err(e) => return fail(c, e),
    };
    let rule = match c.field_str("mode", "priority") {
        "nearest" => Rule::Nearest,
        "oldest" => Rule::Oldest,
        _ => Rule::Priority,
    };
    let home_each_day = c.field_str("dayStart", "continue") == "start";
    let settings = (|| -> Result<_, V> {
        Ok((
            setting(c, "perDay", V::Undef, 1.0)?,
            setting(c, "hours", V::Undef, 0.0)?,
            setting(c, "days", V::Undef, 1.0)?,
            setting(c, "mph", V::Num(50.0), f64::MIN_POSITIVE)?.unwrap_or(50.0),
            setting(c, "road", V::Num(1.25), 1.0)?.unwrap_or(1.25),
        ))
    })();
    let (per_day, hours, horizon, mph, road) = match settings {
        Ok(s) => s,
        Err(e) => return fail(c, e),
    };
    // Neither a cap nor a working day set: one job a day.
    let cap = match (per_day, hours) {
        (Some(n), _) => Some(n.floor() as usize),
        (None, None) => Some(1),
        (None, Some(_)) => None,
    };
    let budget = hours.map(|h| h * 60.0);
    let col = |name: &str, what: &str| {
        position(&f, name).ok_or_else(|| err(ErrorCode::Ref, format!("The incidents have no {what} column \"{name}\"")))
    };
    let optional = |name: &str, what: &str| if name.is_empty() { Ok(None) } else { col(name, what).map(Some) };
    let cols = (|| -> Result<_, V> {
        Ok((
            col(&crew_name, "crew")?,
            col(&day_name, "day")?,
            optional(&pri_name, "priority")?,
            optional(&svc_name, "service time")?,
            place_columns(&f, "incidents")?,
        ))
    })();
    let (ci, di, pi, si, (lai, loi)) = match cols {
        Ok(c) => c,
        Err(e) => return fail(c, e),
    };

    // Every row needs a crew, a day and a place: a row without one would be dropped from the totals unseen.
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let mut crews: Vec<String> = Vec::new();
    let mut crew_at: HashMap<String, usize> = HashMap::new();
    let mut queues: Vec<Vec<Incident>> = Vec::new();
    for r in 0..rows {
        let at = |i: usize| f.columns[i].values.get(r);
        let missing = |what: &str| err(ErrorCode::Value, format!("Incident row {} has no {what}", r + 1));
        let Some(crew) = text(at(ci)) else { return fail(c, missing(&crew_name)) };
        let Some(day) = number(at(di)) else { return fail(c, missing(&day_name)) };
        let (Some(lat), Some(lon)) = (number(at(lai)), number(at(loi))) else { return fail(c, missing("place")) };
        let priority = pi.and_then(|i| number(at(i))).unwrap_or(0.0);
        let service = si.and_then(|i| number(at(i))).unwrap_or(0.0).max(0.0);
        let k = *crew_at.entry(crew.clone()).or_insert_with(|| {
            crews.push(crew);
            queues.push(Vec::new());
            crews.len() - 1
        });
        queues[k].push(Incident { row: r, day, priority, service, lat, lon });
    }

    // Where each crew starts: the Start frame's row for it, else at its first job (which then drives nothing).
    let mut start: Vec<Option<(f64, f64)>> = vec![None; crews.len()];
    if let Some(s) = frame_in(c, "start") {
        let found = (|| -> Result<(usize, (usize, usize)), V> {
            let sc = position(&s, &crew_name).ok_or_else(|| {
                err(ErrorCode::Ref, format!("The start positions have no crew column \"{crew_name}\""))
            })?;
            Ok((sc, place_columns(&s, "start positions")?))
        })();
        let (sc, (sla, slo)) = match found {
            Ok(x) => x,
            Err(e) => return fail(c, e),
        };
        for r in 0..s.columns.iter().map(|c| c.values.len()).max().unwrap_or(0) {
            let Some(crew) = text(s.columns[sc].values.get(r)) else { continue };
            let (Some(la), Some(lo)) = (number(s.columns[sla].values.get(r)), number(s.columns[slo].values.get(r)))
            else {
                continue;
            };
            if let Some(&k) = crew_at.get(&crew) {
                start[k].get_or_insert((la, lo));
            }
        }
    }

    let first_day = queues.iter().flatten().map(|i| i.day.floor()).fold(f64::INFINITY, f64::min);
    let last_day = match horizon {
        None => queues.iter().flatten().map(|i| i.day.floor()).fold(f64::NEG_INFINITY, f64::max),
        Some(n) => first_day + n.floor() - 1.0,
    };
    if last_day - first_day > MAX_DAYS {
        return fail(c, err(ErrorCode::Domain, format!("A run is at most {MAX_DAYS} days")));
    }
    let drive_min = |km: f64| km * road / KM_PER_MILE / mph * 60.0;

    let mut jobs: Vec<Job> = Vec::new();
    let mut served = vec![false; rows];
    for (k, queue) in queues.iter_mut().enumerate() {
        queue.sort_by(|a, b| a.day.total_cmp(&b.day).then(a.row.cmp(&b.row)));
        let mut pending = std::mem::take(queue).into_iter().peekable();
        let mut open: Vec<Incident> = Vec::new();
        let mut at = start[k];
        let mut order = 0;
        let mut d = first_day;
        while d <= last_day {
            while let Some(i) = pending.next_if(|i| i.day.floor() <= d) {
                open.push(i);
            }
            if home_each_day && start[k].is_some() {
                at = start[k];
            }
            let (mut used, mut n, first_today) = (0.0, 0usize, jobs.len());
            while !open.is_empty() && cap.is_none_or(|cap| n < cap) {
                let pick = best(&open, at, rule);
                let km = at.map(|(la, lo)| great_circle_km(la, lo, open[pick].lat, open[pick].lon));
                let drive = km.map_or(0.0, drive_min);
                // The day's first job always goes, so one longer than the day can't wait forever.
                if budget.is_some_and(|b| n > 0 && used + drive + open[pick].service > b) {
                    break;
                }
                let i = open.swap_remove(pick);
                jobs.push(Job {
                    row: i.row,
                    served: d,
                    wait: d - i.day.floor(),
                    km,
                    drive,
                    start: used + drive,
                    back: None,
                    crew: k,
                    order,
                });
                served[i.row] = true;
                used += drive + i.service;
                n += 1;
                order += 1;
                at = Some((i.lat, i.lon));
            }
            // Back to the start at the end of a day that had work, on the day's last job.
            if home_each_day
                && let (Some((sla, slo)), Some((la, lo)), true) = (start[k], at, jobs.len() > first_today)
                && let Some(last) = jobs.last_mut()
            {
                last.back = Some(great_circle_km(la, lo, sla, slo));
            }
            d += 1.0;
        }
    }
    jobs.sort_by(|a, b| a.served.total_cmp(&b.served).then(a.crew.cmp(&b.crew)).then(a.order.cmp(&b.order)));

    let base = Frame {
        columns: f.columns.iter().filter(|c| !ADDED.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let job_rows: Vec<usize> = jobs.iter().map(|j| j.row).collect();
    let mut job_cols = taken(&base, &job_rows);
    let numbers = |name: &str, f: &dyn Fn(&Job) -> Option<f64>| {
        num_column(name, jobs.iter().map(|j| f(j).map_or(V::Null, V::Num)).collect())
    };
    job_cols.push(numbers("Served", &|j| Some(j.served)));
    job_cols.push(numbers("Wait", &|j| Some(j.wait)));
    job_cols.push(numbers("Km", &|j| j.km));
    job_cols.push(numbers("Drive Min", &|j| Some(j.drive)));
    job_cols.push(numbers("Start Min", &|j| Some(j.start)));
    if home_each_day {
        job_cols.push(numbers("Back Km", &|j| j.back));
    }
    let open_rows: Vec<usize> = (0..rows).filter(|&r| !served[r]).collect();
    let open_cols = taken(&f, &open_rows);
    out(c, frame_v(job_cols), frame_v(open_cols))
}

#[cfg(test)]
mod tests {
    use super::great_circle_km;

    #[test]
    fn great_circle_matches_the_pack_card() {
        // Austin to Little Rock, as the Earth & Sky pack's Great-Circle Distance card answers it.
        let d = great_circle_km(30.2672, -97.7431, 34.7465, -92.2896);
        assert!((d - 713.6193970317898).abs() < 1e-9, "{d}");
        assert_eq!(great_circle_km(10.0, 20.0, 10.0, 20.0), 0.0);
    }
}
