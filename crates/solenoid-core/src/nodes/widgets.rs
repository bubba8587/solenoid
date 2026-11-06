//! [[C28]] literalsIffEditable, [[C44]] dateSerials, [[C118]] formatTravelsWithValue, [[C23]] calcModes,
//! [[C103]] untrustedContentSeams.
//! The input widgets' bodies (Value Input, Slider, Color Picker and Blend, Angle Dial, XY Pad, Curve, Grid Painter,
//! Point Plotter, Date Range, Constant, Input Switch), RAND over its shell's roll, SVG Picker over its scrubbed markup.

use super::frames::{cube_from_columns, json_num};
use super::values::{Column, CubeColumn, Frame};
use super::Cv;
use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::{num_blank_zero, value_text, V};
use crate::frame::FrameColType;
use crate::jsnum::{
    fixed_text, is_space_char, lower_text, nan_max, nan_min, number_to_string, round_half_up, trim_space,
};
use serde_json::{json, Value as Json};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ValueInputNode" => value_input(c),
        "SliderInputNode" => slider(c),
        "ColorPickerNode" => color_picker(c),
        "ColorBlendNode" => color_blend(c),
        "AngleDialNode" => Ok(vec![("value".into(), Cv::from(init_v(c, "value")))]),
        "XYPadNode" => xy_pad(c),
        "CurveNode" => curve(c),
        "GridPainterNode" => grid_painter(c),
        "PointPlotterNode" => point_plotter(c),
        "DateRangeNode" => date_range(c),
        "ConstantNode" => constant(c),
        "CableSwitchNode" => cable_switch(c),
        "RandBetweenNode" => rand_between(c),
        "SvgPickerNode" => svg_picker(c),
        _ => return None,
    })
}

/// A saved or run-time field as its value, `undefined` where the card has none.
fn init_v(c: &Call, key: &str) -> V {
    c.field(key).map(super::decode).unwrap_or(V::Undef)
}

fn init_num(c: &Call, key: &str, dflt: f64) -> f64 {
    match init_v(c, key) {
        V::Num(n) => n,
        _ => dflt,
    }
}

/// `this.literals[key] ?? dflt`.
fn literal_or(c: &Call, key: &str, dflt: V) -> V {
    match c.unwired(key) {
        V::Undef | V::Null => dflt,
        v => v,
    }
}

fn literal_num(c: &Call, key: &str, dflt: f64) -> f64 {
    num_blank_zero(&literal_or(c, key, V::Num(dflt)))
}

/// NaN passes through.
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

fn num_column(name: &str, values: Vec<V>) -> Column {
    Column { name: name.to_string(), ty: FrameColType::Number, values, unit: None, format: None, raw: None }
}

fn frame_of(columns: Vec<Column>) -> Cv {
    Cv::Frame(Rc::new(Frame { columns, total_rows: None, approx: None, source: None, layout: None }))
}

// ─── Value Input, Slider ────────────────────────────────────────────────────────

/// One typed number in the FC's unit: its base value, a custom unit its own dimension.
fn fc_number(n: f64, unit: &str, custom: &str) -> V {
    let custom = trim_space(custom);
    if unit == "custom" && !custom.is_empty() {
        let dim = std::iter::once((format!("custom:{}", lower_text(trim_space(custom))), 1.0)).collect();
        return super::units::from_unit(n, &crate::unit_catalog::Unit { dim, scale: 1.0, offset: None }, None);
    }
    match crate::unit_catalog::fc_unit_to_unit(unit) {
        Some(u) => super::units::from_unit(n, &u, Some(unit)),
        None => V::Num(n),
    }
}

fn value_input(c: &mut Call) -> Answer {
    let value = c.field_str("value", "").to_string();
    let out = match c.field_str("op", "number") {
        // Nothing typed is nothing, not empty text: a blank downstream (ISBLANK is TRUE). Spaces are text.
        "string" if value.is_empty() => V::Null,
        "string" => V::str(&value),
        "logical" => {
            // The card keeps its type: TRUE or FALSE reads, blank is FALSE, anything else is #VALUE!.
            let t = trim_space(&value);
            if t.is_empty() || t.eq_ignore_ascii_case("false") {
                V::Bool(false)
            } else if t.eq_ignore_ascii_case("true") {
                V::Bool(true)
            } else {
                err(ErrorCode::Value, format!("\"{t}\" isn't TRUE or FALSE"))
            }
        }
        "number" => {
            let t = trim_space(&value);
            let n = if t.is_empty() { 0.0 } else { crate::value_kinds::decimal_from_text(t) };
            if n.is_finite() {
                fc_number(n, c.field_str("unit", "none"), c.field_str("customUnit", ""))
            } else {
                err(ErrorCode::Value, format!("\"{t}\" isn't a number"))
            }
        }
        "date" => crate::date_values::wrap(&value_input_date(c, &value)),
        _ => V::Null,
    };
    if c.field_str("op", "number") != "date" {
        forget_relative(c);
    }
    c.show("cachedValue", out.clone());
    Ok(vec![("value".into(), Cv::from(out))])
}

/// No relative phrase read: what was last read goes, so the phrase typed again later reads afresh.
fn forget_relative(c: &mut Call) {
    if c.field("lastRelativeText").is_some_and(|v| !v.is_null()) {
        c.show("lastRelativeText", V::Null);
        c.show("lastRelativeSerial", V::Null);
    }
}

