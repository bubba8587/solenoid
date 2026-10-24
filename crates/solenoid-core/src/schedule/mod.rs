//! [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C44]] dateSerials, [[E10]] pickVsAggregateErrors, [[D66]]
//! daysMinutesModes. The scheduling engine: critical-path passes over a name-keyed task
//! graph with working calendars, typed links, floors, ceilings, deadlines and diagnostics, in serial-day arithmetic
//! (`packages/schedule-engine/README.md` is the contract). The file readers (MSPDI, GanttProject, XER) stay at the
//! import border in the TS.

pub mod calendar;
mod cpm;
mod graph;
mod report;
#[cfg(test)]
mod tests;

pub use calendar::{intervals_for_hours, Calendar, CalendarSpec, Interval};
pub use cpm::schedule;
pub use report::{mermaid_gantt, predecessor_text, write_mspdi, MspdiOptions};

/// A failure the plan's own content causes, naming a task where one is to blame.
#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleError {
    pub message: String,
}

impl ScheduleError {
    pub fn new(message: impl Into<String>) -> ScheduleError {
        ScheduleError { message: message.into() }
    }
}

pub type Sr<T> = Result<T, ScheduleError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkType {
    FS,
    SS,
    FF,
    SF,
}

impl LinkType {
    pub fn parse(s: &str) -> Option<LinkType> {
        Some(match s {
            "FS" => LinkType::FS,
            "SS" => LinkType::SS,
            "FF" => LinkType::FF,
            "SF" => LinkType::SF,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            LinkType::FS => "FS",
            LinkType::SS => "SS",
            LinkType::FF => "FF",
            LinkType::SF => "SF",
        }
    }
}

/// `PlanDependency`: `elapsed` is `None` where the plan leaves it out.
#[derive(Clone, Debug, PartialEq)]
pub struct Dependency {
    pub task: String,
    pub ty: LinkType,
    pub lag: f64,
    pub elapsed: Option<bool>,
}

impl Dependency {
    pub fn fs(task: &str) -> Dependency {
        Dependency { task: task.to_string(), ty: LinkType::FS, lag: 0.0, elapsed: None }
    }
}

/// A task's own calendar, layered over the project's (`Partial<CalendarSpec>`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TaskCalendar {
    pub weekend_code: Option<f64>,
    pub holidays: Option<Vec<Option<f64>>>,
    pub intervals: Option<Vec<Interval>>,
}

/// `PlanTask`.
#[derive(Clone, Debug, Default)]
pub struct PlanTask {
    pub name: String,
    pub duration: Option<f64>,
    pub predecessors: Vec<Dependency>,
    pub start: Option<f64>,
    pub finish: Option<f64>,
    pub deadline: Option<f64>,
    pub manual: bool,
    pub complete: Option<f64>,
    pub group: Option<String>,
    pub alap: bool,
    pub actual_start: Option<f64>,
    pub elapsed: bool,
    pub work: Option<f64>,
    pub units: Option<f64>,
    pub calendar: Option<TaskCalendar>,
    pub children: Option<Vec<PlanTask>>,
    pub row: Option<f64>,
}

/// `ScheduleInput`.
#[derive(Clone, Debug, Default)]
pub struct ScheduleInput {
    pub tasks: Vec<PlanTask>,
    pub start: f64,
    pub calendar: CalendarSpec,
    pub status_date: Option<f64>,
    pub critical_slack: Option<f64>,
    pub multiple_critical_paths: bool,
    pub longest_path: bool,
    /// Project's "Split in-progress tasks", on unless set false.
    pub split_in_progress: Option<bool>,
}

/// `ScheduledTask`: its predecessors as the engine read them, `elapsed` always set.
#[derive(Clone, Debug)]
pub struct ScheduledTask {
    pub name: String,
    pub level: f64,
    pub summary: bool,
    pub milestone: bool,
    pub duration: f64,
    pub start: f64,
    pub finish: f64,
    pub early_start: f64,
    pub early_finish: f64,
    pub late_start: f64,
    pub late_finish: f64,
    pub float: f64,
    pub free_float: f64,
    pub critical: bool,
    pub driving: Option<String>,
    pub segments: Option<Vec<(f64, f64)>>,
    pub alap: bool,
    pub late: bool,
    pub floored: bool,
    pub start_floor: Option<f64>,
    pub manual: bool,
    pub complete: f64,
    pub deadline: Option<f64>,
    pub group: Option<String>,
    pub wbs: String,
    pub predecessors: Vec<Dependency>,
}

#[derive(Clone, Debug)]
pub struct ScheduleLink {
    pub from: String,
    pub to: String,
    pub ty: LinkType,
    pub lag: f64,
    pub driving: bool,
    pub critical: bool,
    pub violated: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub check: String,
    pub task: String,
    pub detail: String,
}

#[derive(Clone, Debug)]
pub struct ScheduleOutput {
    pub tasks: Vec<ScheduledTask>,
    pub links: Vec<ScheduleLink>,
    pub project_start: f64,
    pub project_finish: f64,
    pub diagnostics: Vec<Diagnostic>,
    pub non_working: Vec<(f64, f64)>,
    pub weekend: Vec<f64>,
    pub holidays: Vec<f64>,
}
