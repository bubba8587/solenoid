//! [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation, [[C17]] shareImpl, [[C15]] matricesInFormulas,
//! [[C44]] dateSerials, [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[C24]] arraySemantics. The small packs'
//! card bodies: `nodes/electrical.ts`, `chemistry.ts`, `physicsConstants.ts`, `astro.ts`, `thermo.ts`, `fluids.ts`,
//! `health.ts`, `emSpectrum.ts`, `convert.ts`, `tornado.ts` and `triangle.ts`, with the kernels of their `*Ops.ts`
//! beside them.

use crate::frame::FrameColType;
use crate::error_value::ErrorCode;
use super::units::{broadcast_unit, from_unit};
use super::values::{Column, Frame};
use super::{err, list, Answer, Call};
use crate::excel_functions::V;
use crate::fdlibm::{acos, asin, cos, exp, log, log10, pow, sin, tan};
use crate::jsnum::{math_max, math_min, math_round};
use crate::unit_catalog::fc_unit_to_unit;
use crate::unit_dims::{dim_equal, dim_pow, is_dimensionless, Dim, UnitCell};
use crate::unit_value::{round_at_larger_term, to_precision, unit_error};
use serde_json::Value as Json;
use std::f64::consts::PI;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ParallelCombineNode" => parallel_combine(c),
        "ESeriesNode" => e_series(c),
        "AwgNode" => awg(c),
        "ResistorCodeNode" => resistor_code(c),
        "ElementNode" => element_node(c),
        "MolarMassNode" => molar_mass_node(c),
        "PhysicsConstantNode" => physics_constant(c),
        "SolarPositionNode" => solar_position(c),
        "SunriseSunsetNode" => sunrise_sunset(c),
        "MoonPhaseNode" => moon_phase_node(c),
        "IsaAtmosphereNode" => isa_atmosphere(c),
        "AntoineNode" => antoine(c),
        "ColebrookNode" => colebrook(c),
        "PipeRoughnessNode" => pipe_roughness(c),
        "HrZonesNode" => hr_zones(c),
        "EmSpectrumNode" => em_spectrum_node(c),
        "ConvertNode" => convert(c),
        "TornadoNode" => tornado(c),
        "TriangleSolverNode" => triangle_solver(c),
        _ => return None,
    })
}

