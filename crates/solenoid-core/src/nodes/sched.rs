//! [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C71]] noBarEditing, [[C25]] firstClassUnits, [[C50]]
//! lambdaBindsByName. The plan cards on the scheduling engine (`crate::schedule`): `nodes/schedule.ts` with
//! `scheduleCpm.ts` (the tasks cube into the engine and the computed columns back), `nodes/gantt.ts` with
//! `ganttPayload.ts` and the view keys of `@solenoid/gantt-layout`'s `payload.ts`, and `nodes/earnedValue.ts` with
//! `earnedValueOps.ts`; beside them SCAN (`nodes/tableLambda.ts`) and ODE Integrate (`nodes/stats.ts`), the LAMBDA
//! hosts whose bodies run on the core.

use super::frames::{frame_v, json_num, tag_cell_unit, thrown};
use super::list::{js_number, nullish, slot, truthy};
use super::{list, Answer, Call, Column, Cube, CubeColumn, Frame};
use crate::date_serial::format_date_serial;
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::excel_functions::{js_string_of, V};
use crate::frame::FrameColType;
use crate::jsnum::{js_lower, js_trim, math_max, math_min, string_to_number};
use crate::schedule::{self as engine, CalendarSpec, Dependency, LinkType, PlanTask, ScheduleOutput, ScheduledTask, TaskCalendar};
use serde_json::{json, Map, Value as Json};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ScheduleNode" => schedule_card(c),
        "GanttNode" => gantt_card(c),
        "EarnedValueNode" => earned_value_card(c),
        "ScanLambdaNode" => scan_lambda(c),
        "OdeIntegrateNode" => ode_integrate(c),
        _ => return None,
    })
}

// ─── Reading cells as the plan readers do ───────────────────────────────────────────────────────────────────────────

fn value_err(msg: impl Into<String>) -> SolError {
    sol_error(ErrorCode::Value, msg)
}

fn norm(s: &str) -> String {
    js_lower(js_trim(s)).into_owned()
}

/// `String(v ?? "")`.
fn js_str(v: Option<&V>) -> String {
    match v {
        None | Some(V::Null | V::Undef) => String::new(),
        Some(v) => js_string_of(v),
    }
}

fn is_text(v: &V) -> bool {
    matches!(v, V::Str(_))
}

