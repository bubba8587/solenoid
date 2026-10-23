// [[C118]] formatTravelsWithValue, [[C114]] cardsView, [[D94]] oneNumberDisplay
//! What the Record card shares with the Table popup and the value boxes: a number as a format annotation shows it
//! (`formatNumberWithAnnotation`, `formatAnnotationStore.ts`, with the packs' units and formats), the Cards view's plan
//! (`planCards`, `cardLayout.ts`) and the Record layout grammar (`parseRecordLayout`, `recordLayout.ts`). The TS keeps
//! its copies for the UI; `fixtures/core/number-format.json.gz`, `card-plans.json.gz` and `record-layouts.json.gz`
//! hold its answers, frozen by `tests/graph/coreCardHelpers.test.ts`.

use crate::date_serial::{format_date_serial, DEFAULT_DATE_FORMAT};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_round, number_to_string, string_to_number, to_exponential, to_fixed};
use crate::unit_dims::{dim_equal, Dim};
use serde_json::{json, Value as Json};
use std::collections::{HashMap, HashSet};

// ─── Units the FC names ─────────────────────────────────────────────────────────

/// `UNIT_ANNOTATIONS`: id, label, and whether the label goes before the number.
pub const UNIT_ANNOTATIONS: &[(&str, &str, bool)] = &[
    ("none", "", false),
    ("deg", "°", false),
    ("rad", " rad", false),
    ("grad", " grad", false),
    ("m", " m", false),
    ("km", " km", false),
    ("cm", " cm", false),
    ("mm", " mm", false),
    ("in", "\"", false),
    ("ft", "'", false),
    ("mi", " mi", false),
    ("kg", " kg", false),
    ("g", " g", false),
    ("mg", " mg", false),
    ("lb", " lb", false),
    ("oz", " oz", false),
    ("degC", " °C", false),
    ("degF", " °F", false),
    ("K", " K", false),
    ("s", " s", false),
    ("ms", " ms", false),
    ("min", " min", false),
    ("hr", " hr", false),
    ("day", " day", false),
    ("m2", " m²", false),
    ("km2", " km²", false),
    ("ha", " ha", false),
    ("ft2", " ft²", false),
    ("ac", " ac", false),
    ("m3", " m³", false),
    ("L", " L", false),
    ("mL", " mL", false),
    ("gal", " gal", false),
    ("ms1", " m/s", false),
    ("kmh", " km/h", false),
    ("mph", " mph", false),
    ("b", " B", false),
    ("kb", " KB", false),
    ("mb", " MB", false),
    ("gb", " GB", false),
    ("tb", " TB", false),
    ("usd", "$", true),
    ("eur", "€", true),
    ("gbp", "£", true),
    ("jpy", "¥", true),
    ("custom", "", false),
];

/// The packs' FC units (`units` in `src/graph/packs/*.ts`), which register at start whether or not a pack is active.
const PACK_UNITS: &[(&str, &str)] = &[
    ("kcal", " kcal"),
    ("bpm", " bpm"),
    ("kgm2", " kg/m²"),
    ("V", " V"),
    ("mV", " mV"),
    ("kV", " kV"),
    ("A", " A"),
    ("mA", " mA"),
    ("ohm", " Ω"),
    ("kohm", " kΩ"),
    ("Mohm", " MΩ"),
    ("W", " W"),
    ("kW", " kW"),
    ("Hz", " Hz"),
    ("kHz", " kHz"),
    ("MHz", " MHz"),
    ("uF", " µF"),
    ("nF", " nF"),
    ("mH", " mH"),
    ("uH", " µH"),
    ("dB", " dB"),
    ("dBm", " dBm"),
    ("mAh", " mAh"),
    ("J", " J"),
    ("kJ", " kJ"),
    ("Wh", " Wh"),
    ("kWh", " kWh"),
    ("cal", " cal"),
    ("BTU", " BTU"),
    ("turn", " turns"),
    ("px", " px"),
    ("T", " T"),
    ("mT", " mT"),
    ("Wb", " Wb"),
    ("eV", " eV"),
    ("mol", " mol"),
    ("mmol", " mmol"),
    ("gmol", " g/mol"),
    ("molL", " mol/L"),
    ("Pa", " Pa"),
    ("kPa", " kPa"),
    ("bar", " bar"),
    ("psi", " psi"),
    ("m3s", " m³/s"),
    ("Ls", " L/s"),
    ("Lmin", " L/min"),
    ("gpm", " gpm"),
    ("Pas", " Pa·s"),
    ("cP", " cP"),
];

/// `unitById`: the label and its side, a built-in id first, then a pack's, else none.
pub fn unit_label(id: &str) -> (&'static str, bool) {
    if let Some((_, label, prefix)) = UNIT_ANNOTATIONS.iter().find(|(u, ..)| *u == id) {
        return (label, *prefix);
    }
    PACK_UNITS.iter().find(|(u, _)| *u == id).map_or(("", false), |(_, label)| (label, false))
}

/// `isFcUnit`.
pub fn is_fc_unit(id: &str) -> bool {
    UNIT_ANNOTATIONS.iter().any(|(u, ..)| *u == id) || PACK_UNITS.iter().any(|(u, _)| *u == id)
}

/// `fcUnitIdForUnit`: the built-in id whose scale and offset are `scale` and none, else the first of the dimension.
pub fn fc_unit_id_for_unit(dim: &Dim, scale: f64) -> Option<&'static str> {
    let mut same_dim = None;
    for (id, ..) in UNIT_ANNOTATIONS {
        let Some(cand) = crate::unit_catalog::fc_unit_to_unit(id) else { continue };
        if !dim_equal(&cand.dim, dim) {
            continue;
        }
        if (cand.scale - scale).abs() < 1e-12 && cand.offset.unwrap_or(0.0) == 0.0 {
            return Some(id);
        }
        same_dim.get_or_insert(*id);
    }
    same_dim
}

// ─── Numbers as an annotation shows them ────────────────────────────────────────

/// The "Decimal places" and "Scientific from" settings a number nobody formatted shows by.
#[derive(Clone, Copy, Debug)]
pub struct NumberDisplay {
    pub decimals: f64,
    pub sci_from: f64,
}

