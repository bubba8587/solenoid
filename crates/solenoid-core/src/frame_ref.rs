// [[C130]] rustCore, [[C24]] arraySemantics, [[C23]] calcModes
//! A lazy frame: a frame and a plan of verbs not yet run on it, run once when something reads it and kept with the ref
//! (`tree/specs/computation/frame-verbs.md` § Lazy frames).

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

use serde_json::{Map, Value as Json};

use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::frame::{frame_row_count, get_column, FrameCell, FrameColumn, FrameValue};
use crate::frame_verbs::{apply_verb, pivot_frame, sample_frame, FrameOp, TaggedOp};
use crate::value_kinds::guard_finite;

/// The rows a sketch-mode flush samples from a plan's frame.
pub const SKETCH_SAMPLE_ROWS: usize = 10_000;

thread_local! {
    static SKETCH: Cell<bool> = const { Cell::new(false) };
    static STATS: Cell<Stats> = const { Cell::new(Stats { runs: 0, ops: 0, taken: 0, collects: 0 }) };
}

/// What the frame layer did since the last ask, for the tests that hold a chain's cost: plans run, ops applied,
/// frame values taken in, refs read whole.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Stats {
    pub runs: u32,
    pub ops: u32,
    pub taken: u32,
    pub collects: u32,
}

pub(crate) fn count(f: impl FnOnce(&mut Stats)) {
    STATS.with(|s| {
        let mut v = s.get();
        f(&mut v);
        s.set(v);
    });
}

pub fn take_stats() -> Stats {
    STATS.with(|s| s.replace(Stats::default()))
}

/// Sketch mode is on and no pass is forced exact: a flush samples ([[C23]] calcModes). The graph keeps it current.
pub fn set_sketch(on: bool) {
    SKETCH.with(|s| s.set(on));
}

pub fn sketch() -> bool {
    SKETCH.with(Cell::get)
}

/// A frame and the verbs planned on it, as the cards wrote them; it holds its frames, so they go when nothing holds it.
pub struct FrameRef {
    base: Rc<FrameValue>,
    plan: Vec<Json>,
    /// The ref this one extends by one op: its answer is this one's input.
    parent: Option<Rc<FrameRef>>,
    flushed: RefCell<Option<FlushedIn>>,
    /// What a reader keeps beside the ref for the sketch mode it read in (the card value it collects to).
    memo: RefCell<Vec<Kept>>,
}

/// A flush and the sketch mode it ran in.
type FlushedIn = (bool, Result<Rc<Flushed>, SolError>);
/// A reader's value and the sketch mode and name it was kept under.
type Kept = (bool, &'static str, Rc<dyn Any>);

impl std::fmt::Debug for FrameRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "FrameRef({} ops)", self.plan.len())
    }
}

/// A plan run: the frame it made, and what reading it must still do.
pub struct Flushed {
    pub frame: Rc<FrameValue>,
    /// `total / sampled` where the frame was made from a sample, else 1.
    factor: f64,
    /// The factor a sample's GROUPBY sums and counts were scaled up by, which marks a reading approximate.
    scaled: Option<f64>,
    guard: Option<Rc<Guard>>,
    /// A plan ending in a pivot: the layout it laid the frame out with.
    pub layout: Option<Json>,
}

/// A plan with a GROUPBY: the aggregate columns, each by the column it read on the plan's own frame, so an
/// overflow is told from an infinite input when read.
struct Guard {
    base: Rc<FrameValue>,
    aggs: Vec<(String, String)>,
}

impl Flushed {
    fn plain(frame: Rc<FrameValue>) -> Flushed {
        Flushed { frame, factor: 1.0, scaled: None, guard: None, layout: None }
    }

    /// The factor a reading of this frame is marked approximate by, where a sample's sums were scaled.
    pub fn approx(&self) -> Option<f64> {
        self.scaled
    }