/// A typed date's serial. A relative phrase ([[C44]] dateSerials) reads at the pass's clock, when Settings allows
/// them (`relativeDates`), and shows what it last read (`lastRelativeText`, `lastRelativeSerial`), so the same phrase
/// landing on a new day shows the alert to raise (`alertKey`, `alertMessage`).
fn value_input_date(c: &mut Call, value: &str) -> V {
    use crate::excel_criteria::{parse_date, DateReading};
    let text = trim_space(value).to_string();
    let allowed = matches!(c.field("relativeDates"), Some(Json::Bool(true)));
    let relative = crate::relative_date::is_relative(&text);
    if !(allowed && relative) {
        forget_relative(c);
        return match parse_date(&text) {
            DateReading::Serial(s) if s.is_finite() => V::Num(s.floor()),
            DateReading::Ambiguous(e) => V::err(e),
            // Blank stays blank, and so does a relative phrase while Settings turns them off ([[C44]] dateSerials);
            // other text the card can't read as a date is #VALUE!, as a Number card's is.
            _ if text.is_empty() || relative => V::Null,
            _ => err(ErrorCode::Value, format!("\"{text}\" isn't a date")),
        };
    }
    let now = crate::excel_functions::clock_instant();
    let Some(serial) = crate::relative_date::relative_date(&text, now) else {
        forget_relative(c);
        return err(ErrorCode::Value, format!("\"{text}\" isn't a date this can read"));
    };
    let serial = serial.floor();
    let last_text = c.field("lastRelativeText").and_then(Json::as_str).map(str::to_string);
    let last_serial = c.field("lastRelativeSerial").and_then(Json::as_f64);
    let (key, message) = match (last_text, last_serial) {
        (Some(t), Some(was)) if t == text && was != serial => {
            let label = trim_space(c.field_str("label", "")).to_string();
            let name = if label.is_empty() { "Value Input".to_string() } else { label };
            let day = |s: f64| crate::date_serial::format_date_serial(s, "DD-MMM-YYYY");
            (
                V::str(&format!("{text}\u{1}{serial}")),
                V::str(&format!("{name}: \"{text}\" now resolves to {} (was {})", day(serial), day(was))),
            )
        }
        _ => (V::Null, V::Null),
    };
    c.show("alertKey", key);
    c.show("alertMessage", message);
    c.show("lastRelativeText", V::str(&text));
    c.show("lastRelativeSerial", V::Num(serial));
    V::Num(serial)
}

fn slider(c: &mut Call) -> Answer {
    let lit = |c: &Call, key: &str, dflt: f64| literal_or(c, key, V::Num(dflt));
    let (lit_min, lit_max, lit_step) = (lit(c, "min", 0.0), lit(c, "max", 100.0), lit(c, "step", 1.0));
    // `v != null && Number.isFinite(v) ? v : lit`.
    let finite = |v: V, lit: &V| match v {
        V::Num(n) if n.is_finite() => n,
        _ => num_blank_zero(lit),
    };
    let mut lo = finite(c.read_input("min", lit_min.clone()), &lit_min);
    let mut hi = finite(c.read_input("max", lit_max.clone()), &lit_max);
    if lo > hi {
        std::mem::swap(&mut lo, &mut hi);
    }
    let step = finite(c.read_input("step", lit_step.clone()), &lit_step);
    let step = if step > 0.0 { step } else { num_blank_zero(&lit_step) };
    let value = nan_min(nan_max(num_blank_zero(&init_v(c, "value")), lo), hi);
    c.show("effectiveMin", V::Num(lo));
    c.show("effectiveMax", V::Num(hi));
    c.show("effectiveStep", V::Num(step));
    c.show("value", V::Num(value));
    Ok(vec![("value".into(), Cv::from(V::Num(value)))])
}

// ─── Colours (colord) ───────────────────────────────────────────────────────────

