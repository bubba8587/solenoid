// [[C25]] firstClassUnits
//! A display unit's dimension, scale and offset by its id: `fcUnitToUnit` (`unitBridge.ts`) over `parseUnit`
//! (`dimension.ts`), CONVERT's units and the currency codes, which the TS registers at start (`convert.ts`,
//! `fxProvider.ts`). A cell carries its own display unit's scale across the wire; this is for an id no cell carries
//! (a frame column's unit, a square of a side's unit, a unit a card applies). `fixtures/core/unit-catalog.json.gz` holds
//! the TS's answers for every id the app can name.

use crate::unit_dims::{dim_div, dim_mul, dim_pow, Dim};

#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub dim: Dim,
    pub scale: f64,
    pub offset: Option<f64>,
}

fn d(axes: &[(&str, f64)], scale: f64, offset: Option<f64>) -> Unit {
    Unit { dim: axes.iter().filter(|(_, e)| *e != 0.0).map(|(k, e)| (k.to_string(), *e)).collect(), scale, offset }
}

/// `UNITS` (`dimension.ts`), `L_vol` among them.
fn base_unit(sym: &str) -> Option<Unit> {
    use std::f64::consts::PI;
    let l = |n: f64| [("length", n)];
    Some(match sym {
        "1" => d(&[], 1.0, None),
        "%" => d(&[], 0.01, None),
        "m" => d(&l(1.0), 1.0, None),
        "in" => d(&l(1.0), 0.0254, None),
        "ft" => d(&l(1.0), 0.3048, None),
        "yd" => d(&l(1.0), 0.9144, None),
        "mi" => d(&l(1.0), 1609.344, None),
        "g" => d(&[("mass", 1.0)], 0.001, None),
        "kg" => d(&[("mass", 1.0)], 1.0, None),
        "t" => d(&[("mass", 1.0)], 1000.0, None),
        "lb" => d(&[("mass", 1.0)], 0.45359237, None),
        "oz" => d(&[("mass", 1.0)], 0.028349523125, None),
        "stone" => d(&[("mass", 1.0)], 6.35029318, None),
        "s" => d(&[("time", 1.0)], 1.0, None),
        "min" => d(&[("time", 1.0)], 60.0, None),
        "h" => d(&[("time", 1.0)], 3600.0, None),
        "day" => d(&[("time", 1.0)], 86400.0, None),
        "wk" => d(&[("time", 1.0)], 604800.0, None),
        "yr" => d(&[("time", 1.0)], 31557600.0, None),
        "A" => d(&[("current", 1.0)], 1.0, None),
        "mol" => d(&[("amount", 1.0)], 1.0, None),
        "cd" => d(&[("luminous", 1.0)], 1.0, None),
        "rad" => d(&[("angle", 1.0)], 1.0, None),
        "deg" => d(&[("angle", 1.0)], PI / 180.0, None),
        "grad" => d(&[("angle", 1.0)], PI / 200.0, None),
        "K" => d(&[("temperature", 1.0)], 1.0, None),
        "degC" => d(&[("temperature", 1.0)], 1.0, Some(273.15)),
        "degF" => d(&[("temperature", 1.0)], 5.0 / 9.0, Some(273.15 - (32.0 * 5.0) / 9.0)),
        "bit" => d(&[("information", 1.0)], 1.0, None),
        "byte" => d(&[("information", 1.0)], 8.0, None),
        "¤" => d(&[("currency", 1.0)], 1.0, None),
        "Hz" => d(&[("time", -1.0)], 1.0, None),
        "N" => d(&[("mass", 1.0), ("length", 1.0), ("time", -2.0)], 1.0, None),
        "Pa" => d(&[("mass", 1.0), ("length", -1.0), ("time", -2.0)], 1.0, None),
        "J" => d(&[("mass", 1.0), ("length", 2.0), ("time", -2.0)], 1.0, None),
        "W" => d(&[("mass", 1.0), ("length", 2.0), ("time", -3.0)], 1.0, None),
        "L_vol" => d(&l(3.0), 0.001, None),
        _ => return None,
    })
}

/// `SI_PREFIXES` in its key order, `da` first as `resolveSymbol` tries it.
const PREFIXES: &[(&str, f64)] = &[
    ("da", 1e1),
    ("Y", 1e24),
    ("Z", 1e21),
    ("E", 1e18),
    ("P", 1e15),
    ("T", 1e12),
    ("G", 1e9),
    ("M", 1e6),
    ("k", 1e3),
    ("h", 1e2),
    ("d", 1e-1),
    ("c", 1e-2),
    ("m", 1e-3),
    ("u", 1e-6),
    ("µ", 1e-6),
    ("n", 1e-9),
    ("p", 1e-12),
    ("f", 1e-15),
    ("a", 1e-18),
    ("z", 1e-21),
    ("y", 1e-24),
];

fn linear(u: &Unit) -> bool {
    u.offset.is_none_or(|o| o == 0.0)
}

fn resolve_symbol(sym: &str) -> Option<Unit> {
    if let Some(u) = base_unit(sym) {
        return Some(u);
    }
    if sym == "L" || sym == "l" {
        return base_unit("L_vol");
    }
    for (p, f) in PREFIXES {
        if sym.chars().count() > p.chars().count() && sym.starts_with(p) {
            let rest = &sym[p.len()..];
            let base = base_unit(rest).or_else(|| if rest == "L" || rest == "l" { base_unit("L_vol") } else { None });
            if let Some(b) = base.filter(linear) {
                return Some(Unit { dim: b.dim, scale: b.scale * f, offset: None });
            }
        }
    }
    None
}

