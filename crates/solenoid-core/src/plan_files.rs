//! [[C69]] ganttPackages, [[D68]] importUnsupportedIsNamed. The plan-file readers (`solenoid_schedule`) in the JSON
//! the app's import reads: a file's tasks in `PlanTask`'s shape (`src/graph/planTypes.ts`), and a cell's
//! predecessor text.

use serde_json::{json, Map, Value as Json};
use solenoid_schedule::{
    parse_predecessor_text, read_gan, read_mspdi, read_xer, sniff, CalendarSpec, Dependency, PlanFile, PlanFormat,
    PlanTask, TaskCalendar,
};

/// A number as `JSON.stringify` writes it: no negative zero, and null for NaN and the infinities.
fn num(x: f64) -> Json {
    if x == 0.0 {
        json!(0)
    } else {
        serde_json::Number::from_f64(x).map_or(Json::Null, Json::Number)
    }
}

fn opt(m: &mut Map<String, Json>, key: &str, x: Option<f64>) {
    if let Some(x) = x {
        m.insert(key.into(), num(x));
    }
}

fn flag(m: &mut Map<String, Json>, key: &str, on: bool) {
    if on {
        m.insert(key.into(), json!(true));
    }
}

fn holidays(h: &[Option<f64>]) -> Json {
    Json::Array(h.iter().map(|x| x.map_or(Json::Null, num)).collect())
}

fn intervals(iv: &[(f64, f64)]) -> Json {
    Json::Array(iv.iter().map(|(a, b)| json!([num(*a), num(*b)])).collect())
}

fn calendar(c: &CalendarSpec) -> Json {
    let mut m = Map::new();
    m.insert("workingDays".into(), json!(c.working_days));
    opt(&mut m, "weekendCode", c.weekend_code);
    if let Some(h) = &c.holidays {
        m.insert("holidays".into(), holidays(h));
    }
    if c.minutes {
        m.insert("precision".into(), json!("minutes"));
    }
    if let Some(iv) = &c.intervals {
        m.insert("intervals".into(), intervals(iv));
    }
    Json::Object(m)
}

fn task_calendar(c: &TaskCalendar) -> Json {
    let mut m = Map::new();
    opt(&mut m, "weekendCode", c.weekend_code);
    if let Some(h) = &c.holidays {
        m.insert("holidays".into(), holidays(h));
    }
    if let Some(iv) = &c.intervals {
        m.insert("intervals".into(), intervals(iv));
    }
    Json::Object(m)
}

fn dependency(d: &Dependency) -> Json {
    let mut m = Map::new();
    m.insert("task".into(), json!(d.task));
    m.insert("type".into(), json!(d.ty.as_str()));
    m.insert("lag".into(), num(d.lag));
    if let Some(e) = d.elapsed {
        m.insert("elapsed".into(), json!(e));
    }
    Json::Object(m)
}

fn task(t: &PlanTask) -> Json {
    let mut m = Map::new();
    m.insert("name".into(), json!(t.name));
    opt(&mut m, "duration", t.duration);
    m.insert("predecessors".into(), Json::Array(t.predecessors.iter().map(dependency).collect()));
    opt(&mut m, "start", t.start);
    opt(&mut m, "finish", t.finish);
    opt(&mut m, "deadline", t.deadline);
    flag(&mut m, "manual", t.manual);
    opt(&mut m, "complete", t.complete);
    if let Some(g) = &t.group {
        m.insert("group".into(), json!(g));
    }
    flag(&mut m, "alap", t.alap);
    opt(&mut m, "actualStart", t.actual_start);
    flag(&mut m, "elapsed", t.elapsed);
    opt(&mut m, "work", t.work);
    opt(&mut m, "units", t.units);
    if let Some(c) = &t.calendar {
        m.insert("calendar".into(), task_calendar(c));
    }
    if let Some(kids) = &t.children {
        m.insert("children".into(), Json::Array(kids.iter().map(task).collect()));
    }
    opt(&mut m, "row", t.row);
    Json::Object(m)
}

fn plan(format: &str, f: &PlanFile) -> Map<String, Json> {
    let mut m = Map::new();
    m.insert("format".into(), json!(format));
    m.insert("title".into(), json!(f.title));
    m.insert("start".into(), f.start.map_or(Json::Null, num));
    m.insert("calendar".into(), calendar(&f.calendar));
    m.insert("tasks".into(), Json::Array(f.tasks.iter().map(task).collect()));
    m.insert("unsupported".into(), json!(f.unsupported));
    m
}

/// A plan file's tasks, calendar and what the reader could not carry over, in the format `format` names or, when it
/// names none, the one its content shows; null for text that is no plan file, `{ format, error }` for one that
/// cannot be read. An MSPDI file also carries `hoursPerDay` and its stored dates as `golden`.
pub fn read_plan_file(text: &str, format: Option<&str>) -> Json {
    let format = match format {
        Some("mspdi") => PlanFormat::Mspdi,
        Some("gan") => PlanFormat::Gan,
        Some("xer") => PlanFormat::Xer,
        _ => match sniff(text) {
            Some(f) => f,
            None => return Json::Null,
        },
    };
    let read = match format {
        PlanFormat::Mspdi => read_mspdi(text).map(|p| {
            let mut m = plan("mspdi", &p.file);
            m.insert("hoursPerDay".into(), num(p.hours_per_day));
            let golden = p.golden.iter().map(|g| {
                let n = |x: Option<f64>| x.map_or(Json::Null, num);
                json!({
                    "name": g.name, "start": n(g.start), "finish": n(g.finish), "earlyStart": n(g.early_start),
                    "earlyFinish": n(g.early_finish), "lateStart": n(g.late_start), "lateFinish": n(g.late_finish),
                    "totalSlack": n(g.total_slack), "freeSlack": n(g.free_slack), "critical": g.critical,
                })
            });
            m.insert("golden".into(), Json::Array(golden.collect()));
            m
        }),
        PlanFormat::Gan => read_gan(text).map(|f| plan("gan", &f)),
        PlanFormat::Xer => Ok(plan("xer", &read_xer(text))),
    };
    match read {
        Ok(m) => Json::Object(m),
        Err(e) => {
            let name = match format {
                PlanFormat::Mspdi => "mspdi",
                PlanFormat::Gan => "gan",
                PlanFormat::Xer => "xer",
            };
            json!({ "format": name, "error": e.message })
        }
    }
}

/// A cell's predecessor text (`3FS+2d, 5SS-1w`) as `{ deps, errors }`, row numbers resolved through `names`.
pub fn parse_predecessors(text: &str, names: &[String]) -> Json {
    let (deps, errors) = parse_predecessor_text(text, names);
    json!({ "deps": deps.iter().map(dependency).collect::<Vec<_>>(), "errors": errors })
}