/// `typeof v === "number" && Number.isFinite(v)`.
fn num(v: Option<&V>) -> Option<f64> {
    match v {
        Some(V::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn is_table(v: &V) -> bool {
    matches!(v, V::Cube(_) | V::Frame(_))
}

/// `asCube`: a frame as its cube, each column's cells in its unit.
fn as_cube(v: &V) -> Option<Rc<Cube>> {
    match v {
        V::Cube(c) => Some(c.clone()),
        V::Frame(f) => Some(Rc::new(super::frames::frame_to_cube(f))),
        _ => None,
    }
}

fn rows_of(c: &Cube) -> usize {
    c.columns.iter().map(|col| col.cells.len()).max().unwrap_or(0)
}

fn cell(col: Option<&CubeColumn>, i: usize) -> Option<&V> {
    col.and_then(|c| c.cells.get(i)).filter(|v| !matches!(v, V::Undef))
}

/// `findColumn`: the first name that matches, else the first column `pick` takes.
/// A fallback that takes a column by its place and cells.
type Pick<'a> = Option<&'a dyn Fn(usize, &CubeColumn) -> bool>;

fn find_column(c: &Cube, names: &[&str], pick: Pick) -> Option<usize> {
    for n in names {
        if let Some(i) = c.columns.iter().position(|col| norm(&col.name) == *n) {
            return Some(i);
        }
    }
    pick.and_then(|p| c.columns.iter().enumerate().position(|(i, col)| p(i, col)))
}

fn has_text(col: &CubeColumn) -> bool {
    col.cells.iter().any(is_text)
}

/// `readLogicalCell`.
fn read_logical(v: Option<&V>) -> bool {
    match v {
        Some(V::Bool(b)) => *b,
        Some(V::Num(n)) if n.is_finite() => *n != 0.0,
        Some(V::Str(s)) => ["true", "yes", "y", "1", "on"].contains(&norm(s).as_str()),
        _ => false,
    }
}

/// `isInactive`: an Active cell that is set and false.
fn is_inactive(v: Option<&V>) -> bool {
    match v {
        None | Some(V::Null) => false,
        Some(V::Str(s)) if js_trim(s).is_empty() => false,
        v => !read_logical(v),
    }
}

/// `Number(v)` as JS reads it, a cell of any kind.
fn to_number(v: &V) -> f64 {
    js_number(v)
}

/// A lag cell: blank is 0, a number itself, anything else `Number(cell)`.
fn lag_of(v: Option<&V>) -> f64 {
    match v {
        None | Some(V::Null) => 0.0,
        Some(V::Str(s)) if s.is_empty() => 0.0,
        Some(V::Num(n)) if n.is_finite() => *n,
        Some(v) => to_number(v),
    }
}

fn link_type(raw: Option<&V>) -> String {
    let s = match raw {
        None | Some(V::Null) => "FS".to_string(),
        Some(v) => js_string_of(v),
    };
    js_trim(&s).to_uppercase()
}

// ─── scheduleCpm.ts ─────────────────────────────────────────────────────────────────────────────────────────────────

const TASK_NAMES: &[&str] = &["task", "name", "title"];
const DURATION_NAMES: &[&str] = &["duration", "days"];
const PRED_NAMES: &[&str] = &["predecessors", "predecessor", "after", "depends on", "blockedby", "blocked by"];
const CHILD_NAMES: &[&str] = &["tasks", "children", "subtasks", "steps"];
const START_NAMES: &[&str] = &["start"];
const FINISH_NAMES: &[&str] = &["finish", "end"];
const DEADLINE_NAMES: &[&str] = &["deadline", "due"];
const MANUAL_NAMES: &[&str] = &["manual", "pinned"];
const COMPLETE_NAMES: &[&str] = &["complete", "% complete", "percent complete", "done", "progress"];
const GROUP_NAMES: &[&str] = &["project", "section", "group"];
const ALAP_NAMES: &[&str] = &["alap", "as late as possible", "late as possible"];
const ACTUAL_NAMES: &[&str] = &["actual start", "started", "started on"];
const ELAPSED_NAMES: &[&str] = &["elapsed"];
const TASK_WEEKEND_NAMES: &[&str] = &["weekend", "weekend code"];
const TASK_HOURS_NAMES: &[&str] = &["hours", "hours per day"];
const TASK_HOLIDAY_NAMES: &[&str] = &["holidays", "days off"];
const WORK_NAMES: &[&str] = &["work", "effort", "work (h)", "hours of work"];
const UNITS_NAMES: &[&str] = &["units", "assignment", "fte"];
const ACTIVE_NAMES: &[&str] = &["active", "included"];
const REPEAT_NAMES: &[&str] = &["repeat", "occurrences", "times"];
const EVERY_NAMES: &[&str] = &["every", "every (days)", "interval", "period"];
const KNOWN_NAMES: &[&[&str]] = &[
    TASK_NAMES, PRED_NAMES, CHILD_NAMES, START_NAMES, FINISH_NAMES, DEADLINE_NAMES, MANUAL_NAMES, COMPLETE_NAMES, GROUP_NAMES, ALAP_NAMES,
    ACTUAL_NAMES, ELAPSED_NAMES, TASK_WEEKEND_NAMES, TASK_HOURS_NAMES, TASK_HOLIDAY_NAMES, WORK_NAMES, UNITS_NAMES, ACTIVE_NAMES, REPEAT_NAMES,
    EVERY_NAMES,
];
const LINK_SUCC_NAMES: &[&str] = &["successor", "task", "to"];
const LINK_PRED_NAMES: &[&str] = &["predecessor", "predecessors", "from", "after", "depends on"];
const TYPE_NAMES: &[&str] = &["type", "link", "kind"];
const LAG_NAMES: &[&str] = &["lag", "lead", "offset"];

/// What a reader throws: the card's error, or a JS exception the card's error guard shows.
enum Fail {
    Sol(SolError),
    Js(V),
}

impl From<SolError> for Fail {
    fn from(e: SolError) -> Fail {
        Fail::Sol(e)
    }
}

type Rd<T> = Result<T, Fail>;

/// The project's hours a day as the TS carries it: the number, and whether it came as a number at all (a value of
/// another kind compares unequal to every task's own Hours).
#[derive(Clone, Copy)]
struct Hours {
    n: f64,
    is_num: bool,
}

/// `readPredecessors`.
fn read_predecessors(v: Option<&V>, task_name: &str) -> Rd<Vec<Dependency>> {
    let Some(v) = v.filter(|v| !nullish(v)) else { return Ok(Vec::new()) };
    match v {
        V::List(items) => Ok(items
            .iter()
            .map(|x| if nullish(x) { String::new() } else { js_trim(&js_string_of(x)).to_string() })
            .filter(|s| !s.is_empty())
            .map(|t| Dependency::fs(&t))
            .collect()),
        V::Str(s) => {
            let t = js_trim(s);
            Ok(if t.is_empty() { Vec::new() } else { vec![Dependency::fs(t)] })
        }
        V::Cube(_) | V::Frame(_) => {
            let t = as_cube(v).expect("a table");
            let mut names = vec!["predecessor"];
            names.extend_from_slice(TASK_NAMES);
            let name_col = find_column(&t, &names, Some(&|_, col: &CubeColumn| has_text(col)));
            let type_col = find_column(&t, TYPE_NAMES, None).map(|i| &t.columns[i]);
            let lag_col = find_column(&t, LAG_NAMES, None).map(|i| &t.columns[i]);
            let Some(name_col) = name_col.map(|i| &t.columns[i]) else {
                return Err(value_err(format!("Schedule: task \"{task_name}\" has a Predecessors table with no Predecessor or Task column")).into());
            };
            let mut out = Vec::new();
            for i in 0..rows_of(&t) {
                let task = js_trim(&js_str(cell(Some(name_col), i))).to_string();
                if task.is_empty() {
                    continue;
                }
                let raw = link_type(cell(type_col, i));
                let Some(ty) = LinkType::parse(&raw) else {
                    return Err(value_err(format!("Schedule: task \"{task_name}\" waits on \"{task}\" with link type \"{raw}\"; use FS, SS, FF or SF")).into());
                };
                let lag = lag_of(cell(lag_col, i));
                if !lag.is_finite() {
                    return Err(value_err(format!("Schedule: task \"{task_name}\" waits on \"{task}\" with a lag that is not a number")).into());
                }
                let elapsed_col = find_column(&t, ELAPSED_NAMES, None).map(|k| &t.columns[k]);
                let elapsed = elapsed_col.is_some() && read_logical(cell(elapsed_col, i));
                out.push(Dependency { task, ty, lag, elapsed: elapsed.then_some(true) });
            }
            Ok(out)
        }
        _ => Ok(Vec::new()),
    }
}

/// `readDuration`.
fn read_duration(v: Option<&V>, hours_per_day: f64, name: &str) -> Rd<f64> {
    let v = match v {
        None | Some(V::Null) => return Ok(0.0),
        Some(V::Str(s)) if s.is_empty() => return Ok(0.0),
        Some(v) => v,
    };
    if let V::Unit(u) = v {
        if u.dim.len() == 1 && u.dim.get("time") == Some(&1.0) {
            return Ok(u.value / 3600.0 / hours_per_day);
        }
        return Err(value_err(format!("Schedule: task \"{name}\" has a Duration that is not a time")).into());
    }
    let d = match v {
        V::Num(n) if n.is_finite() => *n,
        V::Str(s) => string_to_number(s),
        _ => f64::NAN,
    };
    if !d.is_finite() || d < 0.0 {
        return Err(value_err(format!("Schedule: task \"{name}\" needs a duration of 0 or more days")).into());
    }
    Ok(d)
}

/// `parseDate` on a cell's text: a serial, NaN, or the error it reads as.
fn parse_date_text(s: &str) -> Rd<f64> {
    use crate::excel_criteria::{parse_date, DateReading};
    match parse_date(s) {
        DateReading::Serial(d) => Ok(d),
        DateReading::NotADate => Ok(f64::NAN),
        DateReading::Ambiguous(e) => Err(Fail::Sol(e)),
    }
}

/// `readDate`.
fn read_date(v: Option<&V>, task: &str, column: &str) -> Rd<Option<f64>> {
    match v {
        None | Some(V::Null) => Ok(None),
        Some(V::Str(s)) if s.is_empty() => Ok(None),
        Some(V::Num(n)) if n.is_finite() => Ok(Some(*n)),
        Some(V::Str(s)) => match parse_date_text(s) {
            Err(Fail::Sol(e)) => Err(sol_error(e.code, format!("Schedule: task \"{task}\" has a {column} that reads two ways: {s}")).into()),
            Err(js) => Err(js),
            Ok(d) if !d.is_finite() => Err(value_err(format!("Schedule: task \"{task}\" has a {column} that is not a date: {s}")).into()),
            Ok(d) => Ok(Some(d)),
        },
        _ => Ok(None),
    }
}

/// `checkActiveCell`: an error or a cell that reads as neither true nor false is the row's fault.
fn check_active(v: Option<&V>, task: &str) -> Rd<()> {
    match v {
        None | Some(V::Null | V::Bool(_)) => Ok(()),
        Some(V::Num(n)) if n.is_finite() => Ok(()),
        Some(V::Err(e)) => Err(sol_error(e.code, format!("Schedule: task \"{task}\" has an Active that is an error")).into()),
        Some(V::Str(s)) if js_trim(s).is_empty() || ["true", "yes", "y", "1", "on", "false", "no", "n", "0", "off"].contains(&norm(s).as_str()) => Ok(()),
        _ => Err(value_err(format!("Schedule: task \"{task}\" has an Active that is neither true nor false")).into()),
    }
}

/// The columns a level reads, by index.
struct Cols {
    duration: Option<usize>,
    pred: Option<usize>,
    children: Option<usize>,
    start: Option<usize>,
    finish: Option<usize>,
    deadline: Option<usize>,
    manual: Option<usize>,
    complete: Option<usize>,
    group: Option<usize>,
    alap: Option<usize>,
    actual: Option<usize>,
    elapsed: Option<usize>,
    weekend: Option<usize>,
    hours: Option<usize>,
    holidays: Option<usize>,
    work: Option<usize>,
    units: Option<usize>,
    active: Option<usize>,
    repeat: Option<usize>,
    every: Option<usize>,
}

/// One level of the plan as read: its cube, its columns, and per row the child level, the name and whether it is left
/// out.
struct Level {
    cube: Rc<Cube>,
    cols: Cols,
    child_levels: Vec<Option<Level>>,
    names: Vec<String>,
    inactive: Vec<bool>,
}

fn holds_plan(v: &V) -> bool {
    is_table(v) && as_cube(v).is_some_and(|c| find_column(&c, TASK_NAMES, Some(&|_, col: &CubeColumn| has_text(col))).is_some())
}

/// `predecessorCell`.
fn predecessor_cell(deps: &[Dependency], typed: bool) -> V {
    if !typed {
        return list(deps.iter().map(|d| V::str(&d.task)).collect());
    }
    let mut cols = vec![
        CubeColumn { name: "Predecessor".into(), cells: deps.iter().map(|d| V::str(&d.task)).collect(), ty: Some(FrameColType::String), format: None },
        CubeColumn { name: "Type".into(), cells: deps.iter().map(|d| V::str(d.ty.as_str())).collect(), ty: Some(FrameColType::String), format: None },
        CubeColumn { name: "Lag".into(), cells: deps.iter().map(|d| V::Num(d.lag)).collect(), ty: Some(FrameColType::Number), format: None },
    ];
    if deps.iter().any(|d| d.elapsed == Some(true)) {
        cols.push(CubeColumn { name: "Elapsed".into(), cells: deps.iter().map(|d| V::Bool(d.elapsed == Some(true))).collect(), ty: Some(FrameColType::Logical), format: None });
    }
    super::frames::cube_from_columns(cols)
}

fn plain_link(d: &Dependency) -> bool {
    d.ty == LinkType::FS && d.lag == 0.0 && d.elapsed != Some(true)
}

/// `predecessorColumn`: name lists while every link is plain, else a table in every row.
fn predecessor_column(rows: &[Option<&[Dependency]>]) -> Vec<V> {
    let typed = rows.iter().flatten().any(|deps| !deps.iter().all(plain_link));
    rows.iter().map(|deps| deps.map_or(V::Null, |d| predecessor_cell(d, typed))).collect()
}

fn col_of(name: &str, cells: Vec<V>, ty: Option<FrameColType>) -> CubeColumn {
    CubeColumn { name: name.into(), cells, ty, format: None }
}

/// `readLevel`.
fn read_level(c: Rc<Cube>, hours: Hours) -> Rd<(Level, Vec<PlanTask>)> {
    let find = |names: &[&str]| find_column(&c, names, None);
    let Some(task) = find_column(&c, TASK_NAMES, Some(&|_, col: &CubeColumn| has_text(col))) else {
        return Err(value_err("Schedule needs a Task column (text) naming each task").into());
    };
    let pred = find(PRED_NAMES);
    let children = find_column(&c, CHILD_NAMES, Some(&|i, col: &CubeColumn| Some(i) != pred && col.cells.iter().any(holds_plan)));
    let work = find(WORK_NAMES);
    let fallback = |i: usize, col: &CubeColumn| {
        i != task
            && Some(i) != children
            && col.ty != Some(FrameColType::Date)
            && !KNOWN_NAMES.iter().any(|ns| ns.contains(&norm(&col.name).as_str()))
            && col.cells.iter().any(|v| num(Some(v)).is_some() || matches!(v, V::Unit(_)))
    };
    let duration = if work.is_some() { find(DURATION_NAMES) } else { find_column(&c, DURATION_NAMES, Some(&fallback)) };
    if duration.is_none() && children.is_none() && work.is_none() {
        return Err(value_err("Schedule needs a Duration column (number of days) or a Work column (hours)").into());
    }
    let cols = Cols {
        duration,
        pred,
        children,
        start: find(START_NAMES),
        finish: find(FINISH_NAMES),
        deadline: find(DEADLINE_NAMES),
        manual: find(MANUAL_NAMES),
        complete: find(COMPLETE_NAMES),
        group: find(GROUP_NAMES),
        alap: find(ALAP_NAMES),
        actual: find(ACTUAL_NAMES),
        elapsed: find(ELAPSED_NAMES),
        weekend: find(TASK_WEEKEND_NAMES),
        hours: find(TASK_HOURS_NAMES),
        holidays: find(TASK_HOLIDAY_NAMES),
        work,
        units: find(UNITS_NAMES),
        active: find(ACTIVE_NAMES),
        repeat: find(REPEAT_NAMES),
        every: find(EVERY_NAMES),
    };
    let col = |i: Option<usize>| i.map(|i| &c.columns[i]);
    let at = |i: Option<usize>, r: usize| cell(col(i), r);
    let mut tasks = Vec::new();
    let mut child_levels: Vec<Option<Level>> = Vec::new();
    let mut names = Vec::new();
    let mut inactive = Vec::new();
    for i in 0..rows_of(&c) {
        let name = js_trim(&js_str(at(Some(task), i))).to_string();
        if name.is_empty() {
            return Err(value_err(format!("Schedule: row {} has no task name", i + 1)).into());
        }
        names.push(name.clone());
        check_active(at(cols.active, i), &name)?;
        let off = is_inactive(at(cols.active, i));
        inactive.push(off);
        if off {
            child_levels.push(None);
            continue;
        }
        let mut kids: Option<Vec<PlanTask>> = None;
        let mut child_level = None;
        if let Some(kid) = at(children, i).filter(|v| is_table(v)) {
            let (level, sub) = read_level(as_cube(kid).expect("a table"), hours)?;
            kids = Some(sub);
            child_level = Some(level);
        }
        let repeat = if cols.repeat.is_some() { num(at(cols.repeat, i)).map_or(0.0, f64::floor) } else { 0.0 };
        let every = num(at(cols.every, i)).unwrap_or(7.0);
        let task_hours = num(at(cols.hours, i)).filter(|h| *h > 0.0).unwrap_or(hours.n);
        let mut generated = false;
        if kids.is_none() && repeat > 1.0 {
            if repeat > 4_294_967_295.0 {
                return Err(Fail::Js(thrown("Invalid array length")));
            }
            generated = true;
            let base = read_date(at(cols.start, i), &name, "Start")?;
            let dur = read_duration(at(duration, i), task_hours, &name)?;
            let preds = match pred {
                Some(_) => read_predecessors(at(pred, i), &name)?,
                None => Vec::new(),
            };
            let n = repeat as usize;
            let occ: Vec<String> = (1..=n).map(|k| format!("{name} {k}")).collect();
            let pred_cells: Vec<V> = (0..n)
                .map(|k| {
                    if k == 0 {
                        predecessor_cell(&preds, !preds.iter().all(plain_link))
                    } else {
                        super::frames::cube_from_columns(vec![
                            col_of("Predecessor", vec![V::str(&occ[k - 1])], Some(FrameColType::String)),
                            col_of("Type", vec![V::str("SS")], Some(FrameColType::String)),
                            col_of("Lag", vec![V::Num(every)], Some(FrameColType::Number)),
                            col_of("Elapsed", vec![V::Bool(true)], Some(FrameColType::Logical)),
                        ])
                    }
                })
                .collect();
            let mut gen = vec![
                col_of("Task", occ.iter().map(|s| V::str(s)).collect(), Some(FrameColType::String)),
                col_of("Duration", vec![V::Num(dur); n], Some(FrameColType::Number)),
                col_of("Predecessors", pred_cells, None),
            ];
            if let Some(b) = base {
                gen.push(col_of("Start", (0..n).map(|k| V::Num(b + k as f64 * every)).collect(), Some(FrameColType::Date)));
            }
            let V::Cube(gen) = super::frames::cube_from_columns(gen) else { unreachable!("cube_from_columns makes a cube") };
            let (level, sub) = read_level(gen, hours)?;
            kids = Some(sub);
            child_level = Some(level);
        }
        child_levels.push(child_level);
        let work_cell = num(at(cols.work, i));
        let units_cell = num(at(cols.units, i));
        let has_duration = !matches!(at(duration, i), None | Some(V::Null)) && !matches!(at(duration, i), Some(V::Str(s)) if s.is_empty());
        let task_duration = if kids.is_some() {
            0.0
        } else if has_duration || work_cell.is_none() {
            read_duration(at(duration, i), task_hours, &name)?
        } else {
            work_cell.unwrap_or(0.0) / (math_max(0.01, units_cell.unwrap_or(1.0)) * task_hours)
        };
        let predecessors = if generated {
            Vec::new()
        } else if pred.is_some() {
            read_predecessors(at(pred, i), &name)?
        } else {
            Vec::new()
        };
        let start = read_date(at(cols.start, i), &name, "Start")?;
        let finish = read_date(at(cols.finish, i), &name, "Finish")?;
        let deadline = read_date(at(cols.deadline, i), &name, "Deadline")?;
        let group = at(cols.group, i).filter(|g| !nullish(g)).map(|g| js_trim(&js_string_of(g)).to_string()).filter(|g| !g.is_empty());
        let actual_start = read_date(at(cols.actual, i), &name, "Actual start")?;
        tasks.push(PlanTask {
            name: name.clone(),
            duration: Some(task_duration),
            work: work_cell,
            units: units_cell,
            predecessors,
            start,
            finish,
            deadline,
            manual: cols.manual.is_some() && read_logical(at(cols.manual, i)),
            complete: Some(if cols.complete.is_some() { num(at(cols.complete, i)).unwrap_or(0.0) } else { 0.0 }),
            group,
            alap: cols.alap.is_some() && read_logical(at(cols.alap, i)),
            actual_start,
            elapsed: cols.elapsed.is_some() && read_logical(at(cols.elapsed, i)),
            calendar: task_calendar(&cols, &c, i, hours),
            children: kids,
            row: Some((i + 1) as f64),
        });
    }
    Ok((Level { cube: c.clone(), cols, child_levels, names, inactive }, tasks))
}

/// `taskCalendar`: the row's own Weekend, Hours and Holidays, or nothing.
fn task_calendar(cols: &Cols, c: &Cube, i: usize, hours: Hours) -> Option<TaskCalendar> {
    let at = |k: Option<usize>| cell(k.map(|k| &c.columns[k]), i);
    let mut spec = TaskCalendar::default();
    if let Some(w) = num(at(cols.weekend)) {
        spec.weekend_code = Some(w);
    }
    if let Some(h) = num(at(cols.hours)).filter(|h| *h > 0.0 && (!hours.is_num || *h != hours.n)) {
        spec.intervals = Some(engine::intervals_for_hours(h));
    }
    if let Some(V::List(hol)) = at(cols.holidays) {
        spec.holidays = Some(hol.iter().filter_map(|x| num(Some(x))).map(Some).collect());
    }
    (spec != TaskCalendar::default()).then_some(spec)
}

fn inactive_names(level: &Level, out: &mut HashSet<String>) {
    for (n, off) in level.names.iter().zip(&level.inactive) {
        if *off {
            out.insert(norm(n));
        }
    }
    for child in level.child_levels.iter().flatten() {
        inactive_names(child, out);
    }
}

/// `applyLinksFrame`: the flat Links frame's rows added to each successor's predecessors.
fn apply_links_frame(tasks: &mut [PlanTask], links: &Frame, inactive: &HashSet<String>) -> Rd<()> {
    let find = |names: &[&str]| links.columns.iter().position(|c| names.contains(&norm(&c.name).as_str()));
    let (Some(succ_col), Some(pred_col)) = (find(LINK_SUCC_NAMES), find(LINK_PRED_NAMES)) else {
        return Err(value_err("Schedule: the Links frame needs a Successor (or Task, To) column and a Predecessor (or From) column").into());
    };
    let (type_col, lag_col) = (find(TYPE_NAMES), find(LAG_NAMES));
    fn collect(ts: &[PlanTask], path: &mut Vec<usize>, out: &mut HashMap<String, Vec<usize>>) {
        for (i, t) in ts.iter().enumerate() {
            path.push(i);
            out.insert(norm(&t.name), path.clone());
            if let Some(kids) = &t.children {
                collect(kids, path, out);
            }
            path.pop();
        }
    }
    let mut by_name = HashMap::new();
    collect(tasks, &mut Vec::new(), &mut by_name);
    let value = |col: Option<usize>, i: usize| col.and_then(|k| links.columns[k].values.get(i)).filter(|v| !matches!(v, V::Undef));
    let rows = links.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    for i in 0..rows {
        let succ = js_trim(&js_str(value(Some(succ_col), i))).to_string();
        let pred = js_trim(&js_str(value(Some(pred_col), i))).to_string();
        if succ.is_empty() || pred.is_empty() {
            continue;
        }
        let key = js_lower(&succ).into_owned();
        let Some(path) = by_name.get(&key) else {
            if inactive.contains(&key) {
                continue;
            }
            return Err(value_err(format!("Schedule: the Links frame names task \"{succ}\", which isn't in the plan")).into());
        };
        let raw = link_type(value(type_col, i));
        let Some(ty) = LinkType::parse(&raw) else {
            return Err(value_err(format!("Schedule: the Links frame links \"{succ}\" with type \"{raw}\"; use FS, SS, FF or SF")).into());
        };
        let lag = lag_of(value(lag_col, i));
        if !lag.is_finite() {
            return Err(value_err(format!("Schedule: the Links frame links \"{succ}\" with a lag that is not a number")).into());
        }
        let mut list: &mut [PlanTask] = tasks;
        let (last, head) = path.split_last().expect("a path names a task");
        for &k in head {
            list = list[k].children.as_deref_mut().expect("a parent on the path");
        }
        list[*last].predecessors.push(Dependency { task: pred, ty, lag, elapsed: None });
    }
    Ok(())
}

const DATETIME_FORMAT: &str = "DD-MMM-YYYY HH:mm";

/// `writeLevel`: the level's cube with its computed columns.
fn write_level(level: &Level, by_name: &HashMap<String, &ScheduledTask>, nested: bool, minutes: bool, merged: bool) -> V {
    let rows: Vec<Option<&ScheduledTask>> = level.names.iter().zip(&level.inactive).map(|(n, off)| if *off { None } else { by_name.get(&js_lower(n).into_owned()).copied() }).collect();
    let cells = |f: &dyn Fn(&ScheduledTask) -> V| -> Vec<V> { rows.iter().map(|t| t.map_or(V::Null, f)).collect() };
    let date_format = minutes.then(|| json!({ "format": "date_custom", "customPattern": DATETIME_FORMAT, "unit": "none" }));
    let dated = |name: &str, cells: Vec<V>| CubeColumn { name: name.into(), cells, ty: Some(FrameColType::Date), format: date_format.clone() };
    let typed = |name: &str, ty: FrameColType, cells: Vec<V>| col_of(name, cells, Some(ty));
    let opt_str = |s: &Option<String>| s.as_deref().map_or(V::Null, V::str);
    let mut appended: Vec<CubeColumn> = vec![
        dated("Start", cells(&|t| V::Num(t.start))),
        dated("Finish", cells(&|t| V::Num(t.finish))),
        typed("Float", FrameColType::Number, cells(&|t| V::Num(t.float))),
        typed("Critical", FrameColType::Logical, cells(&|t| V::Bool(t.critical))),
        typed("Free Float", FrameColType::Number, cells(&|t| V::Num(t.free_float))),
        dated("Early Start", cells(&|t| V::Num(t.early_start))),
        dated("Early Finish", cells(&|t| V::Num(t.early_finish))),
        dated("Late Start", cells(&|t| V::Num(t.late_start))),
        dated("Late Finish", cells(&|t| V::Num(t.late_finish))),
        typed("Driving", FrameColType::String, cells(&|t| opt_str(&t.driving))),
        typed("Late", FrameColType::Logical, cells(&|t| V::Bool(t.late))),
    ];
    if rows.iter().flatten().any(|t| t.segments.is_some()) {
        appended.push(col_of(
            "Segments",
            cells(&|t| match &t.segments {
                Some(s) => super::frames::cube_from_columns(vec![dated("Start", s.iter().map(|x| V::Num(x.0)).collect()), dated("Finish", s.iter().map(|x| V::Num(x.1)).collect())]),
                None => V::Null,
            }),
            None,
        ));
    }
    if nested {
        appended.push(typed("WBS", FrameColType::String, cells(&|t| V::str(&t.wbs))));
        appended.push(typed("Level", FrameColType::Number, cells(&|t| V::Num(t.level))));
        appended.push(typed("Summary", FrameColType::Logical, cells(&|t| V::Bool(t.summary))));
    }
    let preds: Vec<Option<&[Dependency]>> = rows.iter().map(|t| t.map(|t| t.predecessors.as_slice())).collect();
    if merged && level.cols.pred.is_none() && rows.iter().flatten().any(|t| !t.predecessors.is_empty()) {
        appended.insert(0, col_of("Predecessors", predecessor_column(&preds), None));
    }
    if level.cols.duration.is_none() && rows.iter().flatten().any(|t| t.summary) {
        appended.insert(0, typed("Duration", FrameColType::Number, cells(&|t| V::Num(t.duration))));
    }
    let child = |l: &Level| write_level(l, by_name, nested, minutes, merged);
    if level.cols.children.is_none() && level.child_levels.iter().any(Option::is_some) {
        appended.insert(0, col_of("Tasks", level.child_levels.iter().map(|l| l.as_ref().map_or(V::Null, child)).collect(), None));
    }
    let taken: HashSet<&str> = appended.iter().map(|c| c.name.as_str()).collect();
    let mut rebuilt: Vec<CubeColumn> = Vec::new();
    for (k, col) in level.cube.columns.iter().enumerate() {
        let is = |i: Option<usize>| i == Some(k);
        if is(level.cols.start) || is(level.cols.finish) || taken.contains(col.name.as_str()) {
            continue;
        }
        let cells: Vec<V> = if is(level.cols.children) {
            col.cells.iter().enumerate().map(|(i, v)| level.child_levels.get(i).and_then(Option::as_ref).map_or_else(|| v.clone(), child)).collect()
        } else if is(level.cols.pred) {
            let written = predecessor_column(&preds);
            col.cells.iter().enumerate().map(|(i, v)| if rows.get(i).is_some_and(Option::is_some) { written[i].clone() } else { v.clone() }).collect()
        } else if is(level.cols.duration) {
            col.cells.iter().enumerate().map(|(i, v)| match rows.get(i).copied().flatten() {
                Some(t) if t.summary => V::Num(t.duration),
                _ => v.clone(),
            }).collect()
        } else {
            col.cells.clone()
        };
        rebuilt.push(CubeColumn { name: col.name.clone(), cells, ty: col.ty, format: None });
    }
    rebuilt.extend(appended);
    super::frames::cube_from_columns(rebuilt)
}

fn diagnostics_frame(out: &ScheduleOutput) -> V {
    let text = |name: &str, f: &dyn Fn(&engine::Diagnostic) -> &str| Column {
        name: name.into(),
        ty: FrameColType::String,
        values: out.diagnostics.iter().map(|d| V::str(f(d))).collect(),
        unit: None,
        format: None,
        raw: None,
    };
    frame_v(vec![text("Check", &|d| &d.check), text("Task", &|d| &d.task), text("Detail", &|d| &d.detail)])
}

fn json_opt(n: Option<f64>) -> Json {
    n.map_or(Json::Null, json_num)
}

fn json_str_opt(s: &Option<String>) -> Json {
    s.as_ref().map_or(Json::Null, |s| Json::String(s.clone()))
}

fn dependency_json(d: &Dependency) -> Json {
    json!({ "task": d.task, "type": d.ty.as_str(), "lag": json_num(d.lag), "elapsed": d.elapsed == Some(true) })
}

/// `ScheduleOutput` as `jsonEnc` writes it, for the card's component.
fn output_json(out: &ScheduleOutput) -> Json {
    let pairs = |xs: &[(f64, f64)]| Json::Array(xs.iter().map(|(a, b)| json!([json_num(*a), json_num(*b)])).collect());
    let nums = |xs: &[f64]| Json::Array(xs.iter().map(|x| json_num(*x)).collect());
    let task = |t: &ScheduledTask| {
        let mut m = Map::new();
        let mut put = |k: &str, v: Json| {
            m.insert(k.into(), v);
        };
        put("name", Json::String(t.name.clone()));
        put("level", json_num(t.level));
        put("summary", Json::Bool(t.summary));
        put("milestone", Json::Bool(t.milestone));
        put("duration", json_num(t.duration));
        put("start", json_num(t.start));
        put("finish", json_num(t.finish));
        put("earlyStart", json_num(t.early_start));
        put("earlyFinish", json_num(t.early_finish));
        put("lateStart", json_num(t.late_start));
        put("lateFinish", json_num(t.late_finish));
        put("float", json_num(t.float));
        put("freeFloat", json_num(t.free_float));
        put("critical", Json::Bool(t.critical));
        put("driving", json_str_opt(&t.driving));
        if let Some(s) = &t.segments {
            put("segments", pairs(s));
        }
        put("alap", Json::Bool(t.alap));
        put("late", Json::Bool(t.late));
        put("floored", Json::Bool(t.floored));
        put("startFloor", json_opt(t.start_floor));
        put("manual", Json::Bool(t.manual));
        put("complete", json_num(t.complete));
        put("deadline", json_opt(t.deadline));
        put("group", json_str_opt(&t.group));
        put("wbs", Json::String(t.wbs.clone()));
        put("predecessors", Json::Array(t.predecessors.iter().map(dependency_json).collect()));
        Json::Object(m)
    };
    json!({
        "tasks": out.tasks.iter().map(task).collect::<Vec<_>>(),
        "links": out.links.iter().map(|l| json!({
            "from": l.from, "to": l.to, "type": l.ty.as_str(), "lag": json_num(l.lag),
            "driving": l.driving, "critical": l.critical, "violated": l.violated,
        })).collect::<Vec<_>>(),
        "projectStart": json_num(out.project_start),
        "projectFinish": json_num(out.project_finish),
        "diagnostics": out.diagnostics.iter().map(|d| json!({ "check": d.check, "task": d.task, "detail": d.detail })).collect::<Vec<_>>(),
        "nonWorking": pairs(&out.non_working),
        "weekend": nums(&out.weekend),
        "holidays": nums(&out.holidays),
    })
}

fn iso(serial: f64) -> String {
    format_date_serial(serial, "YYYY-MM-DD")
}

/// The calc's day (`todaySerial`): the local day of the clock the call carries.
fn today() -> V {
    super::kit::core_call("TODAY", &[])
}

/// A holidays input as the engine reads it: a list's numbers, anything else none.
fn holiday_list(v: &V) -> Option<Vec<Option<f64>>> {
    match v {
        V::List(items) => Some(items.iter().map(|x| num(Some(x))).collect()),
        V::Undef | V::Null => None,
        _ => Some(Vec::new()),
    }
}

/// A value JS reads as a number in arithmetic and comparison (`Math.round(code)`, `h > 0`).
fn js_arith(v: &V) -> f64 {
    match v {
        V::Undef => f64::NAN,
        v => to_number(v),
    }
}

/// `readInput(inputs[key], this.literals[key] ?? dflt) ?? dflt`.
fn read_or(c: &Call, key: &str, dflt: f64) -> V {
    match c.read_num(key, dflt) {
        V::Null | V::Undef => V::Num(dflt),
        v => v,
    }
}

/// `inputs[key] ? inputs[key][0] : dflt`: the first cable's value, `undefined` past an empty one.
fn wired_first(c: &Call, key: &str) -> Option<V> {
    c.wired(key).map(|w| w.first().cloned().unwrap_or(V::Undef))
}

fn schedule_card(c: &mut Call) -> Answer {
    const FIELDS: [&str; 6] = ["cachedResult", "cachedFinish", "cachedGantt", "cachedDiagnostics", "cachedOutput", "cachedMspdi"];
    let outs = |v: &V| -> Vec<(String, V)> { ["cube", "finish", "diagnostics", "gantt", "mspdi"].iter().map(|k| (k.to_string(), v.clone())).collect() };
    let tasks = slot(c, "tasks");
    let start = wired_first(c, "start").unwrap_or_else(today);
    let (V::Cube(tasks), V::Num(start)) = (&tasks, &start) else {
        for f in FIELDS {
            c.show(f, V::Null);
        }
        return Ok(outs(&V::Null));
    };
    let (tasks, start) = (tasks.clone(), *start);
    if !start.is_finite() {
        for f in FIELDS {
            c.show(f, V::Null);
        }
        return Ok(outs(&V::Null));
    }
    let weekend_code = js_arith(&read_or(c, "weekend_code", 1.0));
    let hours_in = read_or(c, "hours", 8.0);
    let status = wired_first(c, "status").and_then(|v| num(Some(&v)));
    let links = match slot(c, "links") {
        V::Frame(f) => Some(f),
        _ => None,
    };
    let holidays_in = slot(c, "holidays");
    let working = c.field_str("mode", "working") == "working";
    let minutes = c.field_str("precision", "days") == "minutes";
    let critical = c.field_str("criticalPaths", "one").to_string();
    let split = c.field_str("progress", "split") != "move";
    let hpd = js_arith(&hours_in);
    let hours = if truthy(&hours_in) && hpd > 0.0 { Hours { n: hpd, is_num: matches!(hours_in, V::Num(_)) } } else { Hours { n: 8.0, is_num: true } };
    let run = || -> Rd<(V, f64, V, V, Json, String)> {
        let (level, mut plan) = read_level(tasks.clone(), hours)?;
        if let Some(l) = &links {
            let mut off = HashSet::new();
            inactive_names(&level, &mut off);
            apply_links_frame(&mut plan, l, &off)?;
        }
        let holidays = holiday_list(&holidays_in);
        let input = engine::ScheduleInput {
            tasks: plan,
            start,
            calendar: CalendarSpec { working_days: working, weekend_code: Some(weekend_code), holidays: holidays.clone(), minutes, intervals: Some(engine::intervals_for_hours(hours.n)) },
            status_date: status,
            critical_slack: None,
            multiple_critical_paths: critical == "many",
            longest_path: critical == "longest",
            split_in_progress: Some(split),
        };
        let out = engine::schedule(&input).map_err(|e| value_err(format!("Schedule: {}", e.message)))?;
        let by_name: HashMap<String, &ScheduledTask> = out.tasks.iter().map(|t| (js_lower(&t.name).into_owned(), t)).collect();
        let nested = out.tasks.iter().any(|t| t.summary);
        let cube = write_level(&level, &by_name, nested, minutes, links.is_some());
        let none: Vec<Option<f64>> = Vec::new();
        let mspdi_holidays = if working { holidays.as_deref() } else { Some(none.as_slice()) };
        let mspdi = engine::write_mspdi(&out, &engine::MspdiOptions { title: Some("Schedule"), hours_per_day: Some(hours.n), format_iso: &iso, minutes, holidays: mspdi_holidays });
        Ok((cube, out.project_finish, V::str(&engine::mermaid_gantt(&out, iso)), diagnostics_frame(&out), output_json(&out), mspdi))
    };
    match run() {
        Ok((cube, finish, gantt, diagnostics, output, mspdi)) => {
            let mspdi = V::str(&mspdi);
            c.show("cachedResult", cube.clone());
            c.show("cachedFinish", V::Num(finish));
            c.show("cachedGantt", gantt.clone());
            c.show("cachedDiagnostics", diagnostics.clone());
            c.show("cachedOutput", V::Json(Rc::new(output)));
            c.show("cachedMspdi", mspdi.clone());
            Ok(vec![("cube".into(), cube), ("finish".into(), V::Num(finish)), ("diagnostics".into(), diagnostics), ("gantt".into(), gantt), ("mspdi".into(), mspdi)])
        }
        Err(Fail::Sol(e)) => {
            let e = V::err(e);
            for f in FIELDS {
                c.show(f, if f == "cachedOutput" { V::Null } else { e.clone() });
            }
            Ok(outs(&e))
        }
        Err(Fail::Js(e)) => Err(e),
    }
}

// ─── ganttPayload.ts ────────────────────────────────────────────────────────────────────────────────────────────────

/// `col`: the first of the names a column carries.
fn gantt_col<'a>(c: &'a Cube, names: &[&str]) -> Option<&'a CubeColumn> {
    names.iter().find_map(|n| c.columns.iter().find(|x| norm(&x.name) == *n))
}

/// `depsOf`: a Predecessors cell as the figure reads it, never refused.
fn deps_of(v: Option<&V>) -> Vec<Dependency> {
    let Some(v) = v.filter(|v| !nullish(v)) else { return Vec::new() };
    match v {
        V::List(_) | V::Str(_) => read_predecessors(Some(v), "").unwrap_or_default(),
        V::Cube(_) | V::Frame(_) => {
            let t = as_cube(v).expect("a table");
            let mut names = vec!["predecessor"];
            names.extend_from_slice(TASK_NAMES);
            let Some(name_col) = gantt_col(&t, &names).or_else(|| t.columns.iter().find(|x| has_text(x))) else { return Vec::new() };
            let (type_col, lag_col) = (gantt_col(&t, TYPE_NAMES), gantt_col(&t, LAG_NAMES));
            let mut out = Vec::new();
            for i in 0..rows_of(&t) {
                let task = js_trim(&js_str(cell(Some(name_col), i))).to_string();
                if task.is_empty() {
                    continue;
                }
                let ty = LinkType::parse(&link_type(cell(type_col, i))).unwrap_or(LinkType::FS);
                let lag = match num(cell(lag_col, i)) {
                    Some(n) => n,
                    None => {
                        let n = cell(lag_col, i).map_or(0.0, to_number);
                        if n.is_nan() || n == 0.0 { 0.0 } else { n }
                    }
                };
                out.push(Dependency { task, ty, lag, elapsed: None });
            }
            out
        }
        _ => Vec::new(),
    }
}

/// A row of the figure: its name, depth, every cell by its column's normalized name, and its links.
struct Row {
    name: String,
    level: f64,
    cells: HashMap<String, V>,
    deps: Vec<Dependency>,
}

impl Row {
    fn get(&self, k: &str) -> Option<&V> {
        self.cells.get(k).filter(|v| !nullish(v))
    }

    fn num(&self, k: &str) -> Option<f64> {
        num(self.get(k))
    }

    /// `a ?? b ?? …`.
    fn first(&self, ks: &[&str]) -> Option<&V> {
        ks.iter().find_map(|k| self.get(k))
    }
}

fn gantt_flatten(c: &Cube, level: f64, out: &mut Vec<Row>) -> Result<(), SolError> {
    let Some(task) = gantt_col(c, TASK_NAMES).or_else(|| c.columns.iter().find(|x| has_text(x))) else {
        return Err(value_err("Gantt needs a Task column naming each task"));
    };
    let pred = gantt_col(c, PRED_NAMES);
    let is_pred = |x: &CubeColumn| pred.is_some_and(|p| std::ptr::eq(p, x));
    let children = gantt_col(c, CHILD_NAMES).or_else(|| {
        c.columns.iter().find(|x| !is_pred(x) && norm(&x.name) != "segments" && x.cells.iter().any(|v| is_table(v) && as_cube(v).is_some_and(|t| gantt_col(&t, TASK_NAMES).is_some())))
    });
    let active = gantt_col(c, ACTIVE_NAMES);
    for i in 0..rows_of(c) {
        let name = js_trim(&js_str(cell(Some(task), i))).to_string();
        if name.is_empty() || is_inactive(cell(active, i)) {
            continue;
        }
        let mut cells = HashMap::new();
        for x in &c.columns {
            cells.insert(norm(&x.name), x.cells.get(i).cloned().unwrap_or(V::Null));
        }
        out.push(Row { name, level, cells, deps: if pred.is_some() { deps_of(cell(pred, i)) } else { Vec::new() } });
        if let Some(kid) = cell(children, i).filter(|v| is_table(v)) {
            gantt_flatten(&as_cube(kid).expect("a table"), level + 1.0, out)?;
        }
    }
    Ok(())
}

/// `date`: a date cell that may still be text.
fn gantt_date(v: Option<&V>) -> Rd<Option<f64>> {
    match v {
        Some(V::Num(n)) if n.is_finite() => Ok(Some(*n)),
        Some(V::Str(s)) if !js_trim(s).is_empty() => Ok(Some(parse_date_text(s)?).filter(|d| d.is_finite())),
        _ => Ok(None),
    }
}

fn link_violated(d: &Dependency, pred: &Row, succ: &Row) -> bool {
    let (Some(ps), Some(pf), Some(ss), Some(sf)) = (pred.num("start"), pred.num("finish"), succ.num("start"), succ.num("finish")) else { return false };
    if d.lag < 0.0 {
        return false;
    }
    let whole_days = ss.fract() == 0.0 && pf.fract() == 0.0;
    let succ_milestone = match succ.num("duration") {
        Some(n) => n == 0.0,
        None => ss == sf,
    };
    match d.ty {
        LinkType::FS => ss < pf || (ss == pf && whole_days && !succ_milestone),
        LinkType::SS => ss < ps,
        LinkType::FF => sf < pf,
        LinkType::SF => sf < ps,
    }
}

fn to_bool(v: &str) -> Option<bool> {
    let s = js_lower(js_trim(v)).into_owned();
    if ["on", "true", "1", "yes", "y"].contains(&s.as_str()) {
        Some(true)
    } else if ["off", "false", "0", "no", "n"].contains(&s.as_str()) {
        Some(false)
    } else {
        None
    }
}

/// `parseGanttViewOptions` (`@solenoid/gantt-layout`'s `payload.ts`), dates read as `parseDate` reads them.
fn gantt_view_options(input: Option<&str>) -> Rd<Map<String, Json>> {
    let mut v = Map::new();
    let Some(input) = input.filter(|s| !s.is_empty()) else { return Ok(v) };
    for part in input.split(';') {
        let Some(eq) = part.find('=') else { continue };
        let key = js_lower(js_trim(&part[..eq])).into_owned();
        let val = js_trim(&part[eq + 1..]);
        let lower = js_lower(val).into_owned();
        let n = string_to_number(val);
        let int = n.is_finite() && n.fract() == 0.0;
        match key.as_str() {
            "layout" if lower == "gantt" || lower == "calendar" => {
                v.insert(key, Json::String(lower));
            }
            "fit" if lower == "page" => {
                v.insert(key, json!("page"));
            }
            "zoom" if ["day", "week", "month", "quarter", "year", "fit"].contains(&lower.as_str()) => {
                v.insert(key, Json::String(lower));
            }
            "tiers" if n == 1.0 || n == 2.0 => {
                v.insert(key, json_num(n));
            }
            "collapse" if int && n >= 0.0 => {
                v.insert(key, json_num(n));
            }
            "fiscal_start" if int && (1.0..=12.0).contains(&n) => {
                v.insert(key, json_num(n));
            }
            "week" if lower == "iso" || lower == "us" => {
                v.insert(key, Json::String(lower));
            }
            "window" => {
                let parts: Vec<&str> = val.split(',').collect();
                let read = |s: Option<&&str>| -> Rd<Option<f64>> { s.map(|s| parse_date_text(js_trim(s))).transpose() };
                let (a, b) = (read(parts.first())?, read(parts.get(1))?);
                if let (Some(a), Some(b)) = (a, b) {
                    if a.is_finite() && b.is_finite() {
                        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
                        v.insert(key, json!([json_num(lo), json_num(hi)]));
                    }
                }
            }
            "columns" => {
                const COLUMNS: [&str; 7] = ["name", "start", "finish", "duration", "float", "complete", "predecessors"];
                let cols: Vec<Json> = val.split(',').map(|s| js_lower(js_trim(s)).into_owned()).filter(|s| COLUMNS.contains(&s.as_str())).map(Json::String).collect();
                if !cols.is_empty() {
                    v.insert(key, Json::Array(cols));
                }
            }
            "critical" | "baseline" | "arrows" | "today" | "status" | "weekends" | "group_by" | "labels" | "minutes" | "histogram" => {
                if let Some(b) = to_bool(val) {
                    v.insert(key, Json::Bool(b));
                }
            }
            _ => {}
        }
    }
    Ok(v)
}

struct GanttInputs<'a> {
    baseline: Option<Rc<Cube>>,
    today: f64,
    status: Option<f64>,
    options: Option<&'a str>,
    weekend_code: f64,
    holidays: Option<Vec<Option<f64>>>,
}