/// `inputs[key]?.[0] ?? null`.
fn first(c: &Call, key: &str) -> V {
    match c.wired(key).and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

/// `readInput(inputs[key], this.literals[key] ?? null)`.
fn read_or_null(c: &Call, key: &str) -> V {
    let lit = match c.literal(key) {
        V::Undef => V::Null,
        v => v,
    };
    c.read_input(key, lit)
}

fn number(v: &V) -> Option<f64> {
    if let V::Num(n) = v { Some(*n) } else { None }
}

/// The outputs in order, each also shown on the card under its field.
fn shown(c: &mut Call, outs: &[(&str, &str, V)]) -> Answer {
    for (_, field, v) in outs {
        c.show(field, v.clone());
    }
    Ok(outs.iter().map(|(k, _, v)| (k.to_string(), v.clone())).collect())
}

fn domain(message: &str) -> V {
    err(ErrorCode::Domain, message)
}

fn null_or(v: Option<f64>) -> V {
    v.map_or(V::Null, V::Num)
}

// ─── Electrical ────────────────────────────────────────────────────────────────

/// `parallelCombine`: the first error, else the reciprocal of the reciprocals' sum over the numbers.
fn parallel_combine_of(cells: &[V]) -> V {
    if let Some(e) = cells.iter().find(|v| v.is_sol_error()) {
        return e.clone();
    }
    let nums: Vec<f64> = cells.iter().filter_map(number).collect();
    if nums.is_empty() {
        return V::Null;
    }
    if nums.contains(&0.0) {
        return V::Num(0.0);
    }
    let sum = nums.iter().fold(0.0, |a, b| a + 1.0 / b);
    if sum == 0.0 {
        err(ErrorCode::DivZero, "The reciprocals cancel out, so the combination is undefined")
    } else {
        V::Num(1.0 / sum)
    }
}

fn parallel_combine(c: &mut Call) -> Answer {
    let result = match first(c, "list") {
        V::List(cells) => parallel_combine_of(&cells),
        _ => parallel_combine_of(&[]),
    };
    shown(c, &[("result", "cachedResult", result)])
}

const E24: [f64; 24] = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/// `E_SERIES[op]`: E3 to E24 are IEC 60063's published tables; E48 and E96 are generated.
fn e_series_table(op: &str) -> Option<Vec<f64>> {
    let generated = |n: f64| (0..n as usize).map(|k| to_precision(pow(10.0, k as f64 / n), 3)).collect();
    Some(match op {
        "E3" => vec![1.0, 2.2, 4.7],
        "E6" => vec![1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
        "E12" => E24.iter().step_by(2).copied().collect(),
        "E24" => E24.to_vec(),
        "E48" => generated(48.0),
        "E96" => generated(96.0),
        _ => return None,
    })
}

/// `nearestESeries`: the series value nearest on a log scale, in the value's decade or either neighbour.
fn nearest_e_series(value: f64, table: &[f64]) -> f64 {
    let decade = log10(value).floor();
    let (mut best, mut best_dist) = (f64::NAN, f64::INFINITY);
    for d in [decade - 1.0, decade, decade + 1.0] {
        for m in table {
            let cand = m * pow(10.0, d);
            let dist = log(value / cand).abs();
            if dist < best_dist {
                best_dist = dist;
                best = cand;
            }
        }
    }
    to_precision(best, 12)
}

fn e_series(c: &mut Call) -> Answer {
    let v = c.read_input("value", c.literal("value"));
    let (nearest, errpct) = match number(&v) {
        Some(v) if v > 0.0 && v.is_finite() => match e_series_table(c.field_str("op", "E24")) {
            Some(table) => {
                let n = nearest_e_series(v, &table);
                (V::Num(n), V::Num(((n - v) / v) * 100.0))
            }
            None => return Err(err(ErrorCode::Error, "E_SERIES[series] is not iterable")),
        },
        Some(_) => {
            let e = domain("A component value must be a positive number");
            (e.clone(), e)
        }
        None => (V::Null, V::Null),
    };
    shown(c, &[("nearest", "cachedNearest", nearest), ("errpct", "cachedError", errpct)])
}

/// `AWG_AMPACITY_75C`.
fn awg_ampacity(n: f64) -> Option<f64> {
    const TABLE: [(f64, f64); 13] = [
        (-3.0, 230.0), (-2.0, 200.0), (-1.0, 175.0), (0.0, 150.0), (1.0, 130.0), (2.0, 115.0), (3.0, 100.0),
        (4.0, 85.0), (6.0, 65.0), (8.0, 50.0), (10.0, 35.0), (12.0, 25.0), (14.0, 20.0),
    ];
    TABLE.iter().find(|(g, _)| *g == n).map(|(_, a)| *a)
}

fn awg(c: &mut Call) -> Answer {
    let n = c.read_input("gauge", c.literal("gauge"));
    let outs = match number(&n) {
        Some(n) if !(-3.0..=40.0).contains(&n) => {
            let e = domain("AWG runs 4/0 (enter -3) through 40");
            [e.clone(), e.clone(), e.clone(), e]
        }
        Some(n) => {
            let d = 0.127 * pow(92.0, (36.0 - n) / 39.0);
            let a = (PI / 4.0) * d * d;
            [V::Num(d), V::Num(a), V::Num(17.24 / a), null_or(if n == n.trunc() { awg_ampacity(n) } else { None })]
        }
        None => [V::Null, V::Null, V::Null, V::Null],
    };
    let [diameter, area, resistance, ampacity] = outs;
    shown(c, &[
        ("diameter", "cachedDiameter", diameter),
        ("area", "cachedArea", area),
        ("resistance", "cachedResistance", resistance),
        ("ampacity", "cachedAmpacity", ampacity),
    ])
}

// ─── Resistor code, elements, molar mass, physical constants ───────────────────

/// `decodeResistor`: the digit bands, the multiplier and the tolerance, each band by its colour.
fn resistor_code(c: &mut Call) -> Answer {
    let band = |k: &str| match c.string_literal(k) {
        V::Str(s) => Some(s.to_string()),
        _ => None,
    };
    let named = |b: &Option<String>| b.clone().unwrap_or_else(|| "undefined".into());
    let digit = |s: &str| ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "gray", "white"].iter().position(|d| *d == s);
    let five = c.field_str("bands", "4") == "5";
    let digits = if five { vec![band("b1"), band("b2"), band("b3")] } else { vec![band("b1"), band("b2")] };
    let decoded = (|| {
        let mut value = 0.0;
        for d in &digits {
            let Some(v) = d.as_deref().and_then(digit) else {
                return Err(err(ErrorCode::Value, format!("\"{}\" is not a digit band color", named(d))));
            };
            value = value * 10.0 + v as f64;
        }
        let mult = band("mult");
        let m = match mult.as_deref() {
            Some("gold") => 0.1,
            Some("silver") => 0.01,
            Some(s) => match digit(s) {
                Some(k) => [1.0, 10.0, 100.0, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9][k],
                None => return Err(err(ErrorCode::Value, format!("\"{}\" is not a multiplier band color", named(&mult)))),
            },
            None => return Err(err(ErrorCode::Value, "\"undefined\" is not a multiplier band color")),
        };
        let tol = band("tol");
        let t = match tol.as_deref() {
            Some("brown") => 1.0,
            Some("red") => 2.0,
            Some("green") => 0.5,
            Some("blue") => 0.25,
            Some("violet") => 0.1,
            Some("gray") => 0.05,
            Some("gold") => 5.0,
            Some("silver") => 10.0,
            _ => return Err(err(ErrorCode::Value, format!("\"{}\" is not a tolerance band color", named(&tol)))),
        };
        Ok((value * m, t))
    })();
    let (ohms, tol) = match decoded {
        Ok((o, t)) => (V::Num(o), V::Num(t)),
        Err(e) => (e.clone(), e),
    };
    shown(c, &[("ohms", "cachedOhms", ohms), ("tolerance", "cachedTol", tol)])
}

/// `ELEMENTS`: each element's symbol and standard atomic weight, by atomic number.
const ELEMENTS: [(&str, f64); 118] = [
    ("H", 1.008), ("He", 4.002602), ("Li", 6.94), ("Be", 9.0121831), ("B", 10.81), ("C", 12.011), ("N", 14.007), ("O", 15.999),
    ("F", 18.998403163), ("Ne", 20.1797), ("Na", 22.98976928), ("Mg", 24.305), ("Al", 26.9815385), ("Si", 28.085),
    ("P", 30.973761998), ("S", 32.06), ("Cl", 35.45), ("Ar", 39.948), ("K", 39.0983), ("Ca", 40.078), ("Sc", 44.955908),
    ("Ti", 47.867), ("V", 50.9415), ("Cr", 51.9961), ("Mn", 54.938044), ("Fe", 55.845), ("Co", 58.933194), ("Ni", 58.6934),
    ("Cu", 63.546), ("Zn", 65.38), ("Ga", 69.723), ("Ge", 72.63), ("As", 74.921595), ("Se", 78.971), ("Br", 79.904),
    ("Kr", 83.798), ("Rb", 85.4678), ("Sr", 87.62), ("Y", 88.90584), ("Zr", 91.224), ("Nb", 92.90637), ("Mo", 95.95),
    ("Tc", 98.0), ("Ru", 101.07), ("Rh", 102.9055), ("Pd", 106.42), ("Ag", 107.8682), ("Cd", 112.414), ("In", 114.818),
    ("Sn", 118.71), ("Sb", 121.76), ("Te", 127.6), ("I", 126.90447), ("Xe", 131.293), ("Cs", 132.90545196), ("Ba", 137.327),
    ("La", 138.90547), ("Ce", 140.116), ("Pr", 140.90766), ("Nd", 144.242), ("Pm", 145.0), ("Sm", 150.36), ("Eu", 151.964),
    ("Gd", 157.25), ("Tb", 158.92535), ("Dy", 162.5), ("Ho", 164.93033), ("Er", 167.259), ("Tm", 168.93422), ("Yb", 173.045),
    ("Lu", 174.9668), ("Hf", 178.49), ("Ta", 180.94788), ("W", 183.84), ("Re", 186.207), ("Os", 190.23), ("Ir", 192.217),
    ("Pt", 195.084), ("Au", 196.966569), ("Hg", 200.592), ("Tl", 204.38), ("Pb", 207.2), ("Bi", 208.9804), ("Po", 209.0),
    ("At", 210.0), ("Rn", 222.0), ("Fr", 223.0), ("Ra", 226.0), ("Ac", 227.0), ("Th", 232.0377), ("Pa", 231.03588),
    ("U", 238.02891), ("Np", 237.0), ("Pu", 244.0), ("Am", 243.0), ("Cm", 247.0), ("Bk", 247.0), ("Cf", 251.0), ("Es", 252.0),
    ("Fm", 257.0), ("Md", 258.0), ("No", 259.0), ("Lr", 266.0), ("Rf", 267.0), ("Db", 268.0), ("Sg", 269.0), ("Bh", 270.0),
    ("Hs", 269.0), ("Mt", 278.0), ("Ds", 281.0), ("Rg", 282.0), ("Cn", 285.0), ("Nh", 286.0), ("Fl", 289.0), ("Mc", 290.0),
    ("Lv", 293.0), ("Ts", 294.0), ("Og", 294.0),
];

/// `ELEMENT_BY_SYMBOL`: the atomic number and weight.
fn element(symbol: &str) -> Option<(f64, f64)> {
    ELEMENTS.iter().position(|(s, _)| *s == symbol).map(|i| ((i + 1) as f64, ELEMENTS[i].1))
}

fn element_node(c: &mut Call) -> Answer {
    let Some((n, mass)) = element(c.field_str("symbol", "H")) else {
        return Err(super::frames::thrown("Cannot read properties of undefined (reading 'mass')"));
    };
    Ok(vec![("mass".into(), V::Num(mass)), ("number".into(), V::Num(n))])
}

/// `^\d+(?:\.\d+)?` at `i`: the count's length and value, or none.
fn count_at(s: &[u16], i: usize) -> Option<(usize, f64)> {
    let digit = |k: usize| s.get(k).is_some_and(|c| (u16::from(b'0')..=u16::from(b'9')).contains(c));
    let mut j = i;
    while digit(j) {
        j += 1;
    }
    if j == i {
        return None;
    }
    if s.get(j) == Some(&u16::from(b'.')) && digit(j + 1) {
        j += 1;
        while digit(j) {
            j += 1;
        }
    }
    Some((j - i, crate::jsnum::string_to_number(&String::from_utf16_lossy(&s[i..j]))))
}

fn unit_text(u: Option<&u16>) -> String {
    u.map_or_else(|| "undefined".into(), |u| String::from_utf16_lossy(&[*u]))
}

/// `parseGroup`: a run of elements and bracketed groups, each with its count, to `close`.
fn parse_group(s: &[u16], mut i: usize, close: Option<u16>) -> Result<(f64, usize), V> {
    let upper = |u: u16| (u16::from(b'A')..=u16::from(b'Z')).contains(&u);
    let lower = |u: u16| (u16::from(b'a')..=u16::from(b'z')).contains(&u);
    let unbalanced = || err(ErrorCode::Value, "Unbalanced brackets in formula");
    let mut mass = 0.0;
    while i < s.len() {
        let ch = s[i];
        if Some(ch) == close {
            return Ok((mass, i));
        }
        if ch == u16::from(b'(') || ch == u16::from(b'[') {
            let shut = u16::from(if ch == u16::from(b'(') { b')' } else { b']' });
            let (inner, at) = parse_group(s, i + 1, Some(shut))?;
            if s.get(at) != Some(&shut) {
                return Err(unbalanced());
            }
            let count = count_at(s, at + 1);
            mass += inner * count.map_or(1.0, |c| c.1);
            i = at + 1 + count.map_or(0, |c| c.0);
            continue;
        }
        if !upper(ch) {
            return Err(err(ErrorCode::Value, format!("Unexpected \"{}\" in formula", unit_text(Some(&ch)))));
        }
        let two = s.get(i + 1).is_some_and(|&u| lower(u));
        let sym = String::from_utf16_lossy(&s[i..i + 1 + usize::from(two)]);
        let mut el = element(&sym);
        let mut len = sym.len();
        if el.is_none() && two {
            if let Some(one) = element(&sym[..1]) {
                el = Some(one);
                len = 1;
            }
        }
        let Some((_, weight)) = el else {
            return Err(err(ErrorCode::Name, format!("Unknown element \"{sym}\"")));
        };
        let count = count_at(s, i + len);
        mass += weight * count.map_or(1.0, |c| c.1);
        i += len + count.map_or(0, |c| c.0);
    }
    if close.is_some() {
        return Err(unbalanced());
    }
    Ok((mass, i))
}

/// `hydrateSegments`: split at `·`, `•`, `*`, and at a `.` that starts a hydrate (CuSO4.5H2O), not one inside a
/// segment's leading multiplier.
fn hydrate_segments(s: &[u16]) -> Vec<&[u16]> {
    let digit = |u: u16| (u16::from(b'0')..=u16::from(b'9')).contains(&u);
    let starts_hydrate = |t: &[u16]| {
        let mut j = t.iter().take_while(|&&u| digit(u)).count();
        if t.get(j) == Some(&u16::from(b'.')) && t.get(j + 1).is_some_and(|&u| digit(u)) {
            j += 1 + t[j + 1..].iter().take_while(|&&u| digit(u)).count();
        }
        t.get(j).is_some_and(|&u| (u16::from(b'A')..=u16::from(b'Z')).contains(&u))
    };
    let mut out = Vec::new();
    let mut start = 0;
    for i in 0..s.len() {
        let ch = s[i];
        let in_multiplier = i > start && s[start..i].iter().all(|&u| digit(u));
        let after_close = i > 0 && (s[i - 1] == u16::from(b')') || s[i - 1] == u16::from(b']') || digit(s[i - 1]));
        let hydrate_dot = ch == u16::from(b'.') && !in_multiplier && after_close && starts_hydrate(&s[i + 1..]);
        if ch == 0xb7 || ch == 0x2022 || ch == u16::from(b'*') || hydrate_dot {
            out.push(&s[start..i]);
            start = i + 1;
        }
    }
    out.push(&s[start..]);
    out
}

/// `molarMass`: each hydrate segment's leading multiplier times its formula's mass.
fn molar_mass(input: &str) -> V {
    let s: Vec<u16> = input.chars().filter(|&ch| !crate::jsnum::is_js_space(ch)).collect::<String>().encode_utf16().collect();
    if s.is_empty() {
        return err(ErrorCode::Value, "Type a chemical formula, such as H2O");
    }
    let mut total = 0.0;
    for seg in hydrate_segments(&s) {
        let lead = count_at(seg, 0);
        let body = &seg[lead.map_or(0, |c| c.0)..];
        if body.is_empty() {
            return err(ErrorCode::Value, "A formula segment is empty");
        }
        match parse_group(body, 0, None) {
            Ok((mass, _)) => total += lead.map_or(1.0, |c| c.1) * mass,
            Err(e) => return e,
        }
    }
    V::Num(total)
}

fn molar_mass_node(c: &mut Call) -> Answer {
    let lit = match c.string_literal("formula") {
        V::Undef | V::Null => V::str(""),
        v => v,
    };
    let result = match c.read_input("formula", lit) {
        V::List(_) => err(ErrorCode::Value, "Molar Mass reads one formula, not a list"),
        e if e.is_sol_error() => e,
        V::Str(f) if !crate::jsnum::js_trim(&f).is_empty() => molar_mass(&f),
        _ => V::Null,
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

/// `PHYS_CONSTANTS`: CODATA 2018, SI units.
fn physics_constant(c: &mut Call) -> Answer {
    let v = match c.field_str("op", "c") {
        "c" => 299792458.0,
        "G" => 6.67430e-11,
        "h" => 6.62607015e-34,
        "hbar" => 1.054571817e-34,
        "g0" => 9.80665,
        "atm" => 101325.0,
        "e" => 1.602176634e-19,
        "eps0" => 8.8541878128e-12,
        "mu0" => 1.25663706212e-6,
        "ke" => 8.9875517923e9,
        "z0" => 376.730313668,
        "faraday" => 96485.33212,
        "me" => 9.1093837015e-31,
        "mp" => 1.67262192369e-27,
        "mn" => 1.67492749804e-27,
        "a0" => 5.29177210903e-11,
        "rydberg" => 10973731.56816,
        "na" => 6.02214076e23,
        "kb" => 1.380649e-23,
        "rgas" => 8.314462618,
        "sigma" => 5.670374419e-8,
        "wien" => 2.897771955e-3,
        _ => return Err(super::frames::thrown("Cannot read properties of undefined (reading 'value')")),
    };
    Ok(vec![("value".into(), V::Num(v))])
}
// ─── Astronomy ─────────────────────────────────────────────────────────────────

const RAD: f64 = PI / 180.0;
const DEG: f64 = 180.0 / PI;

/// `solarBasis`: the sun's declination (degrees) and the equation of time (minutes) on a Julian day, NOAA's series.
fn solar_basis(jd: f64) -> (f64, f64) {
    let jc = (jd - 2451545.0) / 36525.0;
    let mean_long = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360.0) + 360.0) % 360.0;
    let mean_anom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    let ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    let eq_of_ctr = sin(RAD * mean_anom) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + sin(RAD * 2.0 * mean_anom) * (0.019993 - 0.000101 * jc)
        + sin(RAD * 3.0 * mean_anom) * 0.000289;
    let true_long = mean_long + eq_of_ctr;
    let app_long = true_long - 0.00569 - 0.00478 * sin(RAD * (125.04 - 1934.136 * jc));
    let mean_obliq = 23.0 + (26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0;
    let obliq = mean_obliq + 0.00256 * cos(RAD * (125.04 - 1934.136 * jc));
    let declination = DEG * asin(sin(RAD * obliq) * sin(RAD * app_long));
    let var_y = pow(tan(RAD * (obliq / 2.0)), 2.0);
    let eq_of_time = 4.0
        * DEG
        * (var_y * sin(2.0 * RAD * mean_long) - 2.0 * ecc * sin(RAD * mean_anom)
            + 4.0 * ecc * var_y * sin(RAD * mean_anom) * cos(2.0 * RAD * mean_long)
            - 0.5 * var_y * var_y * sin(4.0 * RAD * mean_long)
            - 1.25 * ecc * ecc * sin(2.0 * RAD * mean_anom));
    (declination, eq_of_time)
}

fn julian_day(serial: f64) -> f64 {
    serial + 2415018.5
}

/// `solarPosition`: elevation, azimuth and declination for a UTC serial at a latitude and longitude.
fn solar_position_of(serial: f64, lat: f64, lon: f64) -> [f64; 3] {
    let (declination, eq_of_time) = solar_basis(julian_day(serial));
    let minutes_utc = ((serial % 1.0) + 1.0) % 1.0 * 1440.0;
    let true_solar_time = (((minutes_utc + eq_of_time + 4.0 * lon) % 1440.0) + 1440.0) % 1440.0;
    let hour_angle = if true_solar_time / 4.0 < 0.0 { true_solar_time / 4.0 + 180.0 } else { true_solar_time / 4.0 - 180.0 };
    let zenith = DEG * acos(sin(RAD * lat) * sin(RAD * declination) + cos(RAD * lat) * cos(RAD * declination) * cos(RAD * hour_angle));
    let elevation = 90.0 - zenith;
    let az_denom = cos(RAD * lat) * sin(RAD * zenith);
    let azimuth = if az_denom.abs() < 1e-9 {
        if lat > 0.0 { 180.0 } else { 0.0 }
    } else {
        let az_rad = (sin(RAD * lat) * cos(RAD * zenith) - sin(RAD * declination)) / az_denom;
        let a = DEG * acos(math_min(1.0, math_max(-1.0, az_rad)));
        if hour_angle > 0.0 { (a + 180.0) % 360.0 } else { (540.0 - a) % 360.0 }
    };
    [elevation, azimuth, declination]
}

/// `sunTimes`: sunrise and sunset serials (None in polar day or night) and the hours of daylight.
fn sun_times(serial: f64, lat: f64, lon: f64) -> (Option<f64>, Option<f64>, f64) {
    let day = serial.floor();
    let (declination, eq_of_time) = solar_basis(julian_day(day + 0.5));
    let cos_ha = cos(RAD * 90.833) / (cos(RAD * lat) * cos(RAD * declination)) - tan(RAD * lat) * tan(RAD * declination);
    if cos_ha > 1.0 {
        return (None, None, 0.0);
    }
    if cos_ha < -1.0 {
        return (None, None, 24.0);
    }
    let ha = DEG * acos(cos_ha);
    let noon = (720.0 - 4.0 * lon - eq_of_time) / 1440.0;
    (Some(day + noon - (ha * 4.0) / 1440.0), Some(day + noon + (ha * 4.0) / 1440.0), (ha * 8.0) / 60.0)
}

fn lat_lon_error(lat: f64, lon: f64) -> Option<V> {
    if lat < -90.0 || lat > 90.0 {
        return Some(domain("Latitude runs −90 to 90"));
    }
    if lon < -180.0 || lon > 180.0 {
        return Some(domain("Longitude runs −180 to 180 (east positive)"));
    }
    None
}

/// The when, latitude and longitude a sun card reads, where all three are numbers.
fn sun_inputs(c: &Call) -> Option<(f64, f64, f64)> {
    let when = number(&first(c, "when"))?;
    let lat = number(&c.read_input("lat", c.literal("lat")))?;
    let lon = number(&c.read_input("lon", c.literal("lon")))?;
    Some((when, lat, lon))
}

fn solar_position(c: &mut Call) -> Answer {
    let [elevation, azimuth, declination] = match sun_inputs(c) {
        None => [V::Null, V::Null, V::Null],
        Some((when, lat, lon)) => match lat_lon_error(lat, lon) {
            Some(e) => [e.clone(), e.clone(), e],
            None => solar_position_of(when, lat, lon).map(V::Num),
        },
    };
    shown(c, &[
        ("elevation", "cachedElevation", elevation),
        ("azimuth", "cachedAzimuth", azimuth),
        ("declination", "cachedDeclination", declination),
    ])
}

fn sunrise_sunset(c: &mut Call) -> Answer {
    let [sunrise, sunset, daylength] = match sun_inputs(c) {
        None => [V::Null, V::Null, V::Null],
        Some((when, lat, lon)) => match lat_lon_error(lat, lon) {
            Some(e) => [e.clone(), e.clone(), e],
            None => {
                let (rise, set, len) = sun_times(when, lat, lon);
                [null_or(rise), null_or(set), V::Num(len)]
            }
        },
    };
    shown(c, &[("sunrise", "cachedSunrise", sunrise), ("sunset", "cachedSunset", sunset), ("daylength", "cachedDayLength", daylength)])
}

const SYNODIC_MONTH: f64 = 29.530588853;
const NEW_MOON_EPOCH_SERIAL: f64 = 36531.7597;

fn moon_phase_node(c: &mut Call) -> Answer {
    let [phase, age, illumination] = match number(&first(c, "when")) {
        None => [V::Null, V::Null, V::Null],
        Some(serial) => {
            let days = serial - NEW_MOON_EPOCH_SERIAL;
            let phase = ((days / SYNODIC_MONTH) % 1.0 + 1.0) % 1.0;
            [V::Num(phase), V::Num(phase * SYNODIC_MONTH), V::Num((1.0 - cos(2.0 * PI * phase)) / 2.0)]
        }
    };
    shown(c, &[("phase", "cachedPhase", phase), ("age", "cachedAge", age), ("illumination", "cachedIllumination", illumination)])
}

// ─── Thermodynamics ────────────────────────────────────────────────────────────

const ISA_R_SPEC: f64 = 287.0531;
const GM_OVER_R: f64 = 0.034163195;
const EARTH_R: f64 = 6356766.0;
const ISA_LAYERS: [(f64, f64); 7] = [(0.0, -0.0065), (11000.0, 0.0), (20000.0, 0.001), (32000.0, 0.0028), (47000.0, 0.0), (51000.0, -0.0028), (71000.0, -0.002)];
const ISA_TOP: f64 = 84852.0;

/// One layer's base: geopotential altitude, lapse rate, temperature and pressure.
struct IsaBase {
    h: f64,
    l: f64,
    t: f64,
    p: f64,
}

/// The pressure at `dh` above a layer's base: the barometric formula, isothermal or with a lapse.
fn isa_pressure(b: &IsaBase, dh: f64, t: f64) -> f64 {
    if b.l == 0.0 {
        b.p * exp((-GM_OVER_R * dh) / b.t)
    } else {
        b.p * pow(b.t / t, GM_OVER_R / b.l)
    }
}

/// `ISA_BASES`: each layer's base, chained from sea level's 288.15 K and 101325 Pa.
fn isa_bases() -> Vec<IsaBase> {
    let mut out = vec![IsaBase { h: 0.0, l: ISA_LAYERS[0].1, t: 288.15, p: 101325.0 }];
    for &(h, l) in &ISA_LAYERS[1..] {
        let prev = out.last().expect("sea level is there");
        let dh = h - prev.h;
        let t = prev.t + prev.l * dh;
        let p = isa_pressure(prev, dh, t);
        out.push(IsaBase { h, l, t, p });
    }
    out
}

/// `standardAtmosphere`: temperature, pressure, density and the speed of sound at a geometric altitude.
fn standard_atmosphere(z: f64) -> Result<[f64; 4], V> {
    let h = (EARTH_R * z) / (EARTH_R + z);
    if h < -5000.0 || h > ISA_TOP {
        return Err(domain("The 1976 standard atmosphere is defined from −5 to 86 km"));
    }
    let bases = isa_bases();
    let mut layer = &bases[0];
    for b in &bases {
        if h >= b.h {
            layer = b;
        } else {
            break;
        }
    }
    let dh = h - layer.h;
    let t = layer.t + layer.l * dh;
    let p = isa_pressure(layer, dh, t);
    Ok([t, p, p / (ISA_R_SPEC * t), (1.4 * ISA_R_SPEC * t).sqrt()])
}

fn isa_atmosphere(c: &mut Call) -> Answer {
    let z = c.read_input("alt", c.literal("alt"));
    let [temp, pressure, density, sound] = match number(&z).map(standard_atmosphere) {
        None => [V::Null, V::Null, V::Null, V::Null],
        Some(Err(e)) => [e.clone(), e.clone(), e.clone(), e],
        Some(Ok(pt)) => pt.map(V::Num),
    };
    shown(c, &[("temp", "cachedT", temp), ("pressure", "cachedP", pressure), ("density", "cachedRho", density), ("sound", "cachedA", sound)])
}

/// `ANTOINE[substance]`: log₁₀(p/mmHg) = A − B/(C + T°C).
fn antoine_coefficients(substance: &str) -> Option<(f64, f64, f64)> {
    Some(match substance {
        "water" => (8.07131, 1730.63, 233.426),
        "ethanol" => (8.20417, 1642.89, 230.3),
        "methanol" => (8.08097, 1582.271, 239.726),
        "isopropanol" => (8.11778, 1580.92, 219.61),
        "acetone" => (7.11714, 1210.595, 229.664),
        "benzene" => (6.90565, 1211.033, 220.79),
        "toluene" => (6.95464, 1344.8, 219.48),
        "hexane" => (6.87601, 1171.17, 224.41),
        "ammonia" => (7.3605, 926.132, 240.17),
        _ => return None,
    })
}

const MMHG_TO_PA: f64 = 133.322387415;

fn antoine(c: &mut Call) -> Answer {
    let t = c.read_input("t", c.literal("t"));
    let substance = c.field_str("substance", "water");
    let Some((a, b, cc)) = antoine_coefficients(substance) else {
        return Err(err(ErrorCode::Error, "Cannot destructure property 'A' of 'ANTOINE[this.substance]' as it is undefined."));
    };
    let pressure = match number(&t) {
        None => V::Null,
        Some(t) if t <= -cc => domain("Below the equation's temperature range"),
        Some(t) => V::Num(MMHG_TO_PA * pow(10.0, a - b / (cc + t))),
    };
    let bp = V::Num(b / (a - log10(760.0)) - cc);
    shown(c, &[("pressure", "cachedP", pressure), ("bp", "cachedBp", bp)])
}

// ─── Fluids ────────────────────────────────────────────────────────────────────

/// `colebrookF`: fixed-point iteration on x = 1/√f from the Swamee–Jain seed.
fn colebrook_f(re: f64, rr: f64) -> f64 {
    let mut x = 1.0 / (0.25 / pow(log10(rr / 3.7 + 5.74 / pow(re, 0.9)), 2.0)).sqrt();
    for _ in 0..100 {
        let next = -2.0 * log10(rr / 3.7 + (2.51 * x) / re);
        if (next - x).abs() < 1e-13 {
            x = next;
            break;
        }
        x = next;
    }
    1.0 / (x * x)
}

fn colebrook(c: &mut Call) -> Answer {
    let re = c.read_input("re", c.literal("re"));
    let rr = c.read_input("rr", c.literal("rr"));
    let result = match (number(&re), number(&rr)) {
        (Some(re), Some(rr)) if re <= 0.0 || rr < 0.0 || rr >= 1.0 => domain("Needs Re > 0 and relative roughness 0 ≤ ε/D < 1"),
        (Some(re), Some(_)) if re < 2300.0 => V::Num(64.0 / re),
        (Some(re), Some(rr)) => V::Num(colebrook_f(re, rr)),
        _ => V::Null,
    };
    shown(c, &[("result", "cachedResult", result)])
}

/// `PIPE_ROUGHNESS`: absolute roughness ε in mm.
fn pipe_roughness_mm(material: &str) -> Option<f64> {
    Some(match material {
        "pvc" | "copper" => 0.0015,
        "stainless" => 0.015,
        "steel" => 0.045,
        "wrought" => 0.046,
        "asphalted" => 0.12,
        "galvanized" => 0.15,
        "castiron" => 0.26,
        "concrete" => 0.3,
        "wood" => 0.5,
        "concreteR" | "riveted" => 3.0,
        "corrugated" => 45.0,
        _ => return None,
    })
}

fn pipe_roughness(c: &mut Call) -> Answer {
    let eps = pipe_roughness_mm(c.field_str("material", "steel")).unwrap_or(0.045);
    let rel = match number(&read_or_null(c, "d")) {
        None => V::Null,
        Some(d) if d > 0.0 => V::Num(eps / d),
        Some(_) => domain("Diameter must be positive"),
    };
    shown(c, &[("eps", "cachedEps", V::Num(eps)), ("rel", "cachedRel", rel)])
}

// ─── Health ────────────────────────────────────────────────────────────────────

const ZONES: [(&str, f64, f64); 5] =
    [("Z1 Recovery", 0.5, 0.6), ("Z2 Endurance", 0.6, 0.7), ("Z3 Tempo", 0.7, 0.8), ("Z4 Threshold", 0.8, 0.9), ("Z5 Maximum", 0.9, 1.0)];

/// `hrZonesFrame`: a row per zone, its low and high beat rates by the Karvonen reserve where a resting rate is given.
fn hr_zones_frame(max_hr: f64, resting: Option<f64>) -> V {
    let at = |pct: f64| V::Num(math_round(match resting {
        Some(r) => r + pct * (max_hr - r),
        None => pct * max_hr,
    }));
    let column = |name: &str, ty: FrameColType, values: Vec<V>| Column { name: name.into(), ty, values, unit: None, format: None, raw: None };
    V::Frame(Rc::new(Frame {
        columns: vec![
            column("Zone", FrameColType::String, ZONES.iter().map(|z| V::str(z.0)).collect()),
            column("Low", FrameColType::Number, ZONES.iter().map(|z| at(z.1)).collect()),
            column("High", FrameColType::Number, ZONES.iter().map(|z| at(z.2)).collect()),
        ],
        total_rows: None,
        approx: None,
    }))
}

fn hr_zones(c: &mut Call) -> Answer {
    let age = read_or_null(c, "age");
    let resting = read_or_null(c, "resting");
    let max_in = read_or_null(c, "max");
    let max_hr = number(&max_in).or_else(|| number(&age).map(|a| 220.0 - a));
    let zones = match max_hr {
        None => V::Null,
        Some(max_hr) => {
            let rest = number(&resting);
            if max_hr > 0.0 && rest.is_none_or(|r| r > 0.0 && r < max_hr) {
                hr_zones_frame(max_hr, rest)
            } else {
                domain("Needs max HR > 0 and resting HR below it")
            }
        }
    };
    shown(c, &[("zones", "cachedFrame", zones)])
}

// ─── Electromagnetic spectrum ──────────────────────────────────────────────────

const LIGHT_SPEED: f64 = 299792458.0;

/// `emBand`: the band a wavelength in meters falls in, on the textbook boundaries.
fn em_band(wavelength: f64) -> &'static str {
    let nm = wavelength * 1e9;
    if wavelength >= 1.0 {
        "Radio"
    } else if wavelength >= 1e-3 {
        "Microwave"
    } else if nm >= 750.0 {
        "Infrared"
    } else if nm >= 620.0 {
        "Visible (red)"
    } else if nm >= 590.0 {
        "Visible (orange)"
    } else if nm >= 570.0 {
        "Visible (yellow)"
    } else if nm >= 495.0 {
        "Visible (green)"
    } else if nm >= 450.0 {
        "Visible (blue)"
    } else if nm >= 380.0 {
        "Visible (violet)"
    } else if nm >= 10.0 {
        "Ultraviolet"
    } else if nm >= 0.01 {
        "X-ray"
    } else {
        "Gamma"
    }
}

fn em_spectrum_node(c: &mut Call) -> Answer {
    let f = number(&read_or_null(c, "freq"));
    let wl = number(&read_or_null(c, "wavelength"));
    let fq = f.or_else(|| wl.map(|wl| if wl > 0.0 { LIGHT_SPEED / wl } else { f64::NAN }));
    let [band, freq, wavelength] = match fq {
        None => [V::Null, V::Null, V::Null],
        Some(fq) if !fq.is_finite() || fq <= 0.0 => {
            let e = domain("Needs a positive frequency or wavelength");
            [e.clone(), e.clone(), e]
        }
        Some(fq) => {
            let lambda = LIGHT_SPEED / fq;
            [V::str(em_band(lambda)), V::Num(fq), V::Num(lambda)]
        }
    };
    shown(c, &[("band", "cachedBand", band), ("freq", "cachedFreq", freq), ("wavelength", "cachedWavelength", wavelength)])
}

// ─── Convert ───────────────────────────────────────────────────────────────────

/// A Convert unit's category, by its dimension (the table's dimension text).
fn category_of(dim: &str) -> &'static str {
    match dim {
        "angle1" => "angle",
        "length1" => "length",
        "mass1" => "mass",
        "temperature1" => "temperature",
        "time1" => "time",
        "length2" => "area",
        "length3" => "volume",
        "length1 time-1" => "speed",
        "length2 mass1 time-2" => "energy",
        _ => "pressure",
    }
}