impl Default for NumberDisplay {
    fn default() -> Self {
        NumberDisplay { decimals: 4.0, sci_from: 1e9 }
    }
}

impl NumberDisplay {
    /// `displayDecimals()` and `sciThreshold()` over the settings' texts.
    pub fn from_settings(number_decimals: Option<&str>, sci_above: Option<&str>) -> NumberDisplay {
        let d = number_decimals.map_or(f64::NAN, string_to_number);
        let decimals = if d.fract() == 0.0 && d >= 0.0 { d } else { 4.0 };
        NumberDisplay { decimals, sci_from: sci_from_setting(sci_above) }
    }
}

/// `sciThreshold()` for the "Scientific from" setting's text.
pub fn sci_from_setting(sci_above: Option<&str>) -> f64 {
    match sci_above {
        Some("off") => f64::INFINITY,
        s => {
            let p = s.map_or(f64::NAN, string_to_number);
            if p.fract() == 0.0 { crate::fdlibm::pow(10.0, p) } else { 1e9 }
        }
    }
}

/// `formatScalar`: an integer as it is, anything else to the decimal places with trailing zeros dropped, extremes in
/// scientific.
pub fn format_scalar(n: f64, d: NumberDisplay) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "∞" } else { "-∞" }.into();
    }
    let a = n.abs();
    if a >= d.sci_from || (a > 0.0 && a < crate::fdlibm::pow(10.0, -d.decimals)) {
        // `toExponential(4).replace(/\.?0+e/, "e")`.
        let s = to_exponential(n, 4.0).unwrap_or_default();
        let (m, e) = s.split_once('e').unwrap_or((&s, ""));
        let kept = m.trim_end_matches('0');
        let kept = if kept.len() < m.len() { kept.strip_suffix('.').unwrap_or(kept) } else { m };
        return format!("{kept}e{e}");
    }
    if n.fract() == 0.0 {
        return number_to_string(n);
    }
    let s = to_fixed(n, d.decimals).unwrap_or_default();
    // `.replace(/\.?0+$/, "")`.
    let kept = s.trim_end_matches('0');
    let kept = if kept.len() < s.len() { kept.strip_suffix('.').unwrap_or(kept) } else { &s };
    if kept == "-0" { "0".into() } else { kept.to_string() }
}

/// The digits of `String(|x|)`, the shortest that round-trip, and where the point sits: x = 0.d₁d₂… × 10^point.
fn shortest_digits(x: f64) -> (Vec<u8>, i64) {
    let s = number_to_string(x.abs());
    let (m, exp) = s.split_once('e').unwrap_or((&s, "0"));
    let (int, frac) = m.split_once('.').unwrap_or((m, ""));
    let all: Vec<u8> = int.bytes().chain(frac.bytes()).map(|b| b - b'0').collect();
    let zeros = all.iter().take_while(|&&d| d == 0).count();
    let digits = all[zeros..].to_vec();
    let point = int.len() as i64 + exp.trim_start_matches('+').parse::<i64>().unwrap_or(0) - zeros as i64;
    (digits, point)
}

/// Rounds `digits` half away from zero to `keep` digits; `true` where a carry made one more digit in front.
fn round_digits(digits: &mut Vec<u8>, keep: usize) -> bool {
    let up = digits.get(keep).is_some_and(|&d| d >= 5);
    digits.truncate(keep);
    while digits.len() < keep {
        digits.push(0);
    }
    if !up {
        return false;
    }
    for d in digits.iter_mut().rev() {
        if *d == 9 {
            *d = 0;
        } else {
            *d += 1;
            return false;
        }
    }
    digits.insert(0, 1);
    true
}

