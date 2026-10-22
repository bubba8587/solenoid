//! [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation, [[C17]] shareImpl, [[C15]] matricesInFormulas,
//! [[C44]] dateSerials, [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[C24]] arraySemantics. The small packs'
//! card bodies: `nodes/electrical.ts`, `astro.ts`, `thermo.ts`, `fluids.ts`, `health.ts`, `emSpectrum.ts`, `convert.ts`
//! and `tornado.ts`, with the kernels of their `*Ops.ts` beside them.

use crate::error_value::ErrorCode;
use super::units::broadcast_unit;
use super::values::{Column, Frame};
use super::{err, Answer, Call};
use crate::excel_functions::V;
use crate::fdlibm::{acos, asin, cos, exp, log, log10, pow, sin, tan};
use crate::jsnum::{math_max, math_min, math_round};
use crate::unit_dims::{dim_equal, Dim};
use crate::unit_value::{to_precision, unit_error};
use std::f64::consts::PI;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ParallelCombineNode" => parallel_combine(c),
        "ESeriesNode" => e_series(c),
        "AwgNode" => awg(c),
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
    let column = |name: &str, ty: &str, values: Vec<V>| Column { name: name.into(), ty: ty.into(), values, unit: None, format: None, raw: None };
    V::Frame(Rc::new(Frame {
        columns: vec![
            column("Zone", "string", ZONES.iter().map(|z| V::str(z.0)).collect()),
            column("Low", "number", ZONES.iter().map(|z| at(z.1)).collect()),
            column("High", "number", ZONES.iter().map(|z| at(z.2)).collect()),
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