/// The table's dimension text (`length-1 mass1 time-2`) as a dimension.
fn parse_dim(text: &str) -> Dim {
    text.split(' ')
        .filter_map(|t| {
            let at = t.find(|ch: char| ch == '-' || ch.is_ascii_digit())?;
            Some((t[..at].to_string(), t[at..].parse().ok()?))
        })
        .collect()
}

fn convert(c: &mut Call) -> Answer {
    use crate::convert_units::UNITS;
    let x = first(c, "in");
    c.show("cachedInput", x.clone());
    let done = |c: &mut Call, v: V| {
        c.show("cachedResult", v.clone());
        Ok(vec![("out".to_string(), v)])
    };
    if matches!(x, V::Null) {
        return done(c, V::Null);
    }
    let (from_key, to_key) = (c.field_str("fromUnit", "deg").to_string(), c.field_str("toUnit", "rad").to_string());
    let unit = |k: &str| UNITS.iter().find(|u| u.0 == k);
    let (from, to) = match (unit(&from_key), unit(&to_key)) {
        (Some(f), Some(t)) => (f, t),
        (f, _) => {
            let missing = if f.is_none() { &from_key } else { &to_key };
            return done(c, err(ErrorCode::NotAvailable, format!("Convert doesn't know the unit \"{missing}\"")));
        }
    };
    if from.2 != to.2 {
        return done(c, err(ErrorCode::NotAvailable, format!("Can't convert {} to {}: the units measure different things", category_of(from.2), category_of(to.2))));
    }
    let to_dim = parse_dim(to.2);
    let display: Option<String> = Some(to_key.clone());
    let (from_code, to_code) = (V::str(from.1), V::str(to.1));
    let result = broadcast_unit(&[x], |o| match o[0] {
        V::Unit(u) if dim_equal(&u.dim, &to_dim) => {
            V::Unit(Rc::new(crate::unit_dims::UnitCell { value: u.value, dim: u.dim.clone(), display: display.clone(), ratio: false, scale: None, offset: None, unit_dim: None }))
        }
        V::Unit(u) => {
            let shown = |d: &Dim| {
                let s = crate::unit_lists::format_dim(d);
                if s.is_empty() { "a plain number".to_string() } else { s }
            };
            V::err(unit_error(&format!("This value is {}, but Convert targets {}.", shown(&u.dim), shown(&to_dim))))
        }
        v => match super::kit::core_call("CONVERT", &[v.clone(), from_code.clone(), to_code.clone()]) {
            V::Num(conv) => crate::unit_lists::tag_dim(conv * to.3 + to.4.unwrap_or(0.0), to_dim.clone(), display.clone()),
            _ => err(ErrorCode::Overflow, "The converted value is too large to represent"),
        },
    });
    done(c, result)
}