/// `ganttPayloadFromSchedule`.
fn gantt_payload(cube: &Cube, o: &GanttInputs) -> Rd<Json> {
    let mut rows = Vec::new();
    gantt_flatten(cube, 0.0, &mut rows)?;
    let by_key: HashMap<String, usize> = rows.iter().enumerate().map(|(i, r)| (norm(&r.name), i)).collect();
    let mut base_rows = Vec::new();
    if let Some(b) = &o.baseline {
        if gantt_flatten(b, 0.0, &mut base_rows).is_err() {
            base_rows.clear();
        }
    }
    let base_by_key: HashMap<String, usize> = base_rows.iter().enumerate().map(|(i, r)| (norm(&r.name), i)).collect();
    let mut tasks: Vec<Json> = Vec::new();
    let mut starts = Vec::new();
    let mut finishes = Vec::new();
    let mut any_clock = false;
    let mut predecessor_text = Map::new();
    for (ri, r) in rows.iter().enumerate() {
        let (Some(start), Some(finish)) = (r.num("start"), r.num("finish")) else {
            return Err(value_err(format!("Gantt: \"{}\" has no Start or Finish; it needs a Schedule node's output", r.name)).into());
        };
        let summary = read_logical(r.get("summary")) || rows.get(ri + 1).is_some_and(|n| n.level == r.level + 1.0);
        let dur = r.num("duration").or_else(|| r.num("days"));
        let fl = r.num("float");
        let deadline = match gantt_date(r.get("deadline"))? {
            Some(d) => Some(d),
            None => gantt_date(r.get("due"))?,
        };
        let complete = r.num("complete").or_else(|| r.num("% complete")).unwrap_or(0.0);
        let mut t = Map::new();
        t.insert("id".into(), Json::String(r.name.clone()));
        t.insert("name".into(), Json::String(r.name.clone()));
        t.insert("level".into(), json_num(r.level));
        t.insert("summary".into(), Json::Bool(summary));
        t.insert("milestone".into(), Json::Bool(!summary && (dur == Some(0.0) || (dur.is_none() && start == finish))));
        t.insert("start".into(), json_num(start));
        t.insert("finish".into(), json_num(finish));
        t.insert("complete".into(), json_num(math_max(0.0, math_min(100.0, complete))));
        t.insert("critical".into(), Json::Bool(read_logical(r.get("critical"))));
        t.insert("late".into(), Json::Bool(read_logical(r.get("late"))));
        t.insert("violated".into(), Json::Bool(fl.is_some_and(|f| f < 0.0)));
        t.insert("float".into(), if summary { Json::Null } else { json_opt(fl) });
        if let Some(d) = dur.filter(|d| *d >= 0.0) {
            t.insert("duration".into(), json_num(d));
        }
        if let Some(seg) = r.get("segments").filter(|v| is_table(v)) {
            let sc = as_cube(seg).expect("a table");
            let empty = Vec::new();
            let ss = gantt_col(&sc, &["start"]).map_or(&empty, |c| &c.cells);
            let sf = gantt_col(&sc, &["finish"]).map_or(&empty, |c| &c.cells);
            let parts: Vec<Json> = ss.iter().enumerate().filter_map(|(k, a)| Some(json!([json_num(num(Some(a))?), json_num(num(sf.get(k))?)]))).collect();
            if parts.len() > 1 {
                t.insert("segments".into(), Json::Array(parts));
            }
        }
        if read_logical(r.get("manual")) {
            t.insert("manual".into(), Json::Bool(true));
        }
        if let Some(d) = deadline {
            t.insert("deadline".into(), json_num(d.floor()));
        }
        if let Some(g) = r.first(&["project", "section", "group"]) {
            let g = js_trim(&js_string_of(g)).to_string();
            if !g.is_empty() {
                t.insert("group".into(), Json::String(g));
            }
        }
        if let Some(V::Str(color)) = r.get("color") {
            if !js_trim(color).is_empty() {
                t.insert("color".into(), Json::String(js_trim(color).to_string()));
            }
        }
        if let Some(V::Str(res)) = r.first(&["resource", "who", "owner", "assignee"]) {
            if !js_trim(res).is_empty() {
                t.insert("resource".into(), Json::String(js_trim(res).to_string()));
                t.insert("units".into(), json_num(r.num("units").filter(|u| *u >= 0.0).unwrap_or(1.0)));
            }
        }
        if let Some(b) = base_by_key.get(&norm(&r.name)).map(|&k| &base_rows[k]) {
            if let (Some(bs), Some(bf)) = (b.num("start"), b.num("finish")) {
                t.insert("baselineStart".into(), json_num(bs.floor()));
                t.insert("baselineFinish".into(), json_num(bf.floor()));
            }
        }
        any_clock |= start.fract() != 0.0 || finish.fract() != 0.0;
        starts.push(start);
        finishes.push(finish);
        tasks.push(Json::Object(t));
        if !r.deps.is_empty() {
            predecessor_text.insert(r.name.clone(), Json::String(engine::predecessor_text(&r.deps)));
        }
    }
    let mut links = Vec::new();
    for r in &rows {
        let succ = &rows[by_key[&norm(&r.name)]];
        let driving_name = match r.get("driving") {
            Some(V::Str(s)) => Some(norm(s)),
            _ => None,
        };
        for d in &r.deps {
            let Some(pred) = by_key.get(&norm(&d.task)).map(|&k| &rows[k]) else { continue };
            let driving = driving_name.as_deref() == Some(norm(&d.task).as_str());
            links.push(json!({
                "from": pred.name, "to": succ.name, "type": d.ty.as_str(), "lag": json_num(d.lag),
                "critical": driving && read_logical(pred.get("critical")) && read_logical(succ.get("critical")),
                "violated": link_violated(d, pred, succ),
            }));
        }
    }
    let project_start = if starts.is_empty() { o.today } else { starts.iter().copied().fold(f64::INFINITY, math_min) };
    let project_finish = if finishes.is_empty() { project_start } else { finishes.iter().copied().fold(f64::NEG_INFINITY, math_max) };
    let spec = CalendarSpec { working_days: true, weekend_code: Some(o.weekend_code), holidays: o.holidays.clone(), minutes: false, intervals: None };
    let cal = engine::Calendar::new(project_start, &spec);
    const PAD: f64 = 14.0;
    let pairs = |xs: Vec<(f64, f64)>| Json::Array(xs.into_iter().map(|(a, b)| json!([json_num(a), json_num(b)])).collect());
    let nums = |xs: Vec<f64>| Json::Array(xs.into_iter().map(json_num).collect());
    let mut view = Map::new();
    if any_clock {
        view.insert("minutes".into(), Json::Bool(true));
    }
    view.extend(gantt_view_options(o.options)?);
    Ok(json!({
        "kind": "gantt",
        "tasks": tasks,
        "links": links,
        "nonWorking": pairs(cal.non_working_spans(project_start - PAD, project_finish + PAD)),
        "weekend": nums(cal.weekend_sorted()),
        "holidays": nums(cal.holidays_between(project_start - PAD, project_finish + PAD)),
        "today": json_num(o.today),
        "statusDate": json_opt(o.status),
        "projectStart": json_num(project_start),
        "projectFinish": json_num(project_finish),
        "predecessorText": predecessor_text,
        "view": view,
    }))
}