fn group(int: &str, grouping: bool) -> String {
    if !grouping {
        return int.to_string();
    }
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn assemble(neg: bool, int: &str, frac: &str, grouping: bool) -> String {
    let int = match int.trim_start_matches('0') {
        "" => "0",
        t => t,
    };
    let sign = if neg { "-" } else { "" };
    if frac.is_empty() { format!("{sign}{}", group(int, grouping)) } else { format!("{sign}{}.{frac}", group(int, grouping)) }
}

fn digit_text(ds: &[u8]) -> String {
    ds.iter().map(|d| char::from(b'0' + d)).collect()
}

/// `x.toLocaleString("en-US", { minimumFractionDigits: fd, maximumFractionDigits: fd, useGrouping })`: ICU rounds the
/// shortest round-trip digits half away from zero.
pub fn locale_fixed(x: f64, fd: usize, grouping: bool) -> String {
    if !x.is_finite() {
        return locale_special(x);
    }
    let (digits, point) = shortest_digits(x);
    let keep = point + fd as i64;
    let mut scaled: Vec<u8> = if keep < 0 {
        Vec::new()
    } else if keep == 0 {
        vec![u8::from(digits.first().is_some_and(|&d| d >= 5))]
    } else {
        let mut v = digits.clone();
        round_digits(&mut v, keep as usize);
        v
    };
    while scaled.len() < fd + 1 {
        scaled.insert(0, 0);
    }
    let int_len = scaled.len() - fd;
    assemble(x.is_sign_negative(), &digit_text(&scaled[..int_len]), &digit_text(&scaled[int_len..]), grouping)
}

/// `x.toLocaleString("en-US", { minimumSignificantDigits: s, maximumSignificantDigits: s, useGrouping })`.
pub fn locale_significant(x: f64, s: usize, grouping: bool) -> String {
    if !x.is_finite() {
        return locale_special(x);
    }
    let neg = x.is_sign_negative();
    if x == 0.0 {
        let frac = "0".repeat(s.saturating_sub(1));
        return assemble(neg, "0", &frac, grouping);
    }
    let (mut digits, mut point) = shortest_digits(x);
    if round_digits(&mut digits, s) {
        digits.pop();
        point += 1;
    }
    if point >= s as i64 {
        let int = format!("{}{}", digit_text(&digits), "0".repeat((point - s as i64) as usize));
        assemble(neg, &int, "", grouping)
    } else if point > 0 {
        let p = point as usize;
        assemble(neg, &digit_text(&digits[..p]), &digit_text(&digits[p..]), grouping)
    } else {
        let frac = format!("{}{}", "0".repeat((-point) as usize), digit_text(&digits));
        assemble(neg, "0", &frac, grouping)
    }
}

fn locale_special(x: f64) -> String {
    if x.is_nan() {
        "NaN".into()
    } else if x > 0.0 {
        "∞".into()
    } else {
        "-∞".into()
    }
}

/// A format annotation (`FormatAnnotation`) as the wire carries it, every field it can leave out optional.
#[derive(Clone, Debug, Default)]
pub struct Annotation {
    pub format: String,
    pub custom_pattern: Option<String>,
    pub unit: String,
    pub custom_unit: Option<String>,
    /// `None` where the annotation leaves it out (the formatter's default of 2); a JSON null reads as 0.
    pub decimal_digits: Option<f64>,
    pub decimal_mode: Option<String>,
    pub grouping: Option<bool>,
    pub negative_style: Option<String>,
    pub scale_mode: Option<String>,
}

impl Annotation {
    pub fn from_json(j: &Json) -> Annotation {
        let text = |k: &str| j.get(k).and_then(Json::as_str).map(String::from);
        let digits = match j.get("decimalDigits") {
            None => None,
            Some(Json::Null) => Some(0.0),
            Some(v) => Some(match crate::wire::decode_cell(v) {
                crate::frame::FrameCell::Num(n) => n,
                _ => f64::NAN,
            }),
        };
        Annotation {
            format: text("format").unwrap_or_else(|| "auto".into()),
            custom_pattern: text("customPattern"),
            unit: text("unit").unwrap_or_else(|| "none".into()),
            custom_unit: text("customUnit"),
            decimal_digits: digits,
            decimal_mode: text("decimalMode"),
            grouping: j.get("grouping").and_then(Json::as_bool),
            negative_style: text("negativeStyle"),
            scale_mode: text("scaleMode"),
        }
    }

    /// `{ format: "auto", unit: "none" }`.
    pub fn auto() -> Annotation {
        Annotation { format: "auto".into(), unit: "none".into(), ..Annotation::default() }
    }
}

pub fn is_date_style(style: &str) -> bool {
    style.starts_with("date_") || style.starts_with("time_") || style == "datetime"
}

/// `dateAnnotationPattern`, its default where the style is no date style.
pub fn date_annotation_pattern(ann: &Annotation) -> &str {
    match ann.format.as_str() {
        "date_custom" => ann.custom_pattern.as_deref().filter(|p| !p.is_empty()).unwrap_or(DEFAULT_DATE_FORMAT),
        "date_dmy" => "DD-MMM-YYYY",
        "date_iso" => "YYYY-MM-DD",
        "date_us" => "M/D/YYYY",
        "date_long" => "MMMM D, YYYY",
        "date_med" => "MMM D, YYYY",
        "date_dow" => "DDD, MMM D, YYYY",
        "time_24" => "HH:mm",
        "time_12" => "h:mm A",
        "datetime" => "YYYY-MM-DD HH:mm",
        _ => DEFAULT_DATE_FORMAT,
    }
}

/// `Math.max(lo, Math.min(hi, x))` with NaN carried, as the clamps of the digit counts read.
fn clamp_js(x: f64, lo: f64, hi: f64) -> f64 {
    if x.is_nan() { x } else { x.min(hi).max(lo) }
}

fn format_precise(n: f64, digits: f64, sigfigs: bool, grouping: bool) -> String {
    if sigfigs {
        let r = math_round(digits);
        let s = clamp_js(if r == 0.0 || r.is_nan() { 1.0 } else { r }, 1.0, 21.0);
        return locale_significant(n, s as usize, grouping);
    }
    let d = clamp_js(math_round(digits), 0.0, 20.0);
    locale_fixed(n, if d.is_nan() { 0 } else { d as usize }, grouping)
}

/// `cfConvergent`: the best fraction of `x` with a denominator up to `max_den`.
fn cf_convergent(x: f64, max_den: f64) -> (f64, f64) {
    let (mut h0, mut h1, mut k0, mut k1) = (0.0, 1.0, 1.0, 0.0);
    let mut b = x;
    for _ in 0..40 {
        let a = b.floor();
        let h2 = a * h1 + h0;
        let k2 = a * k1 + k0;
        if k2 > max_den {
            break;
        }
        (h0, h1, k0, k1) = (h1, h2, k1, k2);
        let frac = b - a;
        if frac < 1e-12 {
            break;
        }
        b = 1.0 / frac;
    }
    (h1, k1)
}

fn to_fraction(n: f64, d: NumberDisplay) -> String {
    if !n.is_finite() {
        return number_to_string(n);
    }
    if n.abs() < 1e-12 {
        return "0".into();
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let abs = n.abs();
    let whole = abs.floor();
    let frac = abs - whole;
    if frac < 1e-12 {
        return format!("{sign}{}", number_to_string(whole));
    }
    let (num, den) = cf_convergent(frac, 99.0);
    if den == 0.0 || (frac - num / den).abs() > 1e-9 {
        return format_scalar(n, d);
    }
    let (num, den) = (number_to_string(num), number_to_string(den));
    if whole > 0.0 { format!("{sign}{} {num}/{den}", number_to_string(whole)) } else { format!("{sign}{num}/{den}") }
}

fn to_fraction_advanced(n: f64, d: NumberDisplay) -> String {
    if !n.is_finite() {
        return number_to_string(n);
    }
    if n.abs() < 1e-12 {
        return "0".into();
    }
    let sqrt5 = 5f64.sqrt();
    let constants: [(&str, f64); 7] = [
        ("π", std::f64::consts::PI),
        ("e", std::f64::consts::E),
        ("√2", std::f64::consts::SQRT_2),
        ("√3", 3f64.sqrt()),
        ("√5", sqrt5),
        ("φ", (1.0 + sqrt5) / 2.0),
        ("π²", std::f64::consts::PI * std::f64::consts::PI),
    ];
    let mut best: Option<(f64, f64, &str)> = None;
    for (sym, c) in constants {
        let q = n / c;
        let (num, den) = cf_convergent(q.abs(), 36.0);
        if den == 0.0 || num == 0.0 {
            continue;
        }
        let sign = if q > 0.0 { 1.0 } else if q < 0.0 { -1.0 } else { q };
        let approx = sign * (num / den) * c;
        let e = (approx - n).abs() / n.abs();
        if e < 1e-6 && best.is_none_or(|b| den < b.1) {
            best = Some((sign * num, den, sym));
        }
    }
    match best {
        Some((num, den, sym)) => {
            let p = num.abs();
            let top = format!("{}{sym}", if p == 1.0 { String::new() } else { number_to_string(p) });
            let body = if den == 1.0 { top } else { format!("{top}/{}", number_to_string(den)) };
            format!("{}{body}", if num < 0.0 { "-" } else { "" })
        }
        None => to_fraction(n, d),
    }
}

/// `applyCustomPattern`: the decimals the pattern's first `.0#` run names, grouped where it holds a comma.
fn custom_pattern(n: f64, pattern: &str) -> String {
    let b = pattern.as_bytes();
    let dp = (0..b.len())
        .find_map(|i| {
            let run = b[i + 1..].iter().take_while(|&&c| c == b'0' || c == b'#').count();
            (b[i] == b'.' && run > 0).then_some(run)
        })
        .unwrap_or(0);
    locale_fixed(n, dp, pattern.contains(','))
}

/// The electricity pack's SI prefix format (`toSiPrefix`).
fn si_prefix(n: f64) -> String {
    use crate::unit_value::to_precision;
    if !n.is_finite() {
        return number_to_string(n);
    }
    if n == 0.0 {
        return "0".into();
    }
    let n = to_precision(n, 3);
    let steps = [(1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "k"), (1.0, ""), (1e-3, "m"), (1e-6, "µ"), (1e-9, "n"), (1e-12, "p")];
    for (factor, prefix) in steps {
        if n.abs() >= factor {
            return format!("{}{prefix}", number_to_string(to_precision(n / factor, 3)));
        }
    }
    format!("{}p", number_to_string(to_precision(n / 1e-12, 3)))
}

/// The geometry pack's degrees-minutes-seconds format (`toDMS`).
fn dms(n: f64) -> String {
    if !n.is_finite() {
        return number_to_string(n);
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let deg = n.abs();
    let mut d = deg.floor();
    let mut m = ((deg - d) * 60.0).floor();
    let mut s = math_round((deg - d - m / 60.0) * 3600.0);
    if s == 60.0 {
        s = 0.0;
        m += 1.0;
    }
    if m == 60.0 {
        m = 0.0;
        d += 1.0;
    }
    format!("{sign}{}°{}′{}″", number_to_string(d), number_to_string(m), number_to_string(s))
}

/// `applyFormatStyle`.
fn apply_format_style(n: f64, ann: &Annotation, grouping: bool, d: NumberDisplay) -> String {
    if !n.is_finite() {
        return number_to_string(n);
    }
    let digits = ann.decimal_digits.unwrap_or(2.0);
    let sigfigs = ann.decimal_mode.as_deref() == Some("sigfigs");
    match ann.format.as_str() {
        "decimal" => format_precise(n, digits, sigfigs, grouping),
        "percent" => format!("{}%", format_precise(n * 100.0, digits, sigfigs, grouping)),
        "integer" => locale_fixed(math_round(n), 0, grouping),
        "fraction" => to_fraction(n, d),
        "fraction_adv" => to_fraction_advanced(n, d),
        "scientific" => {
            let r = math_round(digits);
            let places = clamp_js(if sigfigs { r - 1.0 } else { r }, 0.0, 20.0);
            to_exponential(n, places).unwrap_or_default()
        }
        "custom" => custom_pattern(n, ann.custom_pattern.as_deref().unwrap_or("0.00")),
        "siprefix" => si_prefix(n),
        "dms" => dms(n),
        _ => format_scalar(n, d),
    }
}

/// `formatNumberWithAnnotation`.
pub fn format_number_with_annotation(n: f64, ann: &Annotation, d: NumberDisplay) -> String {
    if !n.is_finite() {
        return number_to_string(n);
    }
    if is_date_style(&ann.format) {
        return format_date_serial(n, date_annotation_pattern(ann));
    }
    let f = ann.format.as_str();
    let scale_applies = f == "decimal" || f == "integer";
    let scale = match ann.scale_mode.as_deref() {
        Some(s) if !s.is_empty() && scale_applies => s,
        _ => "none",
    };
    let (divisor, suffix) = match scale {
        "none" => (1.0, ""),
        "k" => (1e3, "K"),
        "m" => (1e6, "M"),
        "b" => (1e9, "B"),
        _ => (f64::NAN, "undefined"),
    };
    let paren = matches!(ann.negative_style.as_deref(), Some("paren" | "redparen")) && f != "custom" && n < 0.0;
    let magnitude = (if paren { -n } else { n }) / divisor;
    let grouping = if f == "decimal" || f == "integer" || f == "percent" { ann.grouping != Some(false) } else { true };
    let formatted = format!("{}{suffix}", apply_format_style(magnitude, ann, grouping, d));
    let out = if ann.unit == "custom" {
        format!("{formatted}{}", ann.custom_unit.as_deref().unwrap_or(""))
    } else {
        match unit_label(&ann.unit) {
            ("", _) => formatted,
            (label, true) => format!("{label}{formatted}"),
            (label, false) => format!("{formatted}{label}"),
        }
    };
    if paren { format!("({out})") } else { out }
}

// ─── The Cards view's plan ──────────────────────────────────────────────────────

/// The rows the plan reads (`PROFILE_ROWS`).
pub const PROFILE_ROWS: usize = 2000;

/// `CardColumnInput`.
#[derive(Clone, Debug, Default)]
pub struct CardColumn {
    pub name: String,
    /// `number`, `string`, `date` or `logical`.
    pub ty: String,
    pub cells: Vec<String>,
    pub shown: Option<Vec<String>>,
    pub chip: bool,
    pub nested: bool,
    pub lists: bool,
}

impl CardColumn {
    pub fn from_json(j: &Json) -> CardColumn {
        let strs = |k: &str| j.get(k).and_then(Json::as_array).map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect::<Vec<_>>());
        let flag = |k: &str| j.get(k).and_then(Json::as_bool).unwrap_or(false);
        CardColumn {
            name: j.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
            ty: j.get("type").and_then(Json::as_str).unwrap_or("string").to_string(),
            cells: strs("cells").unwrap_or_default(),
            shown: strs("shown"),
            chip: flag("chip"),
            nested: flag("nested"),
            lists: flag("lists"),
        }
    }
}

struct Profile {
    filled: usize,
    distinct: usize,
    avg_len: f64,
    max_len: usize,
    images: usize,
    urls: usize,
    ints: bool,
    unique: bool,
    counting: bool,
    year_like: bool,
    hex_colors: bool,
    min: f64,
    max: f64,
    shown_percent: bool,
    shown_currency: bool,
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `^[a-z]{0,5}[-_ #/]?\d{1,10}$`, caseless.
fn is_code(t: &str) -> bool {
    let b = t.as_bytes();
    let letters = b.iter().take_while(|c| c.is_ascii_alphabetic()).count();
    if letters > 5 {
        return false;
    }
    let mut rest = &b[letters..];
    if let Some((c, r)) = rest.split_first() {
        if matches!(c, b'-' | b'_' | b' ' | b'#' | b'/') {
            rest = r;
        }
    }
    (1..=10).contains(&rest.len()) && rest.iter().all(u8::is_ascii_digit)
}

/// `^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$`, caseless.
pub fn is_hex_color(t: &str) -> bool {
    t.strip_prefix('#').is_some_and(|h| matches!(h.len(), 3 | 4 | 6 | 8) && h.bytes().all(|c| c.is_ascii_hexdigit()))
}

fn strip_ci<'a>(t: &'a str, prefix: &str) -> Option<&'a str> {
    (t.len() >= prefix.len() && t.is_char_boundary(prefix.len()) && t[..prefix.len()].eq_ignore_ascii_case(prefix)).then(|| &t[prefix.len()..])
}

fn http_rest(t: &str) -> Option<&str> {
    strip_ci(t, "http://").or_else(|| strip_ci(t, "https://"))
}

/// `^https?:\/\/[^\s/$.?#][^\s]*$`, caseless.
fn is_url(t: &str) -> bool {
    let Some(rest) = http_rest(t) else { return false };
    let mut chars = rest.chars();
    matches!(chars.next(), Some(c) if !is_js_space(c) && !"/$.?#".contains(c)) && chars.all(|c| !is_js_space(c))
}

/// `^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$`.
fn is_email(t: &str) -> bool {
    let ok = |c: char| !is_js_space(c) && !"@<>()".contains(c);
    let Some((local, domain)) = t.split_once('@') else { return false };
    if local.is_empty() || !local.chars().all(ok) || !domain.chars().all(ok) {
        return false;
    }
    domain.char_indices().any(|(i, c)| c == '.' && i > 0 && i + 1 < domain.len())
}

/// `cellImageSrc`'s test: a `data:image/` URL.
fn is_data_image(t: &str) -> bool {
    strip_ci(t, "data:image/").is_some()
}

/// `linkHref`: an http(s) URL as it is, an email address as `mailto:`.
pub fn link_href(text: &str) -> Option<String> {
    let t = js_trim(text);
    if is_url(t) {
        Some(t.to_string())
    } else if is_email(t) {
        Some(format!("mailto:{t}"))
    } else {
        None
    }
}

/// `recordImageSrc`: a `data:image` URL, or an http(s) URL with an image extension.
pub fn record_image_src(text: &str) -> Option<String> {
    let t = js_trim(text);
    if is_data_image(t) {
        return Some(t.to_string());
    }
    let rest = http_rest(t)?;
    if rest.chars().any(is_js_space) {
        return None;
    }
    let ends = std::iter::once(rest.len()).chain(rest.char_indices().filter(|(_, c)| *c == '?').map(|(i, _)| i));
    let image = ends.into_iter().any(|e| {
        let head = &rest[..e];
        ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].iter().any(|ext| {
            head.len() > ext.len() + 1 && head.is_char_boundary(head.len() - ext.len() - 1) && {
                let (stem, tail) = head.split_at(head.len() - ext.len() - 1);
                tail.as_bytes()[0] == b'.' && tail[1..].eq_ignore_ascii_case(ext) && !stem.is_empty()
            }
        })
    });
    image.then(|| t.to_string())
}