// ─── Tornado ───────────────────────────────────────────────────────────────────

fn tornado(c: &mut Call) -> Answer {
    let v = first(c, "value");
    shown(c, &[("out", "cachedResult", v)])
}

// ─── triangle.ts, triangleOps.ts: the Triangle Solver ───────────────────────────────────────────────────────────────

const PART_KEYS: [&str; 6] = ["a", "b", "c", "A", "B", "C"];
const TRI_EPS: f64 = 1e-9;
const D2R: f64 = PI / 180.0;
const R2D: f64 = 180.0 / PI;

fn is_angle(k: &str) -> bool {
    k.chars().all(|ch| ch.is_ascii_uppercase())
}

/// A triangle's parts by `PART_KEYS` position, each given or not.
type Parts = [Option<f64>; 6];

struct Solved {
    parts: [f64; 6],
    area: f64,
    perimeter: f64,
}

fn clamp1(x: f64) -> f64 {
    x.clamp(-1.0, 1.0)
}

/// The angle opposite side `a` from the three sides, as the cosine rule has it.
fn cos_rule(a: f64, b: f64, c: f64) -> f64 {
    acos(clamp1((b * b + c * c - a * a) / (2.0 * b * c))) * R2D
}

fn fill_by_sines(t: &mut Parts, known_side: usize, known_angle: usize) {
    let missing: Vec<usize> = (3..6).filter(|&k| t[k].is_none()).collect();
    if missing.len() == 1 {
        t[missing[0]] = Some(180.0 - (3..6).map(|k| t[k].unwrap_or(0.0)).sum::<f64>());
    } else if missing.len() == 2 {
        if let (Some(a), Some(b), Some(c)) = (t[0], t[1], t[2]) {
            let ang_a = *t[3].get_or_insert_with(|| cos_rule(a, b, c));
            let ang_b = *t[4].get_or_insert_with(|| cos_rule(b, a, c));
            t[5] = Some(180.0 - ang_a - ang_b);
        }
    }
    let ratio = t[known_side].unwrap_or(f64::NAN) / sin(t[known_angle].unwrap_or(f64::NAN) * D2R);
    for k in 0..3 {
        if t[k].is_none() {
            t[k] = Some(ratio * sin(t[k + 3].unwrap_or(f64::NAN) * D2R));
        }
    }
}