fn gantt_card(c: &mut Call) -> Answer {
    let schedule = slot(c, "schedule");
    let lit = match c.string_literal("options") {
        V::Str(s) => Some(s.to_string()),
        _ => None,
    };
    let opt = match c.read_input("options", lit.as_deref().map_or(V::Null, V::str)) {
        V::Str(s) => Some(s.to_string()),
        V::Null => None,
        _ => lit.clone(),
    };
    let chart_options = super::visual::parse_chart_options(opt.as_deref().unwrap_or(""));
    c.show("chartOptions", V::Json(Rc::new(Json::Object(chart_options.clone()))));
    let done = |c: &mut Call, v: V| -> Answer {
        c.show("cachedChart", v.clone());
        Ok(vec![("chart".into(), v)])
    };
    if schedule.is_sol_error() {
        return done(c, schedule);
    }
    let Some(cube) = as_cube(&schedule) else { return done(c, V::Null) };
    let inputs = GanttInputs {
        baseline: as_cube(&slot(c, "baseline")),
        today: match today() {
            V::Num(n) => n,
            _ => f64::NAN,
        },
        status: wired_first(c, "status").and_then(|v| num(Some(&v))),
        options: opt.as_deref(),
        weekend_code: js_arith(&read_or(c, "weekend_code", 1.0)),
        holidays: holiday_list(&slot(c, "holidays")),
    };
    let payload = match gantt_payload(&cube, &inputs) {
        Ok(p) => p,
        Err(Fail::Sol(e)) => return done(c, V::err(e)),
        Err(Fail::Js(e)) => return Err(e),
    };
    let title = match chart_options.get("title") {
        Some(Json::String(t)) if !t.is_empty() => t.clone(),
        _ => match c.field_str("label", "") {
            "" => "Gantt".to_string(),
            l => l.to_string(),
        },
    };
    let chart = json!({ "__chart": true, "op": "gantt", "values": null, "payload": payload, "options": chart_options, "title": title });
    done(c, V::Json(Rc::new(chart)))
}

