// [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation, [[C17]] shareImpl, [[C51]] formulaNaming
//! The built-in packs' formula functions (`src/graph/packs/*Formulas.ts`), on the kernels their cards' bodies use
//! (`nodes/packs.rs`). A pack being off hides its names from the menus, never from a formula.

use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{holds_text, num_blank_zero, value_text, V};
use crate::jsnum::{lower_text, round_half_up, trim_space};
use crate::nodes::geometry;
use crate::nodes::packs as k;

pub const NAMES: &[&str] = &[
    "ELEMENT",
    "MOLARMASS",
    "SUNPOSITION",
    "SUNRISE",
    "SUNSET",
    "DAYLENGTH",
    "MOONPHASE",
    "PARALLELCOMBINE",
    "ESERIESVALUE",
    "AWGWIRE",
    "RESISTORCOLORCODE",
    "EMSPECTRUMBAND",
    "PHYSICSCONSTANT",
    "COLEBROOK",
    "PIPEROUGHNESS",
    "HEARTRATEZONES",
    "STANDARDATMOSPHERE",
    "ANTOINE",
    "ISIN",
    "TALLY",
    "TRIANGLESOLVER",
    "IS",
    "ISNOT",
    "ABOVE",
    "BELOW",
    "ATLEAST",
    "ATMOST",
    "BETWEEN",
    "SETUNION",
    "SETINTERSECT",
    "SETDIFFERENCE",
    "SETSYMDIFF",
    "SETEQUAL",
    "SETSUBSET",
    "SETSUPERSET",
    "SETDISJOINT",
];

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn nullish(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

fn err(code: ErrorCode, message: impl Into<String>) -> V {
    V::err(sol_error(code, message))
}

/// `Number(v)`, where it is finite.
fn finite(v: &V) -> Option<f64> {
    Some(num_blank_zero(v)).filter(|n| n.is_finite())
}

/// `v == null ? dflt : String(v).toLowerCase()`.
fn lower_or(v: &V, dflt: &str) -> String {
    if nullish(v) {
        dflt.to_string()
    } else {
        lower_text(&value_text(v)).into_owned()
    }
}

fn num_or_null(v: Option<f64>) -> V {
    v.map_or(V::Null, V::Num)
}

/// `Array.isArray(v) ? v : v == null ? [] : [v]`.
fn as_list(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.as_ref().clone(),
        v if nullish(v) => Vec::new(),
        v => vec![v.clone()],
    }
}

/// `geo`: the moment, latitude and longitude as numbers, blank where one isn't, or the latitude's or longitude's
/// range error.
fn geo(a: &[V]) -> Result<(f64, f64, f64), V> {
    if (0..3).any(|i| nullish(arg(a, i))) {
        return Err(V::Null);
    }
    let (Some(w), Some(la), Some(lo)) = (finite(arg(a, 0)), finite(arg(a, 1)), finite(arg(a, 2))) else {
        return Err(V::Null);
    };
    match k::lat_lon_error(la, lo) {
        Some(e) => Err(e),
        None => Ok((w, la, lo)),
    }
}

/// Each function's number arguments: text there is #VALUE!, never read as a blank ([[C10]] socketLattice).
const NUMBER_ARGS: &[(&str, &[usize])] = &[
    ("SUNPOSITION", &[0, 1, 2]),
    ("SUNRISE", &[0, 1, 2]),
    ("SUNSET", &[0, 1, 2]),
    ("DAYLENGTH", &[0, 1, 2]),
    ("MOONPHASE", &[0]),
    ("ESERIESVALUE", &[0]),
    ("AWGWIRE", &[0]),
    ("EMSPECTRUMBAND", &[0, 1]),
    ("COLEBROOK", &[0, 1]),
    ("HEARTRATEZONES", &[0, 1]),
    ("STANDARDATMOSPHERE", &[0]),
    ("ANTOINE", &[1]),
    ("TRIANGLESOLVER", &[0, 1, 2, 3, 4, 5, 6, 7]),
];