/// `colord`'s rgba, its channels as parsed (0–255, alpha 0–1).
#[derive(Clone, Copy)]
struct Rgba {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

const BLACK: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

/// colord's `round(n, digits)`: `Math.round(10^d·n)/10^d + 0`.
fn round_to(n: f64, digits: i32) -> f64 {
    let p = libm::pow(10.0, f64::from(digits));
    round_half_up(p * n) / p + 0.0
}

/// colord's `clamp(n, lo, hi)`: NaN reads as `lo`.
fn cclamp(n: f64, lo: f64, hi: f64) -> f64 {
    if n > hi {
        hi
    } else if n > lo {
        n
    } else {
        lo
    }
}

fn clamp_rgba(c: Rgba) -> Rgba {
    Rgba {
        r: cclamp(c.r, 0.0, 255.0),
        g: cclamp(c.g, 0.0, 255.0),
        b: cclamp(c.b, 0.0, 255.0),
        a: cclamp(c.a, 0.0, 1.0),
    }
}

fn round_rgba(c: Rgba) -> Rgba {
    Rgba { r: round_to(c.r, 0), g: round_to(c.g, 0), b: round_to(c.b, 0), a: round_to(c.a, 3) }
}

/// colord's `clampHue`.
fn clamp_hue(h: f64) -> f64 {
    let h = if h.is_finite() { h % 360.0 } else { 0.0 };
    if h < 0.0 {
        h + 360.0
    } else {
        h
    }
}

fn hsv_to_rgba(h: f64, s: f64, v: f64, a: f64) -> Rgba {
    let t = h / 360.0 * 6.0;
    let (n, u) = (s / 100.0, v / 100.0);
    let o = t.floor();
    let lo = u * (1.0 - n);
    let i = u * (1.0 - (t - o) * n);
    let s = u * (1.0 - (1.0 - t + o) * n);
    let d = o % 6.0;
    let pick = |xs: [f64; 6]| if d >= 0.0 && d < 6.0 { 255.0 * xs[d as usize] } else { f64::NAN };
    Rgba { r: pick([u, i, lo, lo, s, u]), g: pick([s, u, u, i, lo, lo]), b: pick([lo, lo, s, u, u, i]), a }
}

/// An hsv colour as its object parser takes it: the hue wrapped, the rest clamped.
fn from_hsv(h: f64, s: f64, v: f64, a: f64) -> Rgba {
    hsv_to_rgba(clamp_hue(h), cclamp(s, 0.0, 100.0), cclamp(v, 0.0, 100.0), cclamp(a, 0.0, 1.0))
}

fn from_hsl(h: f64, s: f64, l: f64, a: f64) -> Rgba {
    let (h, s, l, a) = (clamp_hue(h), cclamp(s, 0.0, 100.0), cclamp(l, 0.0, 100.0), cclamp(a, 0.0, 1.0));
    let n = s * (if l < 50.0 { l } else { 100.0 - l }) / 100.0;
    hsv_to_rgba(h, if n > 0.0 { 2.0 * n / (l + n) * 100.0 } else { 0.0 }, l + n, a)
}

fn hex_digit(c: u8) -> f64 {
    f64::from((15 & c) + 9 * (c >> 6))
}

fn parse_hex(s: &str) -> Option<Rgba> {
    let b = s.as_bytes();
    if b.first() != Some(&b'#') || !(4..=9).contains(&b.len()) || !b[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let pair = |i: usize| hex_digit(b[i]) * 16.0 + hex_digit(b[i + 1]);
    match b.len() {
        4 | 5 => Some(Rgba {
            r: 17.0 * hex_digit(b[1]),
            g: 17.0 * hex_digit(b[2]),
            b: 17.0 * hex_digit(b[3]),
            a: if b.len() == 5 { round_to(17.0 * hex_digit(b[4]) / 255.0, 2) } else { 1.0 },
        }),
        7 | 9 => Some(Rgba {
            r: pair(1),
            g: pair(3),
            b: pair(5),
            a: if b.len() == 9 { round_to(pair(7) / 255.0, 2) } else { 1.0 },
        }),
        _ => None,
    }
}

/// A cursor over colour text, for the `rgb()` and `hsl()` grammars colord's regexes spell.
struct Scan<'a> {
    s: &'a str,
    at: usize,
}

impl<'a> Scan<'a> {
    fn rest(&self) -> &'a str {
        &self.s[self.at..]
    }

    fn ws(&mut self) -> usize {
        let start = self.at;
        while let Some(ch) = self.rest().chars().next().filter(|&ch| is_space_char(ch)) {
            self.at += ch.len_utf8();
        }
        self.at - start
    }

    fn lit(&mut self, t: &str) -> bool {
        let ok = self.rest().len() >= t.len() && self.rest().as_bytes()[..t.len()].eq_ignore_ascii_case(t.as_bytes());
        if ok {
            self.at += t.len();
        }
        ok
    }