/// `solveTriangle`: three parts, at least one a side, to all six with the area and perimeter.
fn solve_triangle(g: &Parts) -> Result<Solved, V> {
    let sides: Vec<usize> = (0..3).filter(|&k| g[k].is_some()).collect();
    let angles: Vec<usize> = (3..6).filter(|&k| g[k].is_some()).collect();
    let v = |k: usize| g[k].unwrap_or(f64::NAN);
    if sides.len() + angles.len() != 3 {
        return Err(err(ErrorCode::Solve, "Give exactly three parts (sides and angles)"));
    }
    for &k in &sides {
        if !(v(k) > 0.0) {
            return Err(err(ErrorCode::Domain, format!("Side {} must be positive", PART_KEYS[k])));
        }
    }
    for &k in &angles {
        if !(v(k) > 0.0 && v(k) < 180.0) {
            return Err(err(ErrorCode::Domain, format!("Angle {} must be between 0° and 180°", PART_KEYS[k])));
        }
    }
    if angles.len() == 3 {
        return Err(err(ErrorCode::Solve, "Three angles fix only the shape. Swap one for a side"));
    }
    let sum_given: f64 = angles.iter().fold(0.0, |s, &k| s + v(k));
    if angles.len() >= 2 && sum_given >= 180.0 - TRI_EPS {
        return Err(err(ErrorCode::Domain, "The angles reach 180° with nothing left over"));
    }
    let mut t = *g;
    if sides.len() == 3 {
        let (a, b, c) = (v(0), v(1), v(2));
        if a + b <= c + TRI_EPS || b + c <= a + TRI_EPS || a + c <= b + TRI_EPS {
            return Err(err(ErrorCode::Domain, "Those sides break the triangle inequality"));
        }
        let ang_a = cos_rule(a, b, c);
        let ang_b = cos_rule(b, a, c);
        t[3] = Some(ang_a);
        t[4] = Some(ang_b);
        t[5] = Some(180.0 - ang_a - ang_b);
    } else if sides.len() == 2 {
        let angle = angles[0];
        let opposite = angle - 3;
        if g[opposite].is_none() {
            let (s1, s2) = (sides[0], sides[1]);
            t[opposite] = Some((pow(v(s1), 2.0) + pow(v(s2), 2.0) - 2.0 * v(s1) * v(s2) * cos(v(angle) * D2R)).sqrt());
            fill_by_sines(&mut t, opposite, angle);
        } else {
            let other = *sides.iter().find(|&&k| k != opposite).unwrap_or(&opposite);
            let sin_other = (v(other) * sin(v(angle) * D2R)) / v(opposite);
            if sin_other > 1.0 + TRI_EPS {
                return Err(err(ErrorCode::Domain, "No triangle fits those parts"));
            }
            let right = sin_other >= 1.0 - TRI_EPS;
            let deg1 = if right { 90.0 } else { asin(clamp1(sin_other)) * R2D };
            let deg2 = 180.0 - deg1;
            let fits = |d: f64| v(angle) + d < 180.0 - TRI_EPS;
            if !right && fits(deg1) && fits(deg2) {
                return Err(err(ErrorCode::Solve, "Ambiguous (SSA): two triangles fit. Give a different third part"));
            }
            let other_angle = other + 3;
            t[other_angle] = Some(if fits(deg1) { deg1 } else { deg2 });
            let last = (3..6).find(|&k| t[k].is_none()).unwrap_or(5);
            t[last] = Some(180.0 - v(angle) - t[other_angle].unwrap_or(f64::NAN));
            t[last - 3] = Some((v(opposite) * sin(t[last].unwrap_or(f64::NAN) * D2R)) / sin(v(angle) * D2R));
        }
    } else {
        let last = (3..6).find(|&k| t[k].is_none()).unwrap_or(5);
        t[last] = Some(180.0 - sum_given);
        fill_by_sines(&mut t, sides[0], sides[0] + 3);
    }
    let parts = t.map(|x| x.unwrap_or(f64::NAN));
    let area = 0.5 * parts[1] * parts[2] * sin(parts[3] * D2R);
    Ok(Solved { parts, area, perimeter: parts[0] + parts[1] + parts[2] })
}