const CURRENCY: &[char] = &['$', '€', '£', '¥', '₹', '₩', '₽', '₺', '₫', '₪', '฿'];

/// A column's profile, and whether every filled cell reads like an order or invoice code (`SO-1042`, `A12`, `#77`).
fn profile(col: &CardColumn) -> (Profile, bool) {
    let n = col.cells.len().min(PROFILE_ROWS);
    let mut seen: HashSet<&str> = HashSet::new();
    let (mut filled, mut total, mut max_len, mut images, mut urls) = (0, 0, 0, 0, 0);
    let (mut ints, mut year_like, mut codes, mut hex_colors, mut shown_percent, mut shown_currency) = (true, true, true, true, true, true);
    let mut counting = n > 1;
    let mut prev: Option<f64> = None;
    let (mut min, mut max) = (f64::INFINITY, f64::NEG_INFINITY);
    let number = col.ty == "number";
    for r in 0..n {
        let t = js_trim(&col.cells[r]);
        if t.is_empty() {
            counting = false;
            continue;
        }
        filled += 1;
        seen.insert(t);
        let len = utf16_len(t);
        total += len;
        max_len = max_len.max(len);
        if !is_code(t) {
            codes = false;
        }
        if !is_hex_color(t) {
            hex_colors = false;
        }
        if col.ty == "string" {
            if is_data_image(t) {
                images += 1;
            } else if is_url(t) {
                urls += 1;
            }
        }
        let s = js_trim(col.shown.as_ref().and_then(|sh| sh.get(r)).map_or(t, String::as_str));
        if !s.ends_with('%') {
            shown_percent = false;
        }
        if !s.contains(CURRENCY) {
            shown_currency = false;
        }
        if number {
            let v = crate::value_kinds::decimal_from_text(t);
            if v < min {
                min = v;
            }
            if v > max {
                max = v;
            }
            let is_int = v.fract() == 0.0;
            if !is_int {
                ints = false;
            }
            if !is_int || !(1800.0..=2200.0).contains(&v) {
                year_like = false;
            }
            if !is_int || prev.is_some_and(|p| v != p + 1.0) {
                counting = false;
            }
            prev = Some(v);
        }
    }
    let numeric = number && filled > 0 && min.is_finite() && max.is_finite();
    let text = col.ty == "string" && filled > 0;
    let p = Profile {
        filled,
        distinct: seen.len(),
        avg_len: if filled > 0 { total as f64 / filled as f64 } else { 0.0 },
        max_len,
        images,
        urls,
        ints: numeric && ints,
        unique: seen.len() == filled,
        counting: numeric && counting,
        year_like: numeric && year_like,
        hex_colors: text && hex_colors,
        min: if numeric { min } else { f64::NAN },
        max: if numeric { max } else { f64::NAN },
        shown_percent: filled > 0 && shown_percent,
        shown_currency: filled > 0 && shown_currency,
    };
    (p, text && codes)
}