// ─── earnedValue.ts, earnedValueOps.ts ──────────────────────────────────────────────────────────────────────────────

/// `byName`: the first column, in the table's order, carrying one of the names.
fn ev_col<'a>(c: &'a Cube, names: &[&str]) -> Option<&'a CubeColumn> {
    let set: Vec<String> = names.iter().map(|n| norm(n)).collect();
    c.columns.iter().find(|col| set.contains(&norm(&col.name)))
}

/// A money or percent cell as the number it shows; anything else 0.
fn magnitude(v: Option<&V>) -> f64 {
    match v {
        Some(V::Unit(u)) => crate::unit_expression::display_magnitude_of(u),
        Some(V::Num(n)) if n.is_finite() => *n,
        _ => 0.0,
    }
}

/// `unitOf`: the column's first unit cell as a column unit.
fn unit_of(col: Option<&CubeColumn>) -> Option<Json> {
    let V::Unit(u) = col?.cells.iter().find(|v| matches!(v, V::Unit(_)))? else { return None };
    let mut o = Map::new();
    o.insert("dim".into(), Json::Object(u.dim.iter().map(|(k, v)| (k.clone(), json_num(*v))).collect()));
    if let Some(d) = u.display.as_ref().filter(|d| !d.is_empty()) {
        o.insert("display".into(), Json::String(d.clone()));
    }
    Some(Json::Object(o))
}