    /// `[+-]?(?:\d*\.\d+|\d+)`.
    fn num(&mut self) -> Option<f64> {
        let b = self.rest().as_bytes();
        let mut i = usize::from(matches!(b.first(), Some(b'+' | b'-')));
        let int = b[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        i += int;
        let frac =
            if b.get(i) == Some(&b'.') { b[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count() } else { 0 };
        if frac > 0 {
            i += 1 + frac;
        } else if int == 0 {
            return None;
        }
        let t = &self.rest()[..i];
        self.at += i;
        Some(crate::value_kinds::decimal_from_text(t))
    }

    fn end(&self) -> bool {
        self.at == self.s.len()
    }
}

/// `rgba?(r, g, b[, a])` or `rgba?(r g b[ / a])`.
fn parse_rgb(s: &str, spaced: bool) -> Option<Rgba> {
    let mut p = Scan { s, at: 0 };
    if !p.lit("rgb") {
        return None;
    }
    p.lit("a");
    if !p.lit("(") {
        return None;
    }
    p.ws();
    let mut ch = [(0.0, false); 3];
    for (k, slot) in ch.iter_mut().enumerate() {
        if k > 0 {
            if spaced {
                if p.ws() == 0 {
                    return None;
                }
            } else {
                p.ws();
                if !p.lit(",") {
                    return None;
                }
                p.ws();
            }
        }
        *slot = (p.num()?, p.lit("%"));
    }
    p.ws();
    let mut alpha = (1.0, false);
    let sep = if spaced { "/" } else { "," };
    if p.lit(sep) {
        p.ws();
        alpha = (p.num()?, p.lit("%"));
        p.ws();
    }
    if !p.lit(")") || !p.end() {
        return None;
    }
    if ch[0].1 != ch[1].1 || ch[1].1 != ch[2].1 {
        return None;
    }
    let chan = |(n, pct): (f64, bool)| if pct { n / (100.0 / 255.0) } else { n };
    Some(clamp_rgba(Rgba {
        r: chan(ch[0]),
        g: chan(ch[1]),
        b: chan(ch[2]),
        a: if alpha.1 { alpha.0 / 100.0 } else { alpha.0 },
    }))
}

/// `hsla?(h[unit], s%, l%[, a])` or `hsla?(h[unit] s% l%[ / a])`.
fn parse_hsl(s: &str, spaced: bool) -> Option<Rgba> {
    let mut p = Scan { s, at: 0 };
    if !p.lit("hsl") {
        return None;
    }
    p.lit("a");
    if !p.lit("(") {
        return None;
    }
    p.ws();
    let h = p.num()?;
    // The unit read as typed: only lowercase grad, turn and rad scale.
    let mut scale = 1.0;
    for (unit, by) in [("deg", 1.0), ("rad", 360.0 / (2.0 * std::f64::consts::PI)), ("grad", 0.9), ("turn", 360.0)] {
        let typed = p.rest().get(..unit.len()).unwrap_or("");
        if p.lit(unit) {
            if typed == unit {
                scale = by;
            }
            break;
        }
    }
    let mut parts = [0.0; 2];
    for slot in &mut parts {
        if spaced {
            if p.ws() == 0 {
                return None;
            }
        } else {
            p.ws();
            if !p.lit(",") {
                return None;
            }
            p.ws();
        }
        *slot = p.num()?;
        if !p.lit("%") {
            return None;
        }
    }
    p.ws();
    let mut a = 1.0;
    if p.lit(if spaced { "/" } else { "," }) {
        p.ws();
        let n = p.num()?;
        a = if p.lit("%") { n / 100.0 } else { n };
        p.ws();
    }
    if !p.lit(")") || !p.end() {
        return None;
    }
    Some(from_hsl(h * scale, parts[0], parts[1], a))
}

/// `colord(text)`: the parsers in colord's order, the names plugin's last; None where none reads it.
fn parse_color(text: &str) -> Option<Rgba> {
    let s = trim_space(text);
    parse_hex(s)
        .or_else(|| parse_rgb(s, false))
        .or_else(|| parse_rgb(s, true))
        .or_else(|| parse_hsl(s, false))
        .or_else(|| parse_hsl(s, true))
        .or_else(|| {
            let name = lower_text(s);
            let hex = if name == "transparent" {
                Some("#0000")
            } else {
                CSS_NAMES.iter().find(|(n, _)| *n == name).map(|(_, h)| *h)
            };
            hex.and_then(parse_hex).map(round_rgba)
        })
}

fn hex2(n: f64) -> String {
    format!("{:02x}", cclamp(n, 0.0, 255.0) as u8)
}

fn to_hex(c: Rgba) -> String {
    let c = round_rgba(c);
    let alpha = if c.a < 1.0 { hex2(round_to(255.0 * c.a, 0)) } else { String::new() };
    format!("#{}{}{}{alpha}", hex2(c.r), hex2(c.g), hex2(c.b))
}

fn to_rgb_string(c: Rgba) -> String {
    let c = round_rgba(c);
    let (r, g, b) = (number_to_string(c.r), number_to_string(c.g), number_to_string(c.b));
    if c.a < 1.0 {
        format!("rgba({r}, {g}, {b}, {})", number_to_string(c.a))
    } else {
        format!("rgb({r}, {g}, {b})")
    }
}

/// colord's object parsers' test of a channel: a number, or text that isn't empty.
fn channel(v: &V) -> Option<f64> {
    match v {
        V::Num(n) => Some(*n),
        V::Str(s) if !s.is_empty() => Some(crate::value_kinds::decimal_from_text(s)),
        _ => None,
    }
}

fn color_picker(c: &mut Call) -> Answer {
    let ch = |k: &str| channel(&c.unwired(k));
    let color = match c.field_str("mode", "rgb") {
        "hex" => {
            let typed = match c.unwired("hex") {
                V::Str(s) if !s.is_empty() => s.to_string(),
                _ => "#000000".into(),
            };
            parse_color(&typed).unwrap_or(BLACK)
        }
        "rgb" => match (ch("c0"), ch("c1"), ch("c2")) {
            (Some(r), Some(g), Some(b)) => clamp_rgba(Rgba { r, g, b, a: 1.0 }),
            _ => BLACK,
        },
        _ => match (ch("c0"), ch("c1"), ch("c2")) {
            (Some(h), Some(s), Some(v)) => from_hsv(h, s, v, 1.0),
            _ => BLACK,
        },
    };
    let out = V::str(&if c.field_str("format", "hex") == "hex" { to_hex(color) } else { to_rgb_string(color) });
    c.show("cachedString", out.clone());
    Ok(vec![("color".into(), Cv::from(out))])
}

/// The W3C separable blend of one channel on [0, 1], A the backdrop and B the layer.
fn blend(mode: &str, a: f64, b: f64) -> f64 {
    match mode {
        "mix" => (a + b) / 2.0,
        "multiply" => a * b,
        "screen" => a + b - a * b,
        "overlay" => {
            if a <= 0.5 {
                2.0 * a * b
            } else {
                1.0 - 2.0 * (1.0 - a) * (1.0 - b)
            }
        }
        "soft-light" => {
            let d = if a <= 0.25 { ((16.0 * a - 12.0) * a + 4.0) * a } else { a.sqrt() };
            if b <= 0.5 {
                a - (1.0 - 2.0 * b) * a * (1.0 - a)
            } else {
                a + (2.0 * b - 1.0) * (d - a)
            }
        }
        "hard-light" => {
            if b <= 0.5 {
                2.0 * a * b
            } else {
                1.0 - 2.0 * (1.0 - a) * (1.0 - b)
            }
        }
        "darken" => nan_min(a, b),
        "lighten" => nan_max(a, b),
        "difference" => (a - b).abs(),
        "exclusion" => a + b - 2.0 * a * b,
        "dodge" => {
            if a == 0.0 {
                0.0
            } else if b >= 1.0 {
                1.0
            } else {
                nan_min(1.0, a / (1.0 - b))
            }
        }
        "burn" => {
            if a >= 1.0 {
                1.0
            } else if b <= 0.0 {
                0.0
            } else {
                1.0 - nan_min(1.0, (1.0 - a) / b)
            }
        }
        _ => f64::NAN,
    }
}

fn color_blend(c: &mut Call) -> Answer {
    let parse = |c: &Call, key: &str, label: &str| -> Option<Result<Rgba, V>> {
        let lit = match c.unwired(key) {
            V::Undef | V::Null => V::str(""),
            v => v,
        };
        let raw = c.read_input(key, lit);
        if matches!(raw, V::Null) {
            return None;
        }
        if matches!(raw, V::Err(_)) {
            return Some(Err(raw));
        }
        let text = value_text(&raw);
        let s = trim_space(&text);
        Some(parse_color(s).ok_or_else(|| err(ErrorCode::Value, format!("{label} isn't a color: \"{s}\""))))
    };
    let (a, b) = (parse(c, "a", "Color A"), parse(c, "b", "Color B"));
    let out = match (a, b) {
        (Some(Err(e)), _) | (_, Some(Err(e))) => e,
        (Some(Ok(a)), Some(Ok(b))) => {
            let mode = c.field_str("mode", "mix");
            let (a, b) = (round_rgba(a), round_rgba(b));
            let ch =
                |x: f64, y: f64| round_half_up(nan_min(1.0, nan_max(0.0, blend(mode, x / 255.0, y / 255.0))) * 255.0);
            V::str(&to_hex(clamp_rgba(Rgba { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: 1.0 })))
        }
        _ => V::Null,
    };
    c.show("cachedString", out.clone());
    Ok(vec![("color".into(), Cv::from(out))])
}

// ─── The fixed-output widgets ───────────────────────────────────────────────────

fn xy_pad(c: &mut Call) -> Answer {
    Ok(vec![
        ("x".into(), Cv::from(literal_or(c, "fx", V::Num(0.5)))),
        ("y".into(), Cv::from(literal_or(c, "fy", V::Num(0.5)))),
    ])
}

fn date_range(c: &mut Call) -> Answer {
    // A blank field is no date; any day is one, before 1900 too ([[D119]] datesBefore1900).
    let day = |key: &str| match literal_or(c, key, V::Null) {
        V::Null => None,
        V::Date(n) => Some(n).filter(|n| n.is_finite()),
        v => Some(num_blank_zero(&v)).filter(|n| n.is_finite()),
    };
    let (mut start, mut end) = (day("start"), day("end"));
    if let (Some(s), Some(e)) = (start, end)
        && s > e
    {
        std::mem::swap(&mut start, &mut end);
    }
    let out = |n: Option<f64>| n.map_or(V::Null, V::Num);
    Ok(vec![("start".into(), Cv::from(out(start))), ("end".into(), Cv::from(out(end)))])
}

fn constant(c: &mut Call) -> Answer {
    let pi = std::f64::consts::PI;
    let v = match c.field_str("op", "pi") {
        "pi" => pi,
        "tau" => 2.0 * pi,
        "e" => std::f64::consts::E,
        "phi" => (1.0 + 5f64.sqrt()) / 2.0,
        "inf" => f64::INFINITY,
        "neg-inf" => f64::NEG_INFINITY,
        "zero" | "false" => 0.0,
        "one" | "true" => 1.0,
        "neg-one" => -1.0,
        op => return Ok(vec![("value".into(), Cv::from(err(ErrorCode::Value, format!("Unknown constant \"{op}\""))))]),
    };
    Ok(vec![("value".into(), Cv::from(V::Num(v)))])
}

// ─── The drawn widgets (points, curve, grid) ────────────────────────────────────

/// Each `x, y` line whose two leading parts read as finite numbers.
pub(crate) fn parse_points(text: &str) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 2 {
            continue;
        }
        // Each part reads as typed text does ([[C58]] tableInputRawText): "3abc" is no number.
        let (x, y) = (crate::value_kinds::decimal_from_text(parts[0]), crate::value_kinds::decimal_from_text(parts[1]));
        if x.is_finite() && y.is_finite() {
            out.push((x, y));
        }
    }
    out
}