    /// Columns read from the frame as a reading must give them: the aggregates' non-finite numbers classified
    /// ([[C24]] arraySemantics).
    pub fn finish(&self, mut columns: Vec<FrameColumn>) -> Vec<FrameColumn> {
        if let Some(g) = &self.guard {
            let source = |name: &str| g.aggs.iter().rev().find(|(as_, _)| as_ == name).map(|(_, col)| col.as_str());
            let mut inf_in: Vec<(String, bool)> = Vec::new();
            for c in columns.iter_mut() {
                let Some(src) = source(&c.name) else { continue };
                if !c.values.iter().any(|v| matches!(v, FrameCell::Num(n) if !n.is_finite())) {
                    continue;
                }
                let had_inf = match inf_in.iter().find(|(s, _)| s == src) {
                    Some((_, b)) => *b,
                    None => {
                        let b = get_column(&g.base, src).is_some_and(|k| {
                            k.values.iter().any(|v| matches!(v, FrameCell::Num(n) if n.is_infinite()))
                        });
                        inf_in.push((src.to_string(), b));
                        b
                    }
                };
                let inputs: &[f64] = if had_inf { &[f64::INFINITY] } else { &[] };
                let guarded = c.values.iter().map(|v| match v {
                    FrameCell::Num(n) if !n.is_finite() => guard_finite(*n, inputs),
                    v => v.clone(),
                });
                *c = c.with_values(guarded.collect());
            }
        }
        columns
    }

    /// The first `n` rows, a row past a short column's end blank.
    pub fn head(&self, n: usize) -> Vec<FrameColumn> {
        let take = n.min(frame_row_count(&self.frame));
        self.frame.columns.iter().map(|c| c.with_values((0..take).map(|r| c.cell_at(r).clone()).collect())).collect()
    }
}

/// A sampled GROUPBY's answer with its sums and counts scaled by `factor` to stand for the whole frame.
fn scale_sums(f: &FrameValue, group_by: &Json, factor: f64) -> FrameValue {
    let scaled: Vec<&str> = group_by
        .get("aggs")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter(|a| matches!(a.get("op").and_then(Json::as_str), Some("sum" | "count")))
        .filter_map(|a| a.get("as").and_then(Json::as_str))
        .collect();
    FrameValue {
        columns: f
            .columns
            .iter()
            .map(|c| {
                if !scaled.contains(&c.name.as_str()) {
                    return c.clone();
                }
                c.with_values(
                    c.values
                        .iter()
                        .map(|v| if let FrameCell::Num(n) = v { FrameCell::Num(n * factor) } else { v.clone() })
                        .collect(),
                )
            })
            .collect(),
    }
}

/// A plan op as JavaScript would have handed it on: a number JSON can't hold reads as null, and an `undefined`
/// field is left out.
fn as_js(op: &Json) -> Option<Json> {
    Some(match op {
        Json::Object(o) if o.contains_key("__nf") => match o["__nf"].as_str() {
            Some("-0") => Json::from(0),
            _ => Json::Null,
        },
        Json::Object(o) if o.contains_key("__undef") => return None,
        Json::Object(o) => {
            Json::Object(o.iter().filter_map(|(k, v)| Some((k.clone(), as_js(v)?))).collect::<Map<_, _>>())
        }
        Json::Array(a) => Json::Array(a.iter().map(|v| as_js(v).unwrap_or(Json::Null)).collect()),
        other => other.clone(),
    })
}

fn is_group_by(op: &Json) -> bool {
    op.get("kind").and_then(Json::as_str) == Some("groupBy")
}

/// The ops as the verbs read them, all of them before any runs.
fn parse(ops: &[Json]) -> Result<Vec<FrameOp>, SolError> {
    ops.iter()
        .map(|op| {
            serde_json::from_value::<TaggedOp>(as_js(op).unwrap_or(Json::Null))
                .map(|t| t.0)
                .map_err(|e| sol_error(ErrorCode::Error, format!("bad argument \"ops\": {e}")))
        })
        .collect()
}

impl FrameRef {
    /// A frame with nothing planned on it.
    pub fn source(base: Rc<FrameValue>) -> Rc<FrameRef> {
        Rc::new(FrameRef {
            base,
            plan: Vec::new(),
            parent: None,
            flushed: RefCell::new(None),
            memo: RefCell::default(),
        })
    }

    /// This ref with `op` planned after its own.
    pub fn then(self: &Rc<Self>, op: Json) -> Rc<FrameRef> {
        let mut plan = self.plan.clone();
        plan.push(op);
        Rc::new(FrameRef {
            base: self.base.clone(),
            plan,
            parent: Some(self.clone()),
            flushed: RefCell::new(None),
            memo: RefCell::default(),
        })
    }

    pub fn base(&self) -> &Rc<FrameValue> {
        &self.base
    }

    pub fn plan(&self) -> &[Json] {
        &self.plan
    }