struct EvTask {
    name: String,
    cost: f64,
    complete: f64,
    planned_start: Option<f64>,
    planned_finish: Option<f64>,
    actual_cost: Option<f64>,
}

struct Metrics {
    bcws: f64,
    bcwp: f64,
    acwp: f64,
    sv: f64,
    cv: f64,
    spi: Option<f64>,
    cpi: Option<f64>,
    eac: f64,
    vac: f64,
    tcpi: Option<f64>,
}

fn ratio(n: f64, d: f64) -> Option<f64> {
    (d != 0.0).then(|| n / d)
}

fn metrics_for(bac: f64, bcws: f64, bcwp: f64, acwp: f64) -> Metrics {
    let cpi = ratio(bcwp, acwp);
    let eac = match cpi {
        Some(c) if c > 0.0 => bac / c,
        _ => bac,
    };
    Metrics { bcws, bcwp, acwp, sv: bcwp - bcws, cv: bcwp - acwp, spi: ratio(bcwp, bcws), cpi, eac, vac: bac - eac, tcpi: ratio(bac - bcwp, bac - acwp) }
}

/// `plannedFraction`: how much of the planned span the status date has reached, in working days.
fn planned_fraction(start: Option<f64>, finish: Option<f64>, status: f64, cal: &engine::Calendar) -> engine::Sr<f64> {
    let (Some(s), Some(f)) = (start, finish) else { return Ok(0.0) };
    if status.floor() < s.floor() {
        return Ok(0.0);
    }
    if status >= f {
        return Ok(1.0);
    }
    let total = cal.count_between(s, f)?;
    if total <= 0.0 {
        return Ok(1.0);
    }
    Ok(math_min(1.0, cal.count_between(s, status)? / total))
}