/// `nameWords`: the lowercase words of a column name, split at spaces, punctuation and camelCase humps; `#` stays a
/// word.
pub fn name_words(name: &str) -> Vec<String> {
    let chars: Vec<char> = name.chars().collect();
    let mut humped = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if (c.is_ascii_lowercase() || c.is_ascii_digit()) && chars.get(i + 1).is_some_and(char::is_ascii_uppercase) {
            humped.push(c);
            humped.push(' ');
            humped.push(chars[i + 1]);
            i += 2;
        } else {
            humped.push(c);
            i += 1;
        }
    }
    js_lower(&humped)
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '#'))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

const KEY_WORDS: &[&str] = &["id", "#", "no", "sku", "uuid", "key", "ref", "code", "idx", "index", "isbn"];
const KEY_LAST_WORDS: &[&str] = &["id", "no", "num", "number", "code", "ref", "sku", "#"];
const TITLE_WORDS: &[&str] = &[
    "name", "title", "label", "item", "product", "subject", "person", "customer", "client", "company", "city", "country", "task",
    "project", "heading", "username", "user", "contact", "employee", "student", "member", "team", "place", "venue", "event", "song",
    "book", "film", "movie", "nickname", "model", "brand", "recipe", "dish", "vehicle", "species", "plant", "animal", "game", "album",
    "artist", "track", "episode", "show", "location", "store", "shop", "vendor", "supplier", "account", "asset", "part", "device",
    "host", "server", "service", "feature", "issue", "ticket", "milestone", "goal", "habit", "campaign", "course", "school", "hotel",
    "restaurant", "destination", "trip", "organization", "organisation", "org", "business", "character", "player", "author",
];
const PROSE_WORDS: &[&str] = &[
    "description", "desc", "notes", "note", "comments", "comment", "summary", "bio", "about", "details", "remarks", "memo",
    "abstract", "body", "message", "review", "feedback", "instructions", "synopsis",
];
const TAG_WORDS: &[&str] = &["tags", "tag", "labels", "keywords", "categories", "skills", "topics", "genres", "genre"];
const RATING_WORDS: &[&str] = &["rating", "ratings", "stars", "star"];
const METER_WORDS: &[&str] = &[
    "progress", "percent", "percentage", "pct", "completion", "complete", "completed", "done", "share", "probability", "confidence",
    "utilization", "utilisation", "usage", "coverage", "battery", "humidity", "occupancy", "attendance", "accuracy",
];
const START_WORDS: &[&str] = &["start", "starts", "from", "begin", "begins", "checkin", "departure", "depart", "opened", "open"];
const END_WORDS: &[&str] = &["end", "ends", "to", "until", "finish", "finished", "due", "checkout", "return", "closed", "close"];
const HERO_WORDS: &[&str] = &[
    "total", "grand", "subtotal", "amount", "balance", "net", "gross", "revenue", "sales", "income", "profit", "earnings", "due",
    "paid", "salary", "pay", "budget", "price", "cost", "fee", "rent", "expense", "spend", "spent", "value", "worth", "valuation",
    "score", "points", "sum",
];