/// `solveGivenParts`' answer: each part, the area, the perimeter, whether the parts agree, and the parts it solved.
struct TriangleResult {
    values: [V; 6],
    area: V,
    perimeter: V,
    valid: V,
    solved: Vec<usize>,
}

fn solve_given_parts(given: &Parts, cell_err: Option<V>) -> TriangleResult {
    let done = |values: [V; 6], area: V, perimeter: V, valid: V, solved: Vec<usize>| TriangleResult { values, area, perimeter, valid, solved };
    if let Some(e) = cell_err {
        return done(std::array::from_fn(|_| e.clone()), e.clone(), e.clone(), e, Vec::new());
    }
    let given_keys: Vec<usize> = (0..6).filter(|&k| given[k].is_some()).collect();
    let unsolved = || (0..6).filter(|&k| given[k].is_none()).collect::<Vec<_>>();
    let as_given = |k: usize| given[k].map_or(V::Null, V::Num);
    if given_keys.len() < 3 {
        return done(std::array::from_fn(as_given), V::Null, V::Null, V::Null, Vec::new());
    }
    if given_keys.len() == 3 {
        return match solve_triangle(given) {
            Err(e) => done(std::array::from_fn(|_| e.clone()), e.clone(), e, V::Bool(false), Vec::new()),
            Ok(r) => done(r.parts.map(V::Num), V::Num(r.area), V::Num(r.perimeter), V::Bool(true), unsolved()),
        };
    }
    let mut subsets: Vec<[usize; 3]> = Vec::new();
    for i in 0..given_keys.len() {
        for j in i + 1..given_keys.len() {
            for k in j + 1..given_keys.len() {
                subsets.push([given_keys[i], given_keys[j], given_keys[k]]);
            }
        }
    }
    let side_count = |sub: &[usize; 3]| sub.iter().filter(|&&k| k < 3).count();
    subsets.sort_by_key(|sub| std::cmp::Reverse(side_count(sub)));
    let solved = subsets.iter().filter(|sub| side_count(sub) > 0).find_map(|sub| {
        let mut g: Parts = [None; 6];
        for &k in sub {
            g[k] = given[k];
        }
        solve_triangle(&g).ok()
    });
    let Some(s) = solved else {
        let e = err(ErrorCode::Solve, "No three of those parts pin down a triangle");
        return done(std::array::from_fn(|k| given[k].map_or_else(|| e.clone(), V::Num)), e.clone(), e, V::Bool(false), Vec::new());
    };
    let agrees = |got: f64, want: f64| (got - want).abs() <= 1e-6 * math_max(1.0, want.abs());
    let valid = given_keys.iter().all(|&k| agrees(s.parts[k], given[k].unwrap_or(f64::NAN)));
    done(std::array::from_fn(|k| V::Num(given[k].unwrap_or(s.parts[k]))), V::Num(s.area), V::Num(s.perimeter), V::Bool(valid), unsolved())
}

