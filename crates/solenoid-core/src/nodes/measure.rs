//! [[C25]] firstClassUnits. The unit the optimization cards (Greedy Queue, Local Search, Solver, Assignment, Shortest
//! Path, Staffing) read off a column or a value and put back on what they answer: they compute in base SI, refuse
//! two quantities of different dimensions with `#UNIT!`, and show a total in the unit its column shows
//! (`tree/specs/values/unit-flow.md` § Optimization cards).

use super::frames::{cell_column_unit, tag_cell_unit};
use super::{err, Column};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::frame::FrameColType;
use crate::unit_dims::{dim_div, dim_equal, is_dimensionless, Dim, UnitCell};
use std::rc::Rc;

/// A quantity's unit: its dimension, the display unit a number is read in, and that unit's size in base SI.
#[derive(Clone)]
pub(crate) struct Measure {
    pub dim: Dim,
    one: Option<Rc<UnitCell>>,
}

impl Measure {
    /// A plain number.
    pub fn none() -> Measure {
        Measure { dim: Dim::default(), one: None }
    }

    /// A column's unit: its cells are numbers in it.
    pub fn of_column(col: &Column) -> Measure {
        match col.unit.as_ref().map(|u| tag_cell_unit(&V::Num(1.0), u)) {
            Some(V::Unit(u)) => Measure { dim: u.dim.clone(), one: Some(u) },
            _ => Measure::none(),
        }
    }

    /// A value's unit, and the value in base SI; a plain number is itself.
    pub fn of_value(v: &V) -> Option<(f64, Measure)> {
        match v {
            V::Num(n) | V::Date(n) => Some((*n, Measure::none())),
            V::Bool(b) => Some((f64::from(u8::from(*b)), Measure::none())),
            V::Unit(u) => {
                let one = Rc::new(UnitCell { value: u.scale.unwrap_or(1.0), ..(**u).clone() });
                Some((u.value, Measure { dim: u.dim.clone(), one: Some(one) }))
            }
            _ => None,
        }
    }

    /// A catalog unit by its display id, `min` say.
    pub fn named(id: &str) -> Measure {
        let json = serde_json::json!({ "display": id });
        match tag_cell_unit(&V::Num(1.0), &json) {
            V::Unit(u) => Measure { dim: u.dim.clone(), one: Some(u) },
            _ => Measure::none(),
        }
    }

    pub fn plain(&self) -> bool {
        is_dimensionless(&self.dim)
    }

    pub fn same(&self, o: &Measure) -> bool {
        dim_equal(&self.dim, &o.dim)
    }

    fn scale(&self) -> f64 {
        self.one.as_ref().map_or(1.0, |u| u.value)
    }

    /// A number this unit's column shows, in base SI.
    pub fn base(&self, shown: f64) -> f64 {
        shown * self.scale()
    }

    /// A base SI amount as this unit shows it.
    pub fn shown(&self, base: f64) -> f64 {
        base / self.scale()
    }

    /// A base SI amount as a value carrying this unit.
    pub fn value(&self, base: f64) -> V {
        match &self.one {
            Some(u) if !self.plain() => super::units::tag(base, self.dim.clone(), Some(u)),
            _ => V::Num(base),
        }
    }

    /// A column of base SI amounts, shown in this unit.
    pub fn column(&self, name: &str, base: impl Iterator<Item = Option<f64>>) -> Column {
        Column {
            name: name.into(),
            ty: FrameColType::Number,
            values: base.map(|b| b.map_or(V::Null, |b| V::Num(self.shown(b)))).collect(),
            unit: self.one.as_ref().filter(|_| !self.plain()).map(|u| cell_column_unit(u)),
            format: None,
            raw: None,
        }
    }

    /// The unit of one of this per one of `per`, in its derived form: a shadow price, $ per kg.
    pub fn per(&self, per: &Measure) -> Measure {
        let dim = dim_div(&self.dim, &per.dim);
        let one = (!is_dimensionless(&dim)).then(|| {
            Rc::new(UnitCell {
                value: 1.0,
                dim: dim.clone(),
                display: None,
                ratio: false,
                scale: None,
                offset: None,
                unit_dim: None,
            })
        });
        Measure { dim, one }
    }

    /// The unit's name, for a message.
    pub fn name(&self) -> String {
        if self.plain() {
            return "a plain number".into();
        }
        self.one.as_ref().and_then(|u| u.display.clone()).unwrap_or_else(|| crate::unit_lists::format_dim(&self.dim))
    }
}

/// The one unit two quantities that meet share, as arithmetic has it: a plain number takes the other's unit (5 km + 2
/// is 7 km); two dimensions that differ, or two currencies, are `#UNIT!` naming both.
pub(crate) fn meet(a: &Measure, b: &Measure, what: &str) -> Result<Measure, V> {
    let differ = || err(ErrorCode::Unit, format!("{what}: {} and {} don't add up", a.name(), b.name()));
    if a.plain() {
        return Ok(b.clone());
    }
    if b.plain() {
        return Ok(a.clone());
    }
    if !a.same(b) {
        return Err(differ());
    }
    let currency = |m: &Measure| m.dim.contains_key("currency");
    let display = |m: &Measure| m.one.as_ref().and_then(|u| u.display.clone());
    if currency(a) && display(a) != display(b) {
        return Err(differ());
    }
    Ok(a.clone())
}