const PROSE_AVG: f64 = 40.0;
const PROSE_MAX: usize = 90;
const PROSE_NAMED_AVG: f64 = 20.0;
const CHIP_MAX_LEN: usize = 24;
const CHIP_MAX_DISTINCT: usize = 8;
const TITLE_MAX_AVG: f64 = 40.0;
const KEY_MAX_LEN: usize = 16;

fn has(words: &[String], set: &[&str]) -> bool {
    words.iter().any(|w| set.contains(&w.as_str()))
}

fn has_word(words: &[String], w: &str) -> bool {
    words.iter().any(|x| x == w)
}

fn is_key_name(words: &[String]) -> bool {
    match words {
        [] => false,
        [w] => KEY_WORDS.contains(&w.as_str()),
        [.., last] => KEY_LAST_WORDS.contains(&last.as_str()),
    }
}

fn hero_rank(words: &[String]) -> usize {
    words.iter().filter_map(|w| HERO_WORDS.iter().position(|h| h == w)).min().unwrap_or(usize::MAX)
}

fn first_name(w: &[String]) -> bool {
    has_word(w, "first") || has_word(w, "given") || has_word(w, "forename")
}

fn middle_name(w: &[String]) -> bool {
    has_word(w, "middle")
}

fn last_name(w: &[String]) -> bool {
    has_word(w, "last") || has_word(w, "family") || has_word(w, "surname")
}