fn earned_value_card(c: &mut Call) -> Answer {
    let empty = |c: &mut Call, v: V| -> Answer {
        let side = if v.is_sol_error() { v.clone() } else { V::Null };
        c.show("cachedResult", v.clone());
        for f in ["cachedSpi", "cachedCpi", "cachedEac"] {
            c.show(f, side.clone());
        }
        Ok(vec![("frame".into(), v), ("spi".into(), side.clone()), ("cpi".into(), side.clone()), ("eac".into(), side)])
    };
    let sched = slot(c, "schedule");
    if sched.is_sol_error() {
        return empty(c, sched);
    }
    let Some(scube) = as_cube(&sched) else { return empty(c, V::Null) };
    let status = match wired_first(c, "status").unwrap_or_else(today) {
        V::Num(n) if n.is_finite() => n,
        _ => return empty(c, V::Null),
    };
    let bcube = as_cube(&slot(c, "baseline"));
    let cost_name = match c.read_input("cost", match c.string_literal("cost") {
        V::Undef | V::Null => V::str(""),
        v => v,
    }) {
        V::Null | V::Undef => String::new(),
        v => super::frames::trimmed(&v, "(intermediate value)")?,
    };
    const TASK: [&str; 3] = ["task", "name", "title"];
    const COST: [&str; 3] = ["cost", "budget", "bac"];
    let task_col = ev_col(&scube, &TASK).or_else(|| scube.columns.iter().find(|x| has_text(x)));
    let Some(task_col) = task_col else { return empty(c, V::err(value_err("Earned Value needs a Task column naming each task"))) };
    let complete_col = ev_col(&scube, &["complete", "% complete", "percent complete", "done", "progress"]);
    let named = |t: &Cube| -> Option<usize> { (!cost_name.is_empty()).then(|| ev_col(t, &[cost_name.as_str()])).flatten().map(|col| t.columns.iter().position(|x| std::ptr::eq(x, col)).unwrap_or(0)) };
    let cost_col = named(&scube).map(|i| &scube.columns[i]).or_else(|| ev_col(&scube, &COST));
    let actual_col = ev_col(&scube, &["actual cost", "actual", "acwp", "spent"]);
    let (s_start, s_finish) = (ev_col(&scube, &["start"]), ev_col(&scube, &["finish", "end"]));
    let b = bcube.as_deref();
    let b_task = b.and_then(|b| ev_col(b, &TASK).or_else(|| b.columns.iter().find(|x| has_text(x))));
    let b_cost = b.and_then(|b| named(b).map(|i| &b.columns[i]).or_else(|| ev_col(b, &COST)));
    let (b_start, b_finish) = (b.and_then(|b| ev_col(b, &["start"])), b.and_then(|b| ev_col(b, &["finish", "end"])));
    let mut base_idx: HashMap<String, usize> = HashMap::new();
    if let Some(bt) = b_task {
        for (i, v) in bt.cells.iter().enumerate() {
            let n = norm(&js_str(Some(v)));
            if !n.is_empty() {
                base_idx.entry(n).or_insert(i);
            }
        }
    }
    let cost_unit = unit_of(cost_col).or_else(|| unit_of(b_cost));
    let date_of = |v: Option<&V>| num(v);
    let mut tasks = Vec::new();
    for i in 0..rows_of(&scube) {
        let name = js_trim(&js_str(cell(Some(task_col), i))).to_string();
        if name.is_empty() {
            continue;
        }
        let bi = base_idx.get(&norm(&name)).copied();
        let base_cost = bi.and_then(|bi| b_cost.map(|bc| magnitude(cell(Some(bc), bi))));
        let cost = base_cost.unwrap_or_else(|| cost_col.map_or(0.0, |cc| magnitude(cell(Some(cc), i))));
        let complete = math_max(0.0, math_min(100.0, complete_col.map_or(0.0, |cc| magnitude(cell(Some(cc), i)))));
        let planned = |bc: Option<&CubeColumn>, sc: Option<&CubeColumn>| match (bi, bc) {
            (Some(bi), Some(bc)) => date_of(cell(Some(bc), bi)),
            _ => date_of(cell(sc, i)),
        };
        let actual_cost = actual_col.and_then(|ac| cell(Some(ac), i).filter(|v| !nullish(v)).map(|v| magnitude(Some(v))));
        tasks.push(EvTask { name, cost, complete, planned_start: planned(b_start, s_start), planned_finish: planned(b_finish, s_finish), actual_cost });
    }
    let weekend_code = js_arith(&read_or(c, "weekend_code", 1.0));
    let spec = CalendarSpec { working_days: true, weekend_code: Some(weekend_code), holidays: holiday_list(&slot(c, "holidays")), minutes: false, intervals: None };
    let cal = engine::Calendar::new(status, &spec);
    let mut rows: Vec<(String, Metrics)> = Vec::new();
    for t in &tasks {
        let bac = t.cost;
        let bcws = bac * planned_fraction(t.planned_start, t.planned_finish, status, &cal).map_err(|e| thrown(&e.message))?;
        let bcwp = bac * (t.complete / 100.0);
        let acwp = t.actual_cost.unwrap_or(bcwp);
        rows.push((t.name.clone(), metrics_for(bac, bcws, bcwp, acwp)));
    }
    let sum = |f: &dyn Fn(&Metrics) -> f64| rows.iter().fold(0.0, |a, (_, m)| a + f(m));
    let bac_total = tasks.iter().fold(0.0, |a, t| a + t.cost);
    let totals = metrics_for(bac_total, sum(&|m| m.bcws), sum(&|m| m.bcwp), sum(&|m| m.acwp));
    let opt = |x: Option<f64>| x.map_or(V::Null, V::Num);
    let money_col = |name: &str, values: Vec<V>| Column {
        name: name.into(),
        ty: FrameColType::Number,
        values,
        unit: if ["SPI", "CPI", "TCPI"].contains(&name) { None } else { cost_unit.clone() },
        format: None,
        raw: None,
    };
    let of = |f: &dyn Fn(&Metrics) -> V| rows.iter().map(|(_, m)| f(m)).collect::<Vec<V>>();
    let frame = frame_v(vec![
        Column { name: "Task".into(), ty: FrameColType::String, values: rows.iter().map(|(n, _)| V::str(n)).collect(), unit: None, format: None, raw: None },
        money_col("BCWS", of(&|m| V::Num(m.bcws))),
        money_col("BCWP", of(&|m| V::Num(m.bcwp))),
        money_col("ACWP", of(&|m| V::Num(m.acwp))),
        money_col("SV", of(&|m| V::Num(m.sv))),
        money_col("CV", of(&|m| V::Num(m.cv))),
        money_col("SPI", of(&|m| opt(m.spi))),
        money_col("CPI", of(&|m| opt(m.cpi))),
        money_col("EAC", of(&|m| V::Num(m.eac))),
        money_col("VAC", of(&|m| V::Num(m.vac))),
        money_col("TCPI", of(&|m| opt(m.tcpi))),
    ]);
    let eac = match &cost_unit {
        Some(u) => tag_cell_unit(&V::Num(totals.eac), u),
        None => V::Num(totals.eac),
    };
    let (spi, cpi) = (opt(totals.spi), opt(totals.cpi));
    c.show("cachedResult", frame.clone());
    c.show("cachedSpi", spi.clone());
    c.show("cachedCpi", cpi.clone());
    c.show("cachedEac", eac.clone());
    Ok(vec![("frame".into(), frame), ("spi".into(), spi), ("cpi".into(), cpi), ("eac".into(), eac)])
}