/// A value as `jsonEnc` writes the card's plain-object field.
fn tri_json(v: &V) -> Json {
    match v {
        V::Null | V::Undef => Json::Null,
        V::Num(n) => tri_num(*n),
        V::Bool(b) => Json::Bool(*b),
        V::Str(s) => Json::String(s.to_string()),
        V::Err(e) => serde_json::json!({ "__solError": true, "code": e.code, "message": e.message }),
        V::List(items) => Json::Array(items.iter().map(tri_json).collect()),
        V::Unit(u) => {
            let mut o = serde_json::Map::new();
            o.insert("__unitCell".into(), Json::Bool(true));
            o.insert("value".into(), tri_num(u.value));
            o.insert("dim".into(), Json::Object(u.dim.iter().map(|(k, x)| (k.clone(), tri_num(*x))).collect()));
            if let Some(d) = &u.display {
                o.insert("display".into(), Json::String(d.clone()));
            }
            Json::Object(o)
        }
        _ => Json::Null,
    }
}

fn tri_num(n: f64) -> Json {
    if n.is_nan() {
        return serde_json::json!({ "__nf": "nan" });
    }
    if n.is_infinite() {
        return serde_json::json!({ "__nf": if n > 0.0 { "inf" } else { "-inf" } });
    }
    if n == 0.0 && n.is_sign_negative() {
        return serde_json::json!({ "__nf": "-0" });
    }
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        return Json::from(n as i64);
    }
    Json::from(n)
}