/// `planCards`: which part of a card each column fills, every tie to the column further left.
pub fn plan_cards(cols: &[CardColumn]) -> Json {
    let (profiles, codes): (Vec<Profile>, Vec<bool>) = cols.iter().map(profile).unzip();
    let words: Vec<Vec<String>> = cols.iter().map(|c| name_words(&c.name)).collect();
    let rows = cols.iter().map(|c| c.cells.len().min(PROFILE_ROWS)).max().unwrap_or(0);
    let mut taken: HashSet<usize> = HashSet::new();
    let free = |taken: &HashSet<usize>, pred: &dyn Fn(usize) -> bool| -> Vec<usize> {
        (0..cols.len()).filter(|&i| !taken.contains(&i) && profiles[i].filled > 0 && pred(i)).collect()
    };
    let first = |taken: &HashSet<usize>, pred: &dyn Fn(usize) -> bool| free(taken, pred).first().copied();

    let is_text = |i: usize| cols[i].ty == "string" && !cols[i].nested;
    let is_num = |i: usize| cols[i].ty == "number";
    let is_date = |i: usize| cols[i].ty == "date";
    let is_links = |i: usize| profiles[i].urls * 2 >= profiles[i].filled && profiles[i].urls > 0;
    let is_images = |i: usize| profiles[i].images * 2 >= profiles[i].filled && profiles[i].images > 0;
    let is_plain_text = |i: usize| is_text(i) && !is_links(i) && !is_images(i);

    let image = first(&taken, &|i| is_text(i) && is_images(i));
    taken.extend(image);
    let swatches = free(&taken, &|i| profiles[i].hex_colors);
    taken.extend(swatches.iter().copied());

    let key = first(&taken, &|i| {
        let p = &profiles[i];
        if !p.unique {
            return false;
        }
        if is_num(i) {
            return p.ints && (is_key_name(&words[i]) || (i == 0 && p.counting));
        }
        is_text(i) && (is_key_name(&words[i]) || (codes[i] && !has(&words[i], TITLE_WORDS))) && p.max_len <= KEY_MAX_LEN
    });
    taken.extend(key);

    let named = |i: usize, which: fn(&[String]) -> bool| is_text(i) && which(&words[i]) && has_word(&words[i], "name");
    let first_n = first(&taken, &|i| named(i, first_name));
    let last_n = first_n.and_then(|_| first(&taken, &|i| named(i, last_name)));
    let middle_n = last_n.and_then(|_| first(&taken, &|i| named(i, middle_name)));
    let mut title: Option<usize> = None;
    let mut title_rest: Vec<usize> = Vec::new();
    if let (Some(f), Some(l)) = (first_n, last_n) {
        title = Some(f);
        taken.insert(f);
        title_rest = match middle_n {
            Some(m) => vec![m, l],
            None => vec![l],
        };
        taken.extend(title_rest.iter().copied());
    }

    let tags = free(&taken, &|i| has(&words[i], TAG_WORDS) && (cols[i].lists || (is_plain_text(i) && profiles[i].max_len <= PROSE_MAX)));
    taken.extend(tags.iter().copied());

    let prose = free(&taken, &|i| {
        if !is_plain_text(i) {
            return false;
        }
        let p = &profiles[i];
        p.avg_len > PROSE_AVG || p.max_len > PROSE_MAX || (has(&words[i], PROSE_WORDS) && p.avg_len > PROSE_NAMED_AVG)
    });
    taken.extend(prose.iter().copied());

    let chip_cap = (rows / 2).clamp(2, CHIP_MAX_DISTINCT);
    let chips = free(&taken, &|i| {
        if !is_plain_text(i) {
            return false;
        }
        if cols[i].chip {
            return true;
        }
        let p = &profiles[i];
        rows >= 3 && p.distinct <= chip_cap && p.distinct < p.filled && p.max_len <= CHIP_MAX_LEN
    });
    taken.extend(chips.iter().copied());

    if title.is_none() {
        let mut best = -1i32;
        let name_like = |i: usize| has(&words[i], TITLE_WORDS) && !(last_name(&words[i]) || middle_name(&words[i]));
        for i in free(&taken, &|j| is_plain_text(j) && profiles[j].avg_len <= TITLE_MAX_AVG) {
            let p = &profiles[i];
            let ratio = p.distinct as f64 / p.filled as f64;
            let score = (if name_like(i) { 4 } else { 0 })
                + (if ratio >= 0.9 { 2 } else if ratio >= 0.5 { 1 } else { 0 })
                + i32::from(p.avg_len >= 2.0 && p.avg_len <= 32.0);
            if score > best {
                best = score;
                title = Some(i);
            }
        }
        taken.extend(title);
    }

    let subtitle = if title.is_none() { None } else { first(&taken, &|i| is_plain_text(i) && profiles[i].avg_len <= PROSE_AVG) };
    taken.extend(subtitle);

    let mut meta = first(&taken, &is_date);
    taken.extend(meta);
    let mut meta_end = None;
    if let Some(m) = meta {
        if has(&words[m], START_WORDS) {
            meta_end = first(&taken, &|i| is_date(i) && has(&words[i], END_WORDS));
            taken.extend(meta_end);
        }
    }
    if meta.is_none() {
        meta = first(&taken, &|i| is_num(i) && profiles[i].year_like && has_word(&words[i], "year"));
        taken.extend(meta);
    }

    let ratings = free(&taken, &|i| is_num(i) && has(&words[i], RATING_WORDS) && profiles[i].min >= 0.0 && profiles[i].max <= 5.0);
    taken.extend(ratings.iter().copied());

    let meters: Vec<(usize, f64)> = free(&taken, &|i| {
        if !is_num(i) {
            return false;
        }
        let p = &profiles[i];
        if p.min < 0.0 {
            return false;
        }
        if p.shown_percent {
            return true;
        }
        (has(&words[i], METER_WORDS) || cols[i].name.contains('%')) && p.max <= 100.0
    })
    .into_iter()
    .map(|col| (col, if profiles[col].shown_percent || profiles[col].max <= 1.0 { 1.0 } else { 100.0 }))
    .collect();
    taken.extend(meters.iter().map(|m| m.0));

    let hero_pool = free(&taken, &is_num);
    let mut hero = None;
    let mut best_rank = usize::MAX;
    for &i in &hero_pool {
        let r = hero_rank(&words[i]);
        if r < best_rank {
            best_rank = r;
            hero = Some(i);
        }
    }
    if hero.is_none() {
        hero = hero_pool.iter().copied().find(|&i| profiles[i].shown_currency);
    }
    if hero.is_none() {
        hero = hero_pool.iter().rev().copied().find(|&i| !profiles[i].year_like && !is_key_name(&words[i]));
    }
    taken.extend(hero);

    let flags = free(&taken, &|i| cols[i].ty == "logical");
    taken.extend(flags.iter().copied());

    let stats: Vec<usize> = (0..cols.len()).filter(|i| !taken.contains(i)).collect();
    let meters: Vec<Json> = meters.iter().map(|(col, max)| json!({ "col": col, "max": *max as i64 })).collect();
    json!({
        "image": image, "key": key, "title": title, "titleRest": title_rest, "subtitle": subtitle, "meta": meta,
        "metaEnd": meta_end, "hero": hero, "chips": chips, "tags": tags, "swatches": swatches, "flags": flags,
        "ratings": ratings, "meters": meters, "stats": stats, "prose": prose,
    })
}