fn point_plotter(c: &mut Call) -> Answer {
    let pts = parse_points(c.field_str("pointsText", ""));
    let f = frame_of(vec![
        num_column("X", pts.iter().map(|p| V::Num(p.0)).collect()),
        num_column("Y", pts.iter().map(|p| V::Num(p.1)).collect()),
    ]);
    c.show("cachedResult", f.clone());
    Ok(vec![("result".into(), f)])
}

/// Sorted by x, a repeated x keeping its last point.
fn curve_points(text: &str) -> Vec<(f64, f64)> {
    let mut sorted = parse_points(text);
    crate::decision::sort_by_num(&mut sorted, |a, b| a.0 - b.0);
    let mut out: Vec<(f64, f64)> = Vec::new();
    for p in sorted {
        match out.last_mut() {
            Some(last) if last.0 == p.0 => *last = p,
            _ => out.push(p),
        }
    }
    out
}

/// The Fritsch–Carlson interpolant through the points, flat beyond the ends.
fn monotone_cubic(xs: &[f64], ys: &[f64]) -> impl Fn(f64) -> f64 + use<> {
    let n = xs.len();
    let (mut h, mut slope) = (Vec::new(), Vec::new());
    for i in 0..n.saturating_sub(1) {
        h.push(xs[i + 1] - xs[i]);
        slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    }
    let mut m = vec![0.0; n];
    if n > 1 {
        m[0] = slope[0];
        m[n - 1] = slope[n - 2];
        for i in 1..n - 1 {
            m[i] = if slope[i - 1] * slope[i] <= 0.0 { 0.0 } else { (slope[i - 1] + slope[i]) / 2.0 };
        }
        for i in 0..n - 1 {
            if slope[i] == 0.0 {
                m[i] = 0.0;
                m[i + 1] = 0.0;
                continue;
            }
            let (a, b) = (m[i] / slope[i], m[i + 1] / slope[i]);
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                m[i] = t * a * slope[i];
                m[i + 1] = t * b * slope[i];
            }
        }
    }
    let (xs, ys) = (xs.to_vec(), ys.to_vec());
    move |x: f64| {
        if n == 0 {
            return f64::NAN;
        }
        if n == 1 || x <= xs[0] {
            return ys[0];
        }
        if x >= xs[n - 1] {
            return ys[n - 1];
        }
        let (mut lo, mut hi) = (0, n - 1);
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1;
            if xs[mid] <= x {
                lo = mid
            } else {
                hi = mid
            }
        }
        let t = (x - xs[lo]) / h[lo];
        let (t2, t3) = (t * t, t * t * t);
        ys[lo] * (2.0 * t3 - 3.0 * t2 + 1.0)
            + h[lo] * m[lo] * (t3 - 2.0 * t2 + t)
            + ys[lo + 1] * (-2.0 * t3 + 3.0 * t2)
            + h[lo] * m[lo + 1] * (t3 - t2)
    }
}