/// The one unit the sides solve in: the first united side's display unit, else its base unit.
struct SideUnit {
    unit: crate::unit_catalog::Unit,
    id: Option<String>,
}

fn side_unit(read: &[V]) -> Result<Option<SideUnit>, V> {
    let mut found: Option<SideUnit> = None;
    for (k, v) in PART_KEYS.iter().zip(read) {
        let cells: Vec<&V> = if let V::List(items) = v { items.iter().collect() } else { vec![v] };
        for cell in cells {
            let V::Unit(u) = cell else { continue };
            if is_dimensionless(&u.dim) {
                continue;
            }
            if is_angle(k) {
                if !dim_equal(&u.dim, &Dim::from([("angle".to_string(), 1.0)])) {
                    return Err(V::err(unit_error(&format!("{k} is an angle."))));
                }
                continue;
            }
            if let Some(f) = &found {
                if !dim_equal(&f.unit.dim, &u.dim) {
                    return Err(V::err(unit_error("The three sides must share one dimension.")));
                }
                continue;
            }
            let fc = u.display.as_deref().filter(|d| !d.is_empty()).and_then(fc_unit_to_unit);
            if fc.as_ref().is_some_and(|f| f.offset.is_some_and(|o| o != 0.0)) {
                return Err(V::err(unit_error("A side can't be on an offset scale.")));
            }
            found = Some(match fc {
                Some(f) if dim_equal(&f.dim, &u.dim) => SideUnit { unit: f, id: u.display.clone() },
                _ => SideUnit { unit: crate::unit_catalog::Unit { dim: u.dim.clone(), scale: 1.0, offset: None }, id: None },
            });
        }
    }
    Ok(found)
}

/// `readPart`: a dimensioned angle in degrees, a side in the sides' unit, any other cell as it is.
fn read_part(k: &str, cell: &V, su: Option<&SideUnit>) -> V {
    let V::Unit(u) = cell else { return cell.clone() };
    if is_dimensionless(&u.dim) {
        return V::Num(u.value);
    }
    if is_angle(k) {
        return V::Num(round_at_larger_term(u.value * R2D, u.value * R2D));
    }
    V::Num(su.map_or(u.value, |s| u.value / s.unit.scale))
}

fn triangle_solver(c: &mut Call) -> Answer {
    let read: Vec<V> = PART_KEYS.iter().map(|k| c.read_input(k, V::Null)).collect();
    let su = match side_unit(&read) {
        Ok(su) => su,
        Err(e) => {
            let keys = PART_KEYS.iter().copied().chain(["area", "perimeter", "valid"]);
            let values: serde_json::Map<String, Json> = keys.clone().map(|k| (k.to_string(), tri_json(&e))).collect();
            c.show("cachedValues", V::Json(Rc::new(Json::Object(values))));
            for f in ["cachedArea", "cachedPerimeter", "cachedValid"] {
                c.show(f, e.clone());
            }
            c.show("solvedKeys", list(Vec::new()));
            return Ok(keys.map(|k| (k.to_string(), e.clone())).collect());
        }
    };
    let raw: Vec<V> = PART_KEYS
        .iter()
        .zip(&read)
        .map(|(k, v)| match v {
            V::List(items) => list(items.iter().map(|x| read_part(k, x, su.as_ref())).collect()),
            v => read_part(k, v, su.as_ref()),
        })
        .collect();
    let lens: Vec<usize> = raw.iter().filter_map(|v| if let V::List(l) = v { Some(l.len()) } else { None }).collect();
    let (mut outs, values, solved): (Vec<V>, [V; 6], Vec<usize>) = if lens.is_empty() {
        let mut given: Parts = [None; 6];
        for k in 0..6 {
            if let V::Num(n) = raw[k] {
                given[k] = Some(n);
            }
        }
        let r = solve_given_parts(&given, None);
        let outs = r.values.iter().cloned().chain([r.area, r.perimeter, r.valid]).collect();
        (outs, r.values, r.solved)
    } else {
        let len = lens.into_iter().max().unwrap_or(0);
        let mut cols: Vec<Vec<V>> = (0..9).map(|_| Vec::with_capacity(len)).collect();
        let mut first: Option<Vec<usize>> = None;
        for i in 0..len {
            let mut given: Parts = [None; 6];
            let mut cell_err = None;
            for k in 0..6 {
                let cell = match &raw[k] {
                    V::List(items) => items.get(i).cloned().map_or(V::Null, |x| if matches!(x, V::Undef) { V::Null } else { x }),
                    v => v.clone(),
                };
                match cell {
                    e if e.is_sol_error() => {
                        cell_err.get_or_insert(e);
                    }
                    V::Num(n) => given[k] = Some(n),
                    _ => {}
                }
            }
            let r = solve_given_parts(&given, cell_err);
            for (col, v) in cols.iter_mut().zip(r.values.iter().cloned().chain([r.area, r.perimeter, r.valid])) {
                col.push(v);
            }
            first.get_or_insert(r.solved);
        }
        let outs: Vec<V> = cols.into_iter().map(list).collect();
        let values = std::array::from_fn(|k| outs[k].clone());
        (outs, values, first.unwrap_or_default())
    };
    let mut shown_values = values;
    if let Some(su) = &su {
        // Sides and perimeter come back in the sides' unit, the area in its square.
        let id = su.id.clone();
        let sq_id = id.as_ref().map(|i| format!("{i}2"));
        let area_dim = dim_pow(&su.unit.dim, 2.0);
        let sq = sq_id.as_deref().and_then(fc_unit_to_unit).filter(|q| dim_equal(&q.dim, &area_dim));
        let side = |v: &V| if let V::Num(n) = v { from_unit(*n, &su.unit, id.as_deref()) } else { v.clone() };
        let area = |v: &V| match v {
            V::Num(n) if !is_dimensionless(&area_dim) => V::Unit(Rc::new(UnitCell {
                value: n * pow(su.unit.scale, 2.0),
                dim: area_dim.clone(),
                display: sq.as_ref().and(sq_id.clone()),
                ratio: false,
                scale: sq.as_ref().map(|q| q.scale),
                offset: sq.as_ref().map(|q| q.offset.unwrap_or(0.0)),
                unit_dim: sq.as_ref().map(|q| q.dim.clone()),
            })),
            V::Num(n) => V::Num(n * pow(su.unit.scale, 2.0)),
            other => other.clone(),
        };
        let each = |v: &V, f: &dyn Fn(&V) -> V| if let V::List(items) = v { list(items.iter().map(f).collect()) } else { f(v) };
        for k in [0, 1, 2, 7] {
            outs[k] = each(&outs[k], &side);
        }
        outs[6] = each(&outs[6], &area);
        shown_values[..3].clone_from_slice(&outs[..3]);
    }
    let values_json: serde_json::Map<String, Json> = PART_KEYS.iter().zip(&shown_values).map(|(k, v)| (k.to_string(), tri_json(v))).collect();
    c.show("cachedValues", V::Json(Rc::new(Json::Object(values_json))));
    c.show("cachedArea", outs[6].clone());
    c.show("cachedPerimeter", outs[7].clone());
    c.show("cachedValid", outs[8].clone());
    c.show("solvedKeys", list(solved.iter().map(|&k| V::str(PART_KEYS[k])).collect()));
    let keys = PART_KEYS.iter().copied().chain(["area", "perimeter", "valid"]);
    Ok(keys.zip(outs).map(|(k, v)| (k.to_string(), v)).collect())
}