pub fn call(name: &str, a: &[V]) -> V {
    let numbers = NUMBER_ARGS.iter().find(|(n, _)| *n == name).map_or(&[][..], |(_, i)| *i);
    if let Some(i) = numbers.iter().find(|&&i| holds_text(arg(a, i))) {
        return err(ErrorCode::Value, format!("{name} takes a number, not text, as argument {}", i + 1));
    }
    match name {
        "ELEMENT" => element(arg(a, 0), arg(a, 1)),
        "MOLARMASS" => match arg(a, 0) {
            v if nullish(v) => V::Null,
            v => {
                let s = value_text(v);
                if trim_space(&s).is_empty() {
                    V::Null
                } else {
                    k::molar_mass(&s)
                }
            }
        },
        "SUNPOSITION" => match geo(a) {
            Err(v) => v,
            Ok((w, la, lo)) => {
                let p = lower_or(arg(a, 3), "elevation");
                let [elevation, azimuth, declination] = k::solar_position_of(w, la, lo);
                match p.as_str() {
                    "elevation" => V::Num(elevation),
                    "azimuth" => V::Num(azimuth),
                    "declination" => V::Num(declination),
                    _ => err(ErrorCode::Value, format!("Unknown part \"{p}\". Use elevation, azimuth or declination")),
                }
            }
        },
        "SUNRISE" | "SUNSET" | "DAYLENGTH" => match geo(a) {
            Err(v) => v,
            Ok((w, la, lo)) => {
                let (rise, set, length) = k::sun_times(w, la, lo);
                match name {
                    "SUNRISE" => num_or_null(rise),
                    "SUNSET" => num_or_null(set),
                    _ => V::Num(length),
                }
            }
        },
        "MOONPHASE" => {
            let when = arg(a, 0);
            let Some(w) = (if nullish(when) { None } else { finite(when) }) else { return V::Null };
            let p = lower_or(arg(a, 1), "phase");
            let [phase, age, illumination] = k::moon_phase_of(w);
            match p.as_str() {
                "phase" => V::Num(phase),
                "age" => V::Num(age),
                "illumination" => V::Num(illumination),
                _ => err(ErrorCode::Value, format!("Unknown part \"{p}\". Use phase, age or illumination")),
            }
        }
        "PARALLELCOMBINE" => {
            let cells: Vec<V> = a.iter().flat_map(as_list).collect();
            k::parallel_combine_of(&cells)
        }
        "ESERIESVALUE" => {
            let value = arg(a, 0);
            let Some(v) = (if nullish(value) { None } else { finite(value) }) else { return V::Null };
            let series = arg(a, 1);
            let s = if nullish(series) { "E24".to_string() } else { value_text(series).to_uppercase() };
            let Some(table) = k::e_series_table(&s) else {
                return err(ErrorCode::Value, format!("Unknown E-series \"{s}\". Use E3, E6, E12, E24, E48 or E96"));
            };
            if v <= 0.0 {
                return err(ErrorCode::Domain, "A component value must be a positive number");
            }
            V::Num(k::nearest_e_series(v, &table))
        }
        "AWGWIRE" => {
            let gauge = arg(a, 0);
            let Some(n) = (if nullish(gauge) { None } else { finite(gauge) }) else { return V::Null };
            let p = lower_or(arg(a, 1), "diameter");
            if !matches!(p.as_str(), "diameter" | "area" | "resistance" | "ampacity") {
                return err(
                    ErrorCode::Value,
                    format!("Unknown property \"{p}\". Use diameter, area, resistance or ampacity"),
                );
            }
            if !(-3.0..=40.0).contains(&n) {
                return err(ErrorCode::Domain, "AWG runs 4/0 (enter -3) through 40");
            }
            let d = 0.127 * libm::pow(92.0, (36.0 - n) / 39.0);
            let area = (std::f64::consts::PI / 4.0) * d * d;
            match p.as_str() {
                "diameter" => V::Num(d),
                "area" => V::Num(area),
                "resistance" => V::Num(17.24 / area),
                _ => num_or_null(if n == n.trunc() { k::awg_ampacity(n) } else { None }),
            }
        }
        "RESISTORCOLORCODE" => {
            if a.iter().any(nullish) {
                return V::Null;
            }
            let c: Vec<Option<String>> = a.iter().map(|b| Some(lower_text(&value_text(b)).into_owned())).collect();
            let band = |i: usize| c.get(i).cloned().flatten();
            let r = if c.len() == 5 {
                k::decode_resistor(&[band(0), band(1), band(2)], band(3), band(4))
            } else {
                k::decode_resistor(&[band(0), band(1)], band(2), band(3))
            };
            r.map_or_else(|e| e, |(ohms, _)| V::Num(ohms))
        }
        "EMSPECTRUMBAND" => {
            let num = |v: &V| if let V::Num(n) = v { Some(*n).filter(|n| n.is_finite()) } else { None };
            let fq = num(arg(a, 0))
                .or_else(|| num(arg(a, 1)).map(|wl| if wl > 0.0 { k::LIGHT_SPEED / wl } else { f64::NAN }));
            match fq {
                None => V::Null,
                Some(fq) if !(fq > 0.0) || !fq.is_finite() => {
                    err(ErrorCode::Domain, "Needs a positive frequency or wavelength")
                }
                Some(fq) => V::str(k::em_band(k::LIGHT_SPEED / fq)),
            }
        }
        "PHYSICSCONSTANT" => match arg(a, 0) {
            v if nullish(v) => V::Null,
            v => {
                let id = value_text(v);
                k::physics_constant_value(&id).map_or_else(
                    || {
                        err(
                            ErrorCode::Name,
                            format!("Unknown constant \"{id}\". Try c, G, h, e, kb or na (case matters)"),
                        )
                    },
                    V::Num,
                )
            }
        },
        "COLEBROOK" => {
            if nullish(arg(a, 0)) || nullish(arg(a, 1)) {
                return V::Null;
            }
            let (Some(re), Some(rr)) = (finite(arg(a, 0)), finite(arg(a, 1))) else { return V::Null };
            if re <= 0.0 || rr < 0.0 || rr >= 1.0 {
                err(ErrorCode::Domain, "Needs Re > 0 and relative roughness 0 ≤ ε/D < 1")
            } else if re < 2300.0 {
                V::Num(64.0 / re)
            } else {
                V::Num(k::colebrook_f(re, rr))
            }
        }
        "PIPEROUGHNESS" => match arg(a, 0) {
            v if nullish(v) => V::Null,
            v => {
                let id = value_text(v);
                k::pipe_roughness_mm(&id).map_or_else(
                    || err(ErrorCode::Name, format!("Unknown material \"{id}\". Try pvc, copper, steel or castiron")),
                    V::Num,
                )
            }
        },
        "HEARTRATEZONES" => {
            let max = arg(a, 0);
            let Some(m) = (if nullish(max) { None } else { finite(max) }) else { return V::Null };
            let resting = arg(a, 1);
            let r = if nullish(resting) { None } else { finite(resting) };
            if !(m > 0.0 && r.is_none_or(|r| r > 0.0 && r < m)) {
                return err(ErrorCode::Domain, "Needs max HR > 0 and resting HR below it");
            }
            let at = |pct: f64| {
                V::Num(round_half_up(match r {
                    Some(r) => r + pct * (m - r),
                    None => pct * m,
                }))
            };
            V::List(Rc::new(k::ZONES.iter().map(|z| V::List(Rc::new(vec![at(z.1), at(z.2)]))).collect()))
        }
        "STANDARDATMOSPHERE" => {
            let alt = arg(a, 0);
            let Some(z) = (if nullish(alt) { None } else { finite(alt) }) else { return V::Null };
            let key = lower_or(arg(a, 1), "pressure");
            let field = match key.as_str() {
                "temp" | "temperature" => 0,
                "pressure" => 1,
                "density" => 2,
                "sound" => 3,
                _ => {
                    return err(
                        ErrorCode::Value,
                        format!("Unknown property \"{key}\". Use temp, pressure, density or sound"),
                    );
                }
            };
            match k::standard_atmosphere(z) {
                Ok(pt) => V::Num(pt[field]),
                Err(e) => e,
            }
        }
        "ANTOINE" => {
            if nullish(arg(a, 0)) || nullish(arg(a, 1)) {
                return V::Null;
            }
            let id = value_text(arg(a, 0));
            let Some((ca, cb, cc)) = k::antoine_coefficients(&id) else {
                return err(ErrorCode::Name, format!("Unknown substance \"{id}\". Try water, ethanol or acetone"));
            };
            let Some(tc) = finite(arg(a, 1)) else { return V::Null };
            if tc <= -cc {
                err(ErrorCode::Domain, "Below the equation's temperature range")
            } else {
                V::Num(k::MMHG_TO_PA * libm::pow(10.0, ca - cb / (cc + tc)))
            }
        }
        // The Sets pack's tests and set operations ([[D124]] comparisonFunctions): its cards call these too.
        "IS" | "ISNOT" | "ABOVE" | "BELOW" | "ATLEAST" | "ATMOST" => {
            let op = crate::compare::function_op(name).expect("a comparison function");
            crate::compare::compare(op, arg(a, 0), arg(a, 1))
        }
        "BETWEEN" => crate::compare::between(arg(a, 0), arg(a, 1), arg(a, 2)),
        "SETUNION" | "SETINTERSECT" | "SETDIFFERENCE" | "SETSYMDIFF" | "SETEQUAL" | "SETSUBSET" | "SETSUPERSET"
        | "SETDISJOINT" => crate::fns_lists::call(name, a).unwrap_or_else(|t| V::err(t.0)),
        "ISIN" => {
            use crate::fns_matrix::set_key;
            let members: std::collections::HashSet<_> =
                as_list(arg(a, 1)).iter().filter(|v| !matches!(v, V::Null) && !v.is_sol_error()).map(set_key).collect();
            V::List(Rc::new(
                as_list(arg(a, 0))
                    .iter()
                    .map(|v| match v {
                        V::Null => V::Null,
                        e if e.is_sol_error() => e.clone(),
                        v => V::Bool(members.contains(&set_key(v))),
                    })
                    .collect(),
            ))
        }
        "TALLY" => {
            use crate::fns_matrix::set_key;
            let mut index = std::collections::HashMap::new();
            let mut counts: Vec<f64> = Vec::new();
            for v in as_list(arg(a, 0)).iter().filter(|v| !matches!(v, V::Null) && !v.is_sol_error()) {
                match index.get(&set_key(v)) {
                    Some(&i) => counts[i] += 1.0,
                    None => {
                        index.insert(set_key(v), counts.len());
                        counts.push(1.0);
                    }
                }
            }
            V::List(Rc::new(counts.into_iter().map(V::Num).collect()))
        }
        "TRIANGLESOLVER" => {
            let mut given: geometry::Parts = [None; 6];
            for (i, g) in given.iter_mut().enumerate() {
                if let V::Num(n) = arg(a, i)
                    && n.is_finite()
                {
                    *g = Some(*n);
                }
            }
            let size = |i: usize| match arg(a, i) {
                V::Num(n) if n.is_finite() => Some(*n),
                _ => None,
            };
            if given.iter().all(Option::is_none) && size(6).is_none() && size(7).is_none() {
                return V::Null;
            }
            V::List(Rc::new(geometry::solve_given_parts(&given, size(6), size(7), None).values.to_vec()))
        }
        _ => err(ErrorCode::Name, format!("Unknown function {name}")),
    }
}

/// `ELEMENT`: an element by atomic number, symbol or name, and one of the Element card's properties (mass when left
/// out), in that property's unit; a property nobody has measured is blank.
fn element(el: &V, property: &V) -> V {
    if nullish(el) {
        return V::Null;
    }
    let Some(i) = crate::nodes::elements::find(el) else {
        return err(ErrorCode::Name, format!("Unknown element \"{}\"", value_text(el)));
    };
    let p = lower_or(property, "mass");
    crate::nodes::elements::property(&crate::nodes::elements::table()[i], &p).unwrap_or_else(|| {
        let names: Vec<&str> = crate::nodes::elements::PROPERTIES.iter().map(|(k, _, _)| *k).collect();
        err(ErrorCode::Value, format!("Unknown property \"{p}\". Use {}", names.join(", ")))
    })
}