/// `Number(x.toFixed(6))`.
fn fixed6(x: f64) -> f64 {
    fixed_text(x, 6.0).map_or(f64::NAN, |t| crate::value_kinds::decimal_from_text(&t))
}

fn curve(c: &mut Call) -> Answer {
    let samples = clamp(round_half_up(literal_num(c, "samples", 32.0)), 2.0, 1000.0);
    let (xmin, xmax) = (literal_num(c, "xmin", 0.0), literal_num(c, "xmax", 1.0));
    let pts = curve_points(c.field_str("pointsText", "0, 0\n1, 1"));
    let (mut xs, mut values) = (Vec::new(), Vec::new());
    if !pts.is_empty() {
        let n = clamp(round_half_up(samples), 2.0, 1000.0);
        let f =
            monotone_cubic(&pts.iter().map(|p| p.0).collect::<Vec<_>>(), &pts.iter().map(|p| p.1).collect::<Vec<_>>());
        let mut i = 0.0;
        while i < n {
            let x = xmin + ((xmax - xmin) * i) / (n - 1.0);
            xs.push(V::Num(fixed6(x)));
            let y = f(x);
            values.push(V::Num(if y.is_finite() { fixed6(y) } else { 0.0 }));
            i += 1.0;
        }
    }
    let f = frame_of(vec![num_column("X", xs), num_column("Value", values)]);
    c.show("cachedResult", f.clone());
    Ok(vec![("result".into(), f)])
}

fn grid_painter(c: &mut Call) -> Answer {
    let dim = |v: f64| clamp(round_half_up(v), 1.0, 64.0);
    let (rows, cols) = (dim(literal_num(c, "rows", 6.0)), dim(literal_num(c, "cols", 8.0)));
    let lines: Vec<&str> = c.field_str("tableText", "").split('\n').collect();
    let mut out = Vec::new();
    let mut r = 0.0;
    while r < rows {
        let cells: Vec<&str> = lines.get(r as usize).copied().unwrap_or("").split(',').collect();
        let mut row = Vec::new();
        let mut k = 0.0;
        while k < cols {
            let t = trim_space(cells.get(k as usize).copied().unwrap_or(""));
            let n = crate::value_kinds::decimal_from_text(t);
            row.push(if !t.is_empty() && n.is_finite() { V::Num(n) } else { V::Null });
            k += 1.0;
        }
        out.push(list(row));
        r += 1.0;
    }
    Ok(vec![("result".into(), Cv::from(list(out)))])
}

// ─── Input Switch ───────────────────────────────────────────────────────────────

fn cable_switch(c: &mut Call) -> Answer {
    let keys: Vec<String> = c.sockets.iter().map(|s| s.key.clone()).collect();
    let out = if c.field("multiSelect").and_then(Json::as_bool).unwrap_or(false) {
        let selected: Vec<&str> = c
            .field("selectedKeys")
            .and_then(Json::as_array)
            .map(|a| a.iter().filter_map(Json::as_str).collect())
            .unwrap_or_default();
        let chosen: Vec<(usize, &String)> =
            keys.iter().enumerate().filter(|(_, k)| selected.contains(&k.as_str())).collect();
        if chosen.is_empty() {
            Cv::NULL
        } else {
            let title = |i: usize, k: &str| {
                let t = c.field("_sourceNames").and_then(|t| t.get(k)).and_then(Json::as_str).map_or("", trim_space);
                if t.is_empty() {
                    format!("Input {}", i + 1)
                } else {
                    t.to_string()
                }
            };
            cube_from_columns(vec![
                CubeColumn {
                    name: "name".into(),
                    cells: chosen.iter().map(|(i, k)| Cv::V(V::str(&title(*i, k)))).collect(),
                    ty: None,
                    format: None,
                },
                CubeColumn {
                    name: "value".into(),
                    cells: chosen.iter().map(|(_, k)| c.read_card(k)).collect(),
                    ty: None,
                    format: None,
                },
            ])
        }
    } else {
        let active = init_num(c, "activeIndex", 0.0);
        let idx = if keys.is_empty() { 0.0 } else { clamp(active, 0.0, keys.len() as f64 - 1.0) };
        // `keys[idx]`: a fractional or NaN index names no key.
        let key = (idx.fract() == 0.0 && idx >= 0.0).then(|| keys.get(idx as usize)).flatten();
        key.map_or(Cv::NULL, |k| c.read_card(k))
    };
    c.show("cachedValue", out.clone());
    Ok(vec![("out".into(), out)])
}