// ─── The Record layout ──────────────────────────────────────────────────────────

/// `RecordPlacement`.
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub name: String,
    pub row: usize,
    pub col: usize,
    pub row_span: usize,
    pub col_span: usize,
    pub hint: String,
    pub title: bool,
}

impl Placement {
    pub fn to_json(&self) -> Json {
        let mut o = serde_json::Map::new();
        o.insert("name".into(), json!(self.name));
        o.insert("row".into(), json!(self.row));
        o.insert("col".into(), json!(self.col));
        o.insert("rowSpan".into(), json!(self.row_span));
        o.insert("colSpan".into(), json!(self.col_span));
        if !self.hint.is_empty() {
            o.insert("hint".into(), json!(self.hint));
        }
        if self.title {
            o.insert("title".into(), json!(true));
        }
        Json::Object(o)
    }
}

/// `/^(.*?)\s*\*\s*(\d+)$/`: the name before a span and the span's digits.
fn span_of(head: &str) -> Option<(&str, &str)> {
    head.char_indices().map(|(i, _)| i).chain(std::iter::once(head.len())).find_map(|i| {
        let rest = head[i..].trim_start_matches(is_js_space);
        let rest = rest.strip_prefix('*')?.trim_start_matches(is_js_space);
        (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())).then(|| (&head[..i], rest))
    })
}

struct Rect {
    name: String,
    hint: String,
    title: bool,
    r0: usize,
    c0: usize,
    r1: usize,
    c1: usize,
}

fn overlaps(a: (usize, usize, usize, usize), placed: &[(usize, usize, usize, usize)]) -> bool {
    placed.iter().any(|p| a.0 <= p.2 && p.0 <= a.2 && a.1 <= p.3 && p.1 <= a.3)
}

/// `parseRecordLayout`: a line per row, names split by `|`, a repeat merging, `*n` spanning, `#` titling, `: hint`.
pub fn parse_record_layout(text: &str) -> Vec<Placement> {
    struct Cell {
        name: String,
        hint: String,
        title: bool,
    }
    let rows: Vec<Vec<Cell>> = text
        .split('\n')
        .map(|line| {
            line.split('|')
                .flat_map(|raw| {
                    let cell = js_trim(raw);
                    let (head, hint) = match cell.find(':') {
                        Some(ci) => (js_trim(&cell[..ci]), js_trim(&cell[ci + 1..])),
                        None => (cell, ""),
                    };
                    let m = span_of(head);
                    let named = m.map_or(head, |(n, _)| js_trim(n));
                    let title = named.starts_with('#');
                    let name = if title { js_trim(&named[1..]) } else { named };
                    let span = m.map_or(1.0, |(_, d)| string_to_number(d).clamp(1.0, 12.0)) as usize;
                    (0..span).map(move |i| Cell { name: name.to_string(), hint: if i == 0 { hint.to_string() } else { String::new() }, title }).collect::<Vec<_>>()
                })
                .collect::<Vec<_>>()
        })
        .filter(|cells| cells.iter().any(|c| !c.name.is_empty() && c.name != "."))
        .collect();
    let mut rects: HashMap<String, Rect> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut cells_of: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    for (r, cells) in rows.iter().enumerate() {
        for (c, cell) in cells.iter().enumerate() {
            if cell.name.is_empty() || cell.name == "." {
                continue;
            }
            let key = js_lower(&cell.name).into_owned();
            cells_of.entry(key.clone()).or_default().push((r, c));
            match rects.get_mut(&key) {
                None => {
                    rects.insert(key.clone(), Rect { name: cell.name.clone(), hint: cell.hint.clone(), title: cell.title, r0: r, c0: c, r1: r, c1: c });
                    order.push(key);
                }
                Some(rect) => {
                    rect.r0 = rect.r0.min(r);
                    rect.c0 = rect.c0.min(c);
                    rect.r1 = rect.r1.max(r);
                    rect.c1 = rect.c1.max(c);
                    if rect.hint.is_empty() {
                        rect.hint = cell.hint.clone();
                    }
                    if cell.title {
                        rect.title = true;
                    }
                }
            }
        }
    }
    let mut placed: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut spare_row = rows.len();
    for key in &order {
        let t = rects.get_mut(key).expect("every ordered key has a box");
        if overlaps((t.r0, t.c0, t.r1, t.c1), &placed) {
            let free = cells_of[key].iter().copied().find(|&(r, c)| !overlaps((r, c, r, c), &placed));
            let (r, c) = free.unwrap_or_else(|| {
                spare_row += 1;
                (spare_row - 1, 0)
            });
            (t.r0, t.r1, t.c0, t.c1) = (r, r, c, c);
        }
        placed.push((t.r0, t.c0, t.r1, t.c1));
    }
    order
        .iter()
        .map(|key| {
            let t = &rects[key];
            Placement { name: t.name.clone(), row: t.r0 + 1, col: t.c0 + 1, row_span: t.r1 - t.r0 + 1, col_span: t.c1 - t.c0 + 1, hint: t.hint.clone(), title: t.title }
        })
        .collect()
}