fn unit_mul(a: &Unit, b: &Unit) -> Option<Unit> {
    (linear(a) && linear(b)).then(|| Unit { dim: dim_mul(&a.dim, &b.dim), scale: a.scale * b.scale, offset: None })
}

fn unit_pow(a: &Unit, n: f64) -> Option<Unit> {
    linear(a).then(|| Unit { dim: dim_pow(&a.dim, n), scale: crate::excel_functions::js_pow(a.scale, n), offset: None })
}

/// A symbol, with a power as `^n` or trailing digits.
fn parse_factor(tok: &str) -> Option<Unit> {
    let t = crate::jsnum::js_trim(tok);
    if t.is_empty() {
        return None;
    }
    let is_num = |s: &str, frac: bool| {
        let s = s.strip_prefix('-').unwrap_or(s);
        let (int, dec) = match s.split_once('.') {
            Some((i, f)) if frac => (i, Some(f)),
            _ => (s, None),
        };
        !int.is_empty()
            && int.bytes().all(|b| b.is_ascii_digit())
            && dec.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
    };
    let (mut sym, mut power) = (t, 1.0);
    if let Some((base, p)) = t.split_once('^').filter(|(b, p)| !b.is_empty() && !p.contains('^') && is_num(p, true)) {
        sym = base;
        power = p.parse().unwrap_or(f64::NAN);
    } else {
        // `^([A-Za-zµ¤%]+?)(-?\d+)$`: the shortest letters, then an optional minus and the digits to the end.
        let letters = |c: char| c.is_ascii_alphabetic() || c == 'µ' || c == '¤' || c == '%';
        let cut = t.char_indices().find(|&(_, c)| !letters(c)).map(|(i, _)| i);
        if let Some(i) = cut.filter(|&i| i > 0) {
            let tail = &t[i..];
            if is_num(tail, false) {
                sym = &t[..i];
                power = tail.parse().unwrap_or(f64::NAN);
            }
        }
    }
    let base = resolve_symbol(sym)?;
    if power == 1.0 {
        Some(base)
    } else {
        unit_pow(&base, power)
    }
}

fn parse_product(s: &str) -> Option<Unit> {
    let factors: Vec<&str> = s.split(['*', '·']).map(crate::jsnum::js_trim).filter(|f| !f.is_empty()).collect();
    if factors.is_empty() {
        return None;
    }
    let mut acc = d(&[], 1.0, None);
    for f in factors {
        acc = unit_mul(&acc, &parse_factor(f)?)?;
    }
    Some(acc)
}

pub fn parse_unit(expr: &str) -> Option<Unit> {
    let s = crate::jsnum::js_trim(expr);
    if s.is_empty() {
        return None;
    }
    if let Some(u) = resolve_symbol(s) {
        return Some(u);
    }
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() > 2 {
        return None;
    }
    let num = parse_product(parts[0])?;
    if parts.len() == 1 {
        return Some(num);
    }
    let den = parse_product(parts[1])?;
    (linear(&num) && linear(&den) && den.scale != 0.0).then(|| Unit {
        dim: dim_div(&num.dim, &den.dim),
        scale: num.scale / den.scale,
        offset: None,
    })
}

const CURRENCIES: &[&str] = &[
    "aud", "brl", "cad", "chf", "cny", "czk", "dkk", "eur", "gbp", "hkd", "huf", "idr", "ils", "inr", "isk", "jpy",
    "krw", "mxn", "myr", "nok", "nzd", "php", "pln", "ron", "sek", "sgd", "thb", "try", "usd", "zar",
];

/// A CONVERT unit's dimension as `convert_units.rs` spells it: `length-1 mass1 time-2`.
fn convert_dim(spec: &str) -> Dim {
    spec.split_whitespace()
        .filter_map(|axis| {
            let i = axis.find(|c: char| c == '-' || c.is_ascii_digit())?;
            Some((axis[..i].to_string(), axis[i..].parse::<f64>().ok()?))
        })
        .collect()
}

/// The direct table, then the parser (some ids through `PARSE_AS`), then the registered units.
pub fn fc_unit_to_unit(id: &str) -> Option<Unit> {
    if id.is_empty() || id == "none" || id == "custom" {
        return None;
    }
    let direct = match id {
        "usd" | "eur" | "gbp" | "jpy" => Some(d(&[("currency", 1.0)], 1.0, None)),
        "ha" => Some(d(&[("length", 2.0)], 10000.0, None)),
        "ac" => Some(d(&[("length", 2.0)], 4046.8564224, None)),
        "gal" => Some(d(&[("length", 3.0)], 0.003785411784, None)),
        _ => None,
    };
    if direct.is_some() {
        return direct;
    }
    let parse_as = match id {
        "hr" => "h",
        "ms1" => "m/s",
        "kmh" => "km/h",
        "mph" => "mi/h",
        "b" => "byte",
        "kb" => "kbyte",
        "mb" => "Mbyte",
        "gb" => "Gbyte",
        "tb" => "Tbyte",
        other => other,
    };
    if let Some(u) = parse_unit(parse_as) {
        return Some(u);
    }
    // Registered later wins (`Object.assign`): CONVERT's units, then the currencies.
    if CURRENCIES.contains(&id) {
        return Some(d(&[("currency", 1.0)], 1.0, None));
    }
    crate::convert_units::UNITS.iter().find(|(key, ..)| *key == id).map(|(_, _, dim, scale, offset)| Unit {
        dim: convert_dim(dim),
        scale: *scale,
        offset: *offset,
    })
}