    /// The plan run, once per sketch mode: in sketch mode on a sample of its frame, and on the parent's answer
    /// where this ref extends one by ops with no GROUPBY among them (the guard reads the plan's own frame).
    pub fn flush(&self) -> Result<Rc<Flushed>, SolError> {
        let sketch = sketch() && !self.plan.is_empty();
        if let Some((s, r)) = &*self.flushed.borrow()
            && *s == sketch
        {
            return r.clone();
        }
        let r = if self.plan.is_empty() {
            Ok(Rc::new(Flushed::plain(self.base.clone())))
        } else {
            self.run(sketch).map(Rc::new)
        };
        *self.flushed.borrow_mut() = Some((sketch, r.clone()));
        r
    }

    fn run(&self, sketch: bool) -> Result<Flushed, SolError> {
        let rebased = self.parent.as_ref().filter(|p| {
            !p.plan.is_empty() && p.plan.len() < self.plan.len() && !self.plan[p.plan.len()..].iter().any(is_group_by)
        });
        let (input, tail) = match rebased {
            Some(p) => (Some(p.flush()?), &self.plan[p.plan.len()..]),
            None => (None, &self.plan[..]),
        };
        let (frame, in_factor, in_scaled, in_guard) = match &input {
            Some(f) => (f.frame.clone(), f.factor, f.scaled, f.guard.clone()),
            None => (self.base.clone(), 1.0, None, None),
        };
        // A frame made from a sample isn't sampled again.
        let (src, factor, inherited) =
            match (sketch && in_factor <= 1.0).then(|| sample_frame(&frame, SKETCH_SAMPLE_ROWS)).flatten() {
                Some(s) => {
                    let f = frame_row_count(&frame) as f64 / frame_row_count(&s) as f64;
                    if f <= 1.0 {
                        (frame, in_factor, in_scaled)
                    } else {
                        (Rc::new(s), f, None)
                    }
                }
                None => (frame, in_factor, in_scaled),
            };
        let ops = parse(tail)?;
        count(|s| {
            s.runs += 1;
            s.ops += ops.len() as u32;
        });
        let mut f = src;
        let mut layout = None;
        // A sample's first GROUPBY scales its sums and counts up to the whole at once, so every op after it (a filter
        // on a total, a computed column over one) reads whole-table numbers. Later GROUPBYs group the groups, which
        // are no sample, so they aren't scaled again; nor is a plan rebased on a frame already scaled.
        let mut scaled = inherited;
        for (k, op) in ops.iter().enumerate() {
            f = Rc::new(match op {
                FrameOp::Pivot(spec) if ops[k + 1..].iter().all(|o| matches!(o, FrameOp::Formats { .. })) => {
                    let (out, l) = pivot_frame(&f, spec)?;
                    layout = Some(l);
                    out
                }
                _ => apply_verb(&f, op)?,
            });
            if factor > 1.0 && scaled.is_none() && is_group_by(&tail[k]) {
                f = Rc::new(scale_sums(&f, &tail[k], factor));
                scaled = Some(factor);
            }
        }
        let last_group_by = tail.iter().rev().find(|op| is_group_by(op));
        let aggs: Vec<(String, String, String)> = last_group_by
            .and_then(|g| g.get("aggs"))
            .and_then(Json::as_array)
            .map(|a| {
                a.iter()
                    .map(|x| {
                        let s = |k: &str| x.get(k).and_then(Json::as_str).unwrap_or("").to_string();
                        (s("as"), s("column"), s("op"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let guard = match last_group_by {
            Some(_) => Some(Rc::new(Guard {
                base: self.base.clone(),
                aggs: aggs.iter().map(|(as_, col, _)| (as_.clone(), col.clone())).collect(),
            })),
            None => in_guard,
        };
        Ok(Flushed { frame: f, factor, scaled, guard, layout })
    }

    /// What a reader kept beside the ref for the sketch mode now, made with `make` on first ask.
    pub fn kept<T: Any>(&self, key: &'static str, make: impl FnOnce() -> Rc<T>) -> Rc<T> {
        let sketch = sketch() && !self.plan.is_empty();
        if let Some(v) =
            self.memo.borrow().iter().find(|(s, k, _)| *s == sketch && *k == key).map(|(_, _, v)| v.clone())
            && let Ok(v) = v.downcast::<T>()
        {
            return v;
        }
        let v = make();
        let mut memo = self.memo.borrow_mut();
        memo.retain(|(s, k, _)| !(*s == sketch && *k == key));
        memo.push((sketch, key, v.clone() as Rc<dyn Any>));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::FrameColType;
    use serde_json::json;

    fn nums(name: &str, xs: impl IntoIterator<Item = f64>) -> FrameColumn {
        FrameColumn::new(name, FrameColType::Number, xs.into_iter().map(FrameCell::Num).collect())
    }

    fn values(c: &FrameColumn) -> Vec<f64> {
        c.values.iter().map(|v| if let FrameCell::Num(n) = v { *n } else { f64::NAN }).collect()
    }

    #[test]
    fn a_ref_extending_another_runs_only_its_own_ops_on_the_others_answer() {
        let base = Rc::new(FrameValue { columns: vec![nums("a", [3.0, 1.0, 2.0])] });
        let sorted = FrameRef::source(base.clone()).then(json!({ "kind": "sort", "by": "a", "dir": "asc" }));
        let head = sorted.then(json!({ "kind": "head", "n": 2 }));
        let s = sorted.flush().unwrap();
        let h = head.flush().unwrap();
        assert_eq!(values(&h.frame.columns[0]), [1.0, 2.0]);
        assert!(Rc::ptr_eq(&s, &sorted.flush().unwrap()), "a flush is kept");
        assert!(
            Rc::ptr_eq(&FrameRef::source(base.clone()).flush().unwrap().frame, &base),
            "an empty plan is its frame"
        );
    }

    #[test]
    fn a_failing_plan_answers_its_error_and_keeps_it() {
        let base = Rc::new(FrameValue { columns: vec![nums("a", [1.0])] });
        let r = FrameRef::source(base).then(json!({ "kind": "sort", "by": "nope", "dir": "asc" }));
        assert_eq!(r.flush().err().map(|e| e.code), Some(ErrorCode::Ref));
    }

    #[test]
    fn a_sketch_flush_samples_and_scales_a_groupbys_sums() {
        let n = 50_000;
        let base = Rc::new(FrameValue {
            columns: vec![
                FrameColumn::new("k", FrameColType::String, (0..n).map(|_| FrameCell::str("x")).collect()),
                nums("v", (0..n).map(|_| 1.0)),
            ],
        });
        let r = FrameRef::source(base)
            .then(json!({ "kind": "groupBy", "keys": ["k"], "aggs": [{ "column": "v", "op": "sum", "as": "v" }] }));
        set_sketch(true);
        let f = r.flush().unwrap();
        set_sketch(false);
        assert_eq!(f.approx(), Some(5.0));
        let read = f.finish(f.frame.columns.clone());
        assert_eq!(values(&read[1]), [n as f64]);
        assert_eq!(values(&r.flush().unwrap().frame.columns[1]), [n as f64], "exact again out of sketch mode");
    }

    #[test]
    fn an_aggregates_overflow_is_an_error_unless_its_input_was_infinite() {
        let base = Rc::new(FrameValue { columns: vec![nums("k", [1.0, 1.0]), nums("v", [f64::MAX, f64::MAX])] });
        let r = FrameRef::source(base)
            .then(json!({ "kind": "groupBy", "keys": ["k"], "aggs": [{ "column": "v", "op": "sum", "as": "v" }] }));
        let f = r.flush().unwrap();
        let read = f.finish(f.frame.columns.clone());
        assert!(read[1].values[0].is_err());
    }

    #[test]
    fn an_op_reads_as_javascript_handed_it_on() {
        assert_eq!(as_js(&json!({ "n": { "__nf": "inf" }, "to": { "__undef": 1 } })), Some(json!({ "n": null })));
    }

    #[test]
    fn ops_after_a_sampled_groupby_read_whole_table_totals() {
        let n = 50_000;
        let base = Rc::new(FrameValue {
            columns: vec![
                FrameColumn::new(
                    "k",
                    FrameColType::String,
                    (0..n).map(|i| FrameCell::str(if i % 5 < 3 { "a" } else { "b" })).collect(),
                ),
                nums("v", (0..n).map(|_| 1.0)),
            ],
        });
        let grouped = FrameRef::source(base)
            .then(json!({ "kind": "groupBy", "keys": ["k"], "aggs": [{ "column": "v", "op": "sum", "as": "v" }] }));
        let r = grouped.then(json!({ "kind": "filter", "column": "v", "op": "gt", "value": 25000 }));
        let regrouped = grouped
            .then(json!({ "kind": "groupBy", "keys": [], "aggs": [{ "column": "v", "op": "sum", "as": "total" }] }));
        set_sketch(true);
        let (f, g) = (r.flush().unwrap(), regrouped.flush().unwrap());
        set_sketch(false);
        assert_eq!(frame_row_count(&f.frame), 1, "the filter keeps the group whose whole-table total passes");
        assert_eq!(f.approx(), Some(5.0));
        assert_eq!(values(&g.frame.columns[0]), [n as f64], "a second GROUPBY sums the scaled totals once");
    }
}