// ─── RAND: one roll held until the generation advances, the bounds applied live ─────

fn rand_between(c: &mut Call) -> Answer {
    let roll = c.rolls("rawRoll", 1, false)[0];
    let (b1, b2) = (c.read("bound1"), c.read("bound2"));
    let out = match (&b1, &b2) {
        (V::Null, _) | (_, V::Null) => V::Null,
        (V::Err(_), _) => b1.clone(),
        (_, V::Err(_)) => b2.clone(),
        (V::Num(lo), V::Num(hi)) => V::Num(lo + roll * (hi - lo)),
        _ => err(ErrorCode::Value, "Bound 1 and Bound 2 must be numbers"),
    };
    c.show("cachedResult", out.clone());
    Ok(vec![("result".into(), Cv::from(out))])
}

// ─── SVG Picker ─────────────────────────────────────────────────────────────────

/// Numeric references and the six named ones.
fn decode_entities(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 1..];
        let b = tail.as_bytes();
        let (body_len, decoded) = if b.first() == Some(&b'#') && b.get(1).is_some_and(u8::is_ascii_digit) {
            let n = b[1..].iter().take_while(|c| c.is_ascii_digit()).count();
            (1 + n, Some(crate::value_kinds::decimal_from_text(&tail[1..1 + n])))
        } else if b.first() == Some(&b'#')
            && matches!(b.get(1), Some(b'x' | b'X'))
            && b.get(2).is_some_and(u8::is_ascii_hexdigit)
        {
            let n = b[2..].iter().take_while(|c| c.is_ascii_hexdigit()).count();
            let code = tail[2..2 + n].chars().fold(0.0, |acc, ch| acc * 16.0 + f64::from(ch.to_digit(16).unwrap_or(0)));
            (2 + n, Some(code))
        } else {
            (b.iter().take_while(|c| c.is_ascii_alphabetic()).count(), None)
        };
        if body_len == 0 || b.get(body_len) != Some(&b';') {
            out.push('&');
            rest = tail;
            continue;
        }
        let whole = &rest[at..at + body_len + 2];
        match decoded {
            Some(code) if code <= f64::from(0x10ffff_u32) => {
                out.push(char::from_u32(code as u32).unwrap_or('\u{fffd}'))
            }
            Some(_) => out.push_str(whole),
            None => {
                let named = match tail[..body_len].to_ascii_lowercase().as_str() {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some('\u{a0}'),
                    _ => None,
                };
                match named {
                    Some(ch) => out.push(ch),
                    None => out.push_str(whole),
                }
            }
        }
        rest = &rest[at + body_len + 2..];
    }
    out.push_str(rest);
    out
}

/// Some `inkscape:label`, `data-name`, `aria-label` or `id` attribute names the layer.
fn source_has_layer(source: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let mut i = 0;
    while let Some(ch) = source[i..].chars().next() {
        let next = i + ch.len_utf8();
        if !is_space_char(ch) {
            i = next;
            continue;
        }
        let mut p = Scan { s: source, at: next };
        let attr = ["inkscape:label", "data-name", "aria-label", "id"].iter().any(|a| {
            p.rest().starts_with(a) && {
                p.at += a.len();
                true
            }
        });
        if attr {
            p.ws();
            if p.rest().starts_with('=') {
                p.at += 1;
                p.ws();
                if let Some(q) = p.rest().chars().next().filter(|&q| q == '"' || q == '\'')
                    && let Some(close) = p.rest()[1..].find(q)
                {
                    let value = &p.rest()[1..1 + close];
                    if trim_space(&decode_entities(value)) == name {
                        return true;
                    }
                    i = p.at + close + 2;
                    continue;
                }
            }
        }
        i = next;
    }
    false
}

fn svg_picker(c: &mut Call) -> Answer {
    let source = match c.unwired("source") {
        V::Str(s) => s.to_string(),
        _ => String::new(),
    };
    let picked = c.field_str("selectedLayer", "").to_string();
    let layer = if !picked.is_empty() && source_has_layer(&source, &picked) { V::str(&picked) } else { V::Null };
    let chart = if source.is_empty() {
        Cv::NULL
    } else {
        Cv::Json(Rc::new(json!({
            "__svg": true,
            "source": source,
            "selected": if matches!(layer, V::Null) { Json::Null } else { Json::String(picked.clone()) },
            "hoverColor": c.field_str("hoverColor", ""),
            "height": json_num(init_num(c, "chartHeight", 200.0)),
            "title": c.field_str("label", ""),
        })))
    };
    Ok(vec![("chart".into(), chart), ("layer".into(), Cv::from(layer))])
}