// ─── SCAN (tableLambda.ts), ODE Integrate (stats.ts, odeOps.ts) ─────────────────────────────────────────────────────

fn scan_lambda(c: &mut Call) -> Answer {
    use super::matrix::{any_matrix, fn_error, holds_unit_cell, lambda_done, resolve, result_cell};
    let initial = c.read_num("initial", 0.0);
    let m = any_matrix(&slot(c, "table"));
    let body = match resolve(c, "acc + value", &["acc", "value", "step"]) {
        Ok(b) => b,
        Err(e) => return fn_error(c, e),
    };
    let Some(m) = m else { return lambda_done(c, V::Null, None) };
    if matches!(initial, V::Unit(_)) || holds_unit_cell(&m) {
        return match body.fold(crate::unit_fold::FoldKind::Scan, &m, &initial) {
            Some(r) => lambda_done(c, r, None),
            None => Err(super::err(ErrorCode::Value, "This fold over units has no reading on the core")),
        };
    }
    let ev = crate::eval::Eval::default();
    let mut acc = initial;
    let mut i = 0.0;
    let out: Vec<V> = m
        .iter()
        .map(|row| {
            list(row.iter().map(|x| {
                i += 1.0;
                acc = body.call(&ev, &[acc.clone(), x.clone(), V::Num(i)]);
                result_cell(&acc)
            }).collect())
        })
        .collect();
    lambda_done(c, list(out), None)
}

/// `rk4`: the classical fourth-order steps, None where the derivative is undefined or the solution diverges.
fn rk4(f: &dyn Fn(f64, f64) -> Option<f64>, y0: f64, t0: f64, t1: f64, steps: f64) -> Option<(Vec<f64>, Vec<f64>)> {
    if ![y0, t0, t1].iter().all(|x| x.is_finite()) {
        return None;
    }
    let s = steps.floor();
    let n = math_max(1.0, math_min(100_000.0, if s.is_nan() || s == 0.0 { 1.0 } else { s }));
    let h = (t1 - t0) / n;
    let (mut ts, mut ys) = (vec![t0], vec![y0]);
    let (mut t, mut y) = (t0, y0);
    let n = n as usize;
    for i in 0..n {
        let k1 = f(t, y)?;
        let k2 = f(t + h / 2.0, y + (h / 2.0) * k1)?;
        let k3 = f(t + h / 2.0, y + (h / 2.0) * k2)?;
        let k4 = f(t + h, y + h * k3)?;
        y += (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
        t = if i + 1 == n { t1 } else { t0 + (i + 1) as f64 * h };
        if !y.is_finite() {
            return None;
        }
        ts.push(t);
        ys.push(y);
    }
    Some((ts, ys))
}

fn ode_integrate(c: &mut Call) -> Answer {
    use super::scalar::{read_role, Role};
    let body = match super::matrix::resolve(c, "y", &["t", "y"]) {
        Ok(b) => b,
        Err(e) => {
            c.show("cachedResult", V::Null);
            c.show("cachedError", V::str(&e.message));
            return Ok(vec![("solution".into(), V::err(e))]);
        }
    };
    c.show("cachedError", V::Null);
    let (y0, t0, t1) = (c.read_num("y0", 1.0), c.read_num("t0", 0.0), c.read_num("t1", 1.0));
    let steps = read_role(c, "steps", &Role::Setting(V::Num(100.0)));
    if [&y0, &t0, &t1].iter().any(|v| matches!(v, V::Null)) {
        c.show("cachedResult", V::Null);
        return Ok(vec![("solution".into(), V::Null)]);
    }
    let finite = |v: &V| if let V::Num(n) = v { *n } else { f64::NAN };
    let ev = crate::eval::Eval::default();
    let f = |t: f64, y: f64| match body.call(&ev, &[V::Num(t), V::Num(y)]) {
        V::Num(r) if r.is_finite() => Some(r),
        _ => None,
    };
    let solution = match rk4(&f, finite(&y0), finite(&t0), finite(&t1), js_arith(&steps)) {
        Some((ts, ys)) => frame_v(vec![
            super::frames::num_column("t", ts.into_iter().map(V::Num).collect()),
            super::frames::num_column("y", ys.into_iter().map(V::Num).collect()),
        ]),
        None => V::err(sol_error(ErrorCode::Domain, "The integration diverged or the derivative was undefined on the interval")),
    };
    c.show("cachedResult", solution.clone());
    Ok(vec![("solution".into(), solution)])
}
