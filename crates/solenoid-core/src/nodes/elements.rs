//! [[C76]] formulaPackDefault, [[C17]] shareImpl, [[C25]] firstClassUnits, [[C24]] arraySemantics.
//! The periodic table and the Element card, from PubChem's periodic table with IUPAC conventional atomic weights,
//! frozen in `data/elements.json` (`docs/node-coverage.md` § Packs, Element).

use super::columns::unit_json;
use super::frames::frame_v;
use super::values::Column;
use super::Cv;
use super::{err, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::frame::FrameColType;
use crate::unit_dims::Dim;
use std::rc::Rc;

/// One element as `data/elements.json` holds it: ionization energy and electron affinity in kJ/mol (from eV), a
/// property nobody has measured blank, and an "Ancient" discovery no year.
#[derive(serde::Deserialize)]
pub(crate) struct Element {
    pub n: u32,
    pub symbol: String,
    pub name: String,
    pub mass: f64,
    pub category: String,
    pub group: Option<f64>,
    pub period: f64,
    pub block: String,
    pub config: String,
    pub electronegativity: Option<f64>,
    pub radius: Option<f64>,
    pub ionization: Option<f64>,
    pub affinity: Option<f64>,
    pub oxidation: String,
    pub state: String,
    pub melting: Option<f64>,
    pub boiling: Option<f64>,
    pub density: Option<f64>,
    pub discovered: Option<f64>,
}

thread_local! {
    static TABLE: Rc<Vec<Element>> =
        Rc::new(serde_json::from_str(include_str!("../../data/elements.json")).expect("data/elements.json reads"));
}

/// Every element, by atomic number from 1.
pub(crate) fn table() -> Rc<Vec<Element>> {
    TABLE.with(Rc::clone)
}

/// The atomic number and weight of the element with this exact symbol (a formula's `Fe`, never `fe`).
pub(crate) fn element(symbol: &str) -> Option<(f64, f64)> {
    table().iter().find(|e| e.symbol == symbol).map(|e| (f64::from(e.n), e.mass))
}

/// An element by atomic number, or by symbol or name in any case; the index into `table()`.
pub(crate) fn find(v: &V) -> Option<usize> {
    match v {
        V::Num(n) => (*n >= 1.0 && *n <= 118.0 && n.fract() == 0.0).then(|| *n as usize - 1),
        V::Str(s) => {
            let t = s.trim();
            table().iter().position(|e| e.symbol.eq_ignore_ascii_case(t) || e.name.eq_ignore_ascii_case(t))
        }
        _ => None,
    }
}

/// A property's name (lowercase, as `ELEMENT` takes it), its column, and its unit as an FC unit id.
pub(crate) const PROPERTIES: [(&str, &str, Option<&str>); 19] = [
    ("number", "Z", None),
    ("symbol", "Symbol", None),
    ("name", "Name", None),
    ("mass", "Mass", Some("g/mol")),
    ("category", "Category", None),
    ("group", "Group", None),
    ("period", "Period", None),
    ("block", "Block", None),
    ("configuration", "Configuration", None),
    ("electronegativity", "Electronegativity", None),
    ("radius", "Radius", Some("pm")),
    ("ionization", "Ionization energy", Some("kJ/mol")),
    ("affinity", "Electron affinity", Some("kJ/mol")),
    ("oxidation", "Oxidation states", None),
    ("state", "State", None),
    ("melting", "Melting point", Some("K")),
    ("boiling", "Boiling point", Some("K")),
    ("density", "Density", Some("g/cm3")),
    ("discovered", "Discovered", None),
];

fn dim_of(unit: &str) -> Dim {
    let d = |pairs: &[(&str, f64)]| pairs.iter().map(|(k, e)| ((*k).to_string(), *e)).collect::<Dim>();
    match unit {
        "g/mol" => d(&[("mass", 1.0), ("amount", -1.0)]),
        "pm" => d(&[("length", 1.0)]),
        "kJ/mol" => d(&[("mass", 1.0), ("length", 2.0), ("time", -2.0), ("amount", -1.0)]),
        "K" => d(&[("temperature", 1.0)]),
        _ => d(&[("mass", 1.0), ("length", -3.0)]),
    }
}

const TEXT: [&str; 7] = ["symbol", "name", "category", "block", "configuration", "oxidation", "state"];

/// One property of one element, blank where it isn't known; numbers are in the property's unit.
pub(crate) fn property(e: &Element, key: &str) -> Option<V> {
    let num = |x: Option<f64>| Some(x.map_or(V::Null, V::Num));
    match key {
        "number" => num(Some(f64::from(e.n))),
        "symbol" => Some(V::str(&e.symbol)),
        "name" => Some(V::str(&e.name)),
        "mass" => num(Some(e.mass)),
        "category" => Some(V::str(&e.category)),
        "group" => num(e.group),
        "period" => num(Some(e.period)),
        "block" => Some(V::str(&e.block)),
        "configuration" => Some(V::str(&e.config)),
        "electronegativity" => num(e.electronegativity),
        "radius" => num(e.radius),
        "ionization" => num(e.ionization),
        "affinity" => num(e.affinity),
        "oxidation" => Some(V::str(&e.oxidation)),
        "state" => Some(V::str(&e.state)),
        "melting" => num(e.melting),
        "boiling" => num(e.boiling),
        "density" => num(e.density),
        "discovered" => num(e.discovered),
        _ => None,
    }
}

fn not_found(v: &V) -> V {
    match v {
        V::Num(n) => err(ErrorCode::Value, format!("No element has the atomic number {n}")),
        V::Str(s) => err(ErrorCode::Value, format!("No element is called {}", s.trim())),
        _ => err(ErrorCode::Value, "An element is a symbol, a name or an atomic number"),
    }
}

/// The Element card: the card's own pick, or each wired symbol, name or atomic number, one row per element of the
/// Elements frame, its weight and atomic number beside it.
pub(super) fn element_node(c: &mut Call) -> Answer {
    let (picks, scalar) = if c.wired("symbol").is_some() {
        match c.read("symbol") {
            V::List(xs) => (xs.to_vec(), false),
            v => (vec![v], true),
        }
    } else {
        let own = c.field_str("symbol", "H").to_string();
        if find(&V::str(&own)).is_none() {
            return Err(err(ErrorCode::Value, format!("No element has the symbol {own}")));
        }
        (vec![V::str(&own)], true)
    };
    let all = table();
    let rows: Vec<Result<Option<&Element>, V>> = picks
        .iter()
        .map(|p| match p {
            V::Null | V::Undef => Ok(None),
            e if e.is_sol_error() => Err(e.clone()),
            v => find(v).map(|i| Some(&all[i])).ok_or_else(|| not_found(v)),
        })
        .collect();
    let cell = |r: &Result<Option<&Element>, V>, key: &str| match r {
        Ok(Some(e)) => property(e, key).unwrap_or(V::Null),
        Ok(None) => V::Null,
        Err(e) => e.clone(),
    };
    let columns = PROPERTIES
        .iter()
        .map(|(key, name, unit)| Column {
            name: (*name).to_string(),
            ty: if TEXT.contains(key) { FrameColType::String } else { FrameColType::Number },
            values: rows.iter().map(|r| cell(r, key)).collect(),
            unit: unit.map(|u| unit_json(&dim_of(u), Some(u))),
            format: None,
            raw: None,
        })
        .collect();
    let frame = frame_v(columns);
    c.show("cachedResult", frame.clone());
    let out = |key: &str| {
        let vals: Vec<V> = rows.iter().map(|r| cell(r, key)).collect();
        Cv::from(if scalar { vals.into_iter().next().unwrap_or(V::Null) } else { V::List(Rc::new(vals)) })
    };
    Ok(vec![("mass".into(), out("mass")), ("number".into(), out("number")), ("elements".into(), frame)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_whole_and_in_order() {
        let t = table();
        assert_eq!(t.len(), 118);
        assert!(t.iter().enumerate().all(|(i, e)| e.n as usize == i + 1));
        assert_eq!(element("Fe"), Some((26.0, 55.845)));
        assert_eq!(element("fe"), None);
        assert_eq!(find(&V::str("iron")), Some(25));
        assert_eq!(find(&V::str(" og ")), Some(117));
        assert_eq!(find(&V::Num(1.0)), Some(0));
        assert_eq!(find(&V::Num(119.0)), None);
    }

    #[test]
    fn every_property_answers_for_every_element() {
        for e in table().iter() {
            for (key, _, _) in PROPERTIES {
                assert!(property(e, key).is_some(), "{} {key}", e.symbol);
            }
        }
    }
}