/// The CSS colour names colord's names plugin reads.
const CSS_NAMES: &[(&str, &str)] = &[
    ("white", "#ffffff"),
    ("bisque", "#ffe4c4"),
    ("blue", "#0000ff"),
    ("cadetblue", "#5f9ea0"),
    ("chartreuse", "#7fff00"),
    ("chocolate", "#d2691e"),
    ("coral", "#ff7f50"),
    ("antiquewhite", "#faebd7"),
    ("aqua", "#00ffff"),
    ("azure", "#f0ffff"),
    ("whitesmoke", "#f5f5f5"),
    ("papayawhip", "#ffefd5"),
    ("plum", "#dda0dd"),
    ("blanchedalmond", "#ffebcd"),
    ("black", "#000000"),
    ("gold", "#ffd700"),
    ("goldenrod", "#daa520"),
    ("gainsboro", "#dcdcdc"),
    ("cornsilk", "#fff8dc"),
    ("cornflowerblue", "#6495ed"),
    ("burlywood", "#deb887"),
    ("aquamarine", "#7fffd4"),
    ("beige", "#f5f5dc"),
    ("crimson", "#dc143c"),
    ("cyan", "#00ffff"),
    ("darkblue", "#00008b"),
    ("darkcyan", "#008b8b"),
    ("darkgoldenrod", "#b8860b"),
    ("darkkhaki", "#bdb76b"),
    ("darkgray", "#a9a9a9"),
    ("darkgreen", "#006400"),
    ("darkgrey", "#a9a9a9"),
    ("peachpuff", "#ffdab9"),
    ("darkmagenta", "#8b008b"),
    ("darkred", "#8b0000"),
    ("darkorchid", "#9932cc"),
    ("darkorange", "#ff8c00"),
    ("darkslateblue", "#483d8b"),
    ("gray", "#808080"),
    ("darkslategray", "#2f4f4f"),
    ("darkslategrey", "#2f4f4f"),
    ("deeppink", "#ff1493"),
    ("deepskyblue", "#00bfff"),
    ("wheat", "#f5deb3"),
    ("firebrick", "#b22222"),
    ("floralwhite", "#fffaf0"),
    ("ghostwhite", "#f8f8ff"),
    ("darkviolet", "#9400d3"),
    ("magenta", "#ff00ff"),
    ("green", "#008000"),
    ("dodgerblue", "#1e90ff"),
    ("grey", "#808080"),
    ("honeydew", "#f0fff0"),
    ("hotpink", "#ff69b4"),
    ("blueviolet", "#8a2be2"),
    ("forestgreen", "#228b22"),
    ("lawngreen", "#7cfc00"),
    ("indianred", "#cd5c5c"),
    ("indigo", "#4b0082"),
    ("fuchsia", "#ff00ff"),
    ("brown", "#a52a2a"),
    ("maroon", "#800000"),
    ("mediumblue", "#0000cd"),
    ("lightcoral", "#f08080"),
    ("darkturquoise", "#00ced1"),
    ("lightcyan", "#e0ffff"),
    ("ivory", "#fffff0"),
    ("lightyellow", "#ffffe0"),
    ("lightsalmon", "#ffa07a"),
    ("lightseagreen", "#20b2aa"),
    ("linen", "#faf0e6"),
    ("mediumaquamarine", "#66cdaa"),
    ("lemonchiffon", "#fffacd"),
    ("lime", "#00ff00"),
    ("khaki", "#f0e68c"),
    ("mediumseagreen", "#3cb371"),
    ("limegreen", "#32cd32"),
    ("mediumspringgreen", "#00fa9a"),
    ("lightskyblue", "#87cefa"),
    ("lightblue", "#add8e6"),
    ("midnightblue", "#191970"),
    ("lightpink", "#ffb6c1"),
    ("mistyrose", "#ffe4e1"),
    ("moccasin", "#ffe4b5"),
    ("mintcream", "#f5fffa"),
    ("lightslategray", "#778899"),
    ("lightslategrey", "#778899"),
    ("navajowhite", "#ffdead"),
    ("navy", "#000080"),
    ("mediumvioletred", "#c71585"),
    ("powderblue", "#b0e0e6"),
    ("palegoldenrod", "#eee8aa"),
    ("oldlace", "#fdf5e6"),
    ("paleturquoise", "#afeeee"),
    ("mediumturquoise", "#48d1cc"),
    ("mediumorchid", "#ba55d3"),
    ("rebeccapurple", "#663399"),
    ("lightsteelblue", "#b0c4de"),
    ("mediumslateblue", "#7b68ee"),
    ("thistle", "#d8bfd8"),
    ("tan", "#d2b48c"),
    ("orchid", "#da70d6"),
    ("mediumpurple", "#9370db"),
    ("purple", "#800080"),
    ("pink", "#ffc0cb"),
    ("skyblue", "#87ceeb"),
    ("springgreen", "#00ff7f"),
    ("palegreen", "#98fb98"),
    ("red", "#ff0000"),
    ("yellow", "#ffff00"),
    ("slateblue", "#6a5acd"),
    ("lavenderblush", "#fff0f5"),
    ("peru", "#cd853f"),
    ("palevioletred", "#db7093"),
    ("violet", "#ee82ee"),
    ("teal", "#008080"),
    ("slategray", "#708090"),
    ("slategrey", "#708090"),
    ("aliceblue", "#f0f8ff"),
    ("darkseagreen", "#8fbc8f"),
    ("darkolivegreen", "#556b2f"),
    ("greenyellow", "#adff2f"),
    ("seagreen", "#2e8b57"),
    ("seashell", "#fff5ee"),
    ("tomato", "#ff6347"),
    ("silver", "#c0c0c0"),
    ("sienna", "#a0522d"),
    ("lavender", "#e6e6fa"),
    ("lightgreen", "#90ee90"),
    ("orange", "#ffa500"),
    ("orangered", "#ff4500"),
    ("steelblue", "#4682b4"),
    ("royalblue", "#4169e1"),
    ("turquoise", "#40e0d0"),
    ("yellowgreen", "#9acd32"),
    ("salmon", "#fa8072"),
    ("saddlebrown", "#8b4513"),
    ("sandybrown", "#f4a460"),
    ("rosybrown", "#bc8f8f"),
    ("darksalmon", "#e9967a"),
    ("lightgoldenrodyellow", "#fafad2"),
    ("snow", "#fffafa"),
    ("lightgrey", "#d3d3d3"),
    ("lightgray", "#d3d3d3"),
    ("dimgray", "#696969"),
    ("dimgrey", "#696969"),
    ("olivedrab", "#6b8e23"),
    ("olive", "#808000"),
];
