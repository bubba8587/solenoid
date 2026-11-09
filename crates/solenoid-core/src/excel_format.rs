// [[B27]] computeAnswersToExcel, [[C44]] dateSerials
//! Excel's number format codes, as TEXT and Cast to Text read them (US English): sections, digit placeholders,
//! grouping and scaling commas, percent, scientific, fractions, dates and times, elapsed time and literals.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::date_serial::civil_from_days;

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Lit(String),
    /// `0`, `#` or `?`.
    Digit(u8),
    Point,
    Comma,
    Percent,
    /// `E+`/`E-`, whether a plus sign shows.
    Exp(bool),
    Slash,
    At,
    General,
    /// A date or time code: its letter (lowercase) and how many.
    Date(u8, usize, String),
    /// `AM/PM` (with its case) or `A/P`.
    AmPm(String, String),
    /// `[h]`, `[m]` or `[s]`, with its width.
    Elapsed(u8, usize),
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Cmp {
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
}

#[derive(Clone, Debug, Default)]
struct Section {
    toks: Vec<Tok>,
    cond: Option<(Cmp, f64)>,
}

impl Section {
    /// A date code has date or time tokens and no digit placeholders but its fractional seconds (`ss.00`); a number
    /// code with unquoted date letters (`0 days`) is refused.
    fn is_date(&self) -> bool {
        let t = &self.toks;
        if !t.iter().any(|x| matches!(x, Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..))) {
            return false;
        }
        t.iter().enumerate().all(|(i, x)| {
            !matches!(x, Tok::Digit(_))
                || (*x == Tok::Digit(b'0')
                    && t[..i].iter().rev().find(|p| **p != Tok::Digit(b'0')) == Some(&Tok::Point)
                    && t[..i].iter().any(|p| matches!(p, Tok::Date(b's', _, _) | Tok::Elapsed(b's', _))))
        })
    }

    fn has_at(&self) -> bool {
        self.toks.contains(&Tok::At)
    }
}

/// Why a code can't be read: TEXT answers #VALUE!.
pub type FormatError = &'static str;

type Parsed = Result<Rc<Vec<Section>>, FormatError>;

thread_local! {
    static PARSED: RefCell<HashMap<String, Parsed>> = RefCell::new(HashMap::new());
}

/// A code's sections, read once per code: TEXT over a column reads the same code on every row ([[C120]] linearWork).
fn sections_of(code: &str) -> Parsed {
    PARSED.with(|m| {
        if let Some(p) = m.borrow().get(code) {
            return p.clone();
        }
        let p = split_sections(code).map(Rc::new);
        let mut m = m.borrow_mut();
        if m.len() > 256 {
            m.clear();
        }
        m.insert(code.to_string(), p.clone());
        p
    })
}

fn split_sections(code: &str) -> Result<Vec<Section>, FormatError> {
    let mut sections = vec![Section::default()];
    let cs: Vec<char> = code.chars().collect();
    let mut i = 0;
    let lit = |s: &mut Section, c: &str| match s.toks.last_mut() {
        Some(Tok::Lit(l)) => l.push_str(c),
        _ => s.toks.push(Tok::Lit(c.to_string())),
    };
    while i < cs.len() {
        let c = cs[i];
        let s = sections.last_mut().unwrap();
        let ahead = |word: &str| {
            word.len() <= cs.len() - i && word.chars().zip(&cs[i..]).all(|(w, c)| c.to_ascii_lowercase() == w)
        };
        match c {
            ';' => {
                sections.push(Section::default());
                i += 1;
            }
            '"' => {
                let end = cs[i + 1..].iter().position(|&q| q == '"').ok_or("A quote in the format is never closed")?;
                let text: String = cs[i + 1..i + 1 + end].iter().collect();
                lit(s, &text);
                i += end + 2;
            }
            '\\' => {
                if let Some(&n) = cs.get(i + 1) {
                    lit(s, &n.to_string());
                }
                i += 2;
            }
            '_' => {
                lit(s, " ");
                i += 2;
            }
            '*' => i += 2,
            '[' => {
                let end =
                    cs[i + 1..].iter().position(|&q| q == ']').ok_or("A bracket in the format is never closed")?;
                let inner: String = cs[i + 1..i + 1 + end].iter().collect();
                bracket(s, &inner)?;
                i += end + 2;
            }
            '0' | '#' | '?' => {
                s.toks.push(Tok::Digit(c as u8));
                i += 1;
            }
            '.' => {
                s.toks.push(Tok::Point);
                i += 1;
            }
            ',' => {
                s.toks.push(Tok::Comma);
                i += 1;
            }
            '%' => {
                s.toks.push(Tok::Percent);
                i += 1;
            }
            '/' => {
                s.toks.push(Tok::Slash);
                i += 1;
            }
            '@' => {
                s.toks.push(Tok::At);
                i += 1;
            }
            'E' | 'e' if matches!(cs.get(i + 1), Some('+' | '-')) => {
                s.toks.push(Tok::Exp(cs[i + 1] == '+'));
                i += 2;
            }
            _ if ahead("general") => {
                s.toks.push(Tok::General);
                i += 7;
            }
            _ if ahead("am/pm") => {
                // AM/PM shows in capitals whatever its case in the code; A/P keeps its own.
                s.toks.push(Tok::AmPm("AM".into(), "PM".into()));
                i += 5;
            }
            _ if ahead("a/p") => {
                s.toks.push(Tok::AmPm(cs[i].to_string(), cs[i + 2].to_string()));
                i += 3;
            }
            'y' | 'Y' | 'm' | 'M' | 'd' | 'D' | 'h' | 'H' | 's' | 'S' | 'e' => {
                let l = c.to_ascii_lowercase();
                let n = cs[i..].iter().take_while(|x| x.to_ascii_lowercase() == l).count();
                let raw: String = cs[i..i + n].iter().collect();
                s.toks.push(Tok::Date(if l == 'e' { b'y' } else { l as u8 }, if l == 'e' { 4 } else { n }, raw));
                i += n;
            }
            _ => {
                lit(s, &c.to_string());
                i += 1;
            }
        }
    }
    if sections.len() > 4 {
        return Err("A format has at most four sections");
    }
    Ok(sections)
}

/// `[h]`, `[mm]`, `[ss]`, a condition `[>=100]`, a currency `[$€-409]`; a color is dropped.
fn bracket(s: &mut Section, inner: &str) -> Result<(), FormatError> {
    let lower = inner.to_ascii_lowercase();
    if !lower.is_empty()
        && lower.bytes().all(|b| b == lower.as_bytes()[0])
        && matches!(lower.as_bytes()[0], b'h' | b'm' | b's')
    {
        s.toks.push(Tok::Elapsed(lower.as_bytes()[0], lower.len()));
        return Ok(());
    }
    if let Some(cur) = inner.strip_prefix('$') {
        let sym = cur.split('-').next().unwrap_or("");
        s.toks.push(Tok::Lit(sym.to_string()));
        return Ok(());
    }
    let ops = [("<=", Cmp::Le), (">=", Cmp::Ge), ("<>", Cmp::Ne), ("<", Cmp::Lt), (">", Cmp::Gt), ("=", Cmp::Eq)];
    if let Some((op, cmp)) = ops.iter().find(|(o, _)| inner.starts_with(o)) {
        let n: f64 = inner[op.len()..].trim().parse().map_err(|_| "A format's condition needs a number")?;
        s.cond = Some((*cmp, n));
    }
    Ok(())
}

fn holds(cond: (Cmp, f64), x: f64) -> bool {
    let (c, n) = cond;
    match c {
        Cmp::Lt => x < n,
        Cmp::Le => x <= n,
        Cmp::Gt => x > n,
        Cmp::Ge => x >= n,
        Cmp::Eq => x == n,
        Cmp::Ne => x != n,
    }
}

/// A number formatted by an Excel format code.
pub fn format_number(x: f64, code: &str) -> Result<String, FormatError> {
    if !x.is_finite() {
        return Err("The number is not finite");
    }
    if code.is_empty() {
        return Ok(String::new());
    }
    let sections = sections_of(code)?;
    // Text-only sections don't take a number; the fourth section is text's.
    let numeric: Vec<&Section> = sections.iter().take(3).collect();
    let (section, signed) = pick(&numeric, x);
    let Some(section) = section else { return Err("No section of the format takes this number") };
    if section.toks.is_empty() {
        return Ok(String::new());
    }
    // A calendar day is the value's own, whichever section shows it: a day before 1900 is a date ([[D119]]
    // datesBefore1900), not a number to show unsigned.
    let calendar = section.toks.iter().any(|t| matches!(t, Tok::Date(b'y' | b'd', ..)));
    let v = if signed || (calendar && section.is_date()) { x } else { x.abs() };
    if section.is_date() {
        return format_date(v, section);
    }
    if section.toks.iter().any(|t| matches!(t, Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..))) {
        return Err("A format can't mix digit placeholders with date codes");
    }
    format_plain(v, section)
}

/// The section a number takes, and whether it keeps its own minus sign; none when no condition holds, which TEXT
/// answers #VALUE! (`TEXT(5, "[>10]0;[<0]0")`). A conditional section drops a
/// negative number's sign as a second section does (`TEXT(-5, "[>10]0;[<0]-0")` is -5).
fn pick<'a>(sections: &[&'a Section], x: f64) -> (Option<&'a Section>, bool) {
    let conditional = sections.iter().any(|s| s.cond.is_some());
    if conditional {
        for s in sections {
            match s.cond {
                Some(c) if holds(c, x) => return (Some(s), x >= 0.0 || !negative_section(sections)),
                None => return (Some(s), true),
                _ => {}
            }
        }
        return (None, true);
    }
    match sections.len() {
        1 => (Some(sections[0]), true),
        2 => (Some(if x < 0.0 { sections[1] } else { sections[0] }), x >= 0.0),
        _ => {
            if x > 0.0 {
                (Some(sections[0]), true)
            } else if x < 0.0 {
                (Some(sections[1]), false)
            } else {
                (Some(sections[2]), true)
            }
        }
    }
}

fn negative_section(sections: &[&Section]) -> bool {
    sections.len() > 1
}

/// Text formatted by an Excel format code: the fourth section, or a lone section with `@`; otherwise the text as is.
pub fn format_text(t: &str, code: &str) -> Result<String, FormatError> {
    let sections = sections_of(code)?;
    let section = match sections.len() {
        4 => &sections[3],
        1 if sections[0].has_at() => &sections[0],
        _ => return Ok(t.to_string()),
    };
    let mut out = String::new();
    for tok in &section.toks {
        match tok {
            Tok::At => out.push_str(t),
            Tok::Lit(l) => out.push_str(l),
            _ => {}
        }
    }
    Ok(out)
}

// ─── Numbers ────────────────────────────────────────────────────────────────────

/// A non-negative number as Excel holds it, 15 significant digits: the digits and how many stand before the point.
fn digits15(x: f64) -> (Vec<u8>, i64) {
    if x == 0.0 {
        return (vec![0], 1);
    }
    let s = format!("{x:.14e}");
    let (m, e) = s.split_once('e').unwrap_or((&s, "0"));
    let ds: Vec<u8> = m.bytes().filter(u8::is_ascii_digit).map(|b| b - b'0').collect();
    (ds, e.parse::<i64>().unwrap_or(0) + 1)
}

/// The digits rounded half up to `places` after the point: the integer digits (no leading zeros, empty for 0)
/// and exactly `places` fraction digits.
fn rounded(ds: &[u8], point: i64, places: usize) -> (Vec<u8>, Vec<u8>) {
    let mut d: Vec<u8> = ds.to_vec();
    let mut point = point;
    if point < 0 {
        let mut z = vec![0; (-point) as usize];
        z.extend(d);
        d = z;
        point = 0;
    }
    let point = point as usize;
    let keep = point + places;
    if d.len() < keep {
        d.resize(keep, 0);
    }
    let up = d.get(keep).is_some_and(|&x| x >= 5);
    d.truncate(keep);
    let mut point = point;
    if up {
        let mut i = keep;
        loop {
            if i == 0 {
                d.insert(0, 1);
                point += 1;
                break;
            }
            i -= 1;
            if d[i] == 9 {
                d[i] = 0;
            } else {
                d[i] += 1;
                break;
            }
        }
    }
    let int: Vec<u8> = d[..point].iter().copied().skip_while(|&x| x == 0).collect();
    (int, d[point..].to_vec())
}

fn digit_char(d: u8) -> char {
    char::from(b'0' + d)
}

/// The integer placeholders filled right to left, extra digits ahead of the first; commas every three digits when
/// `group`. Literals between placeholders stay where they stand.
fn fill_int(toks: &[Tok], digits: &[u8], group: bool, out: &mut String) {
    let slots = toks.iter().filter(|t| matches!(t, Tok::Digit(_))).count();
    let extra = digits.len().saturating_sub(slots);
    let total = slots.max(digits.len());
    let mut seen = 0;
    // Digits shown so far, to tell a grouping comma from a leading blank.
    let mut shown = false;
    let mut emit = |out: &mut String, ch: Option<char>, pos_from_right: usize| {
        if let Some(c) = ch {
            out.push(c);
            if c != ' ' {
                shown = true;
            }
            if group && shown && c.is_ascii_digit() && pos_from_right > 0 && pos_from_right.is_multiple_of(3) {
                out.push(',');
            }
        }
    };
    for t in toks {
        match t {
            Tok::Digit(kind) => {
                if seen == 0 {
                    for (k, &d) in digits[..extra].iter().enumerate() {
                        emit(out, Some(digit_char(d)), total - 1 - k);
                    }
                }
                let pos_from_right = slots - 1 - seen;
                let ch = if pos_from_right < digits.len() {
                    Some(digit_char(digits[digits.len() - 1 - pos_from_right]))
                } else {
                    match kind {
                        b'0' => Some('0'),
                        b'?' => Some(' '),
                        _ => None,
                    }
                };
                emit(out, ch, pos_from_right);
                seen += 1;
            }
            Tok::Lit(l) => out.push_str(l),
            Tok::Percent => out.push('%'),
            Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..) => out.push_str(&letters(t)),
            _ => {}
        }
    }
    if slots == 0 {
        for (k, &d) in digits.iter().enumerate() {
            emit(out, Some(digit_char(d)), digits.len() - 1 - k);
        }
    }
}

/// The fraction placeholders filled left to right; trailing zeros under `#` vanish and under `?` become spaces.
fn fill_frac(toks: &[Tok], digits: &[u8], out: &mut String) {
    let kinds: Vec<u8> = toks.iter().filter_map(|t| if let Tok::Digit(k) = t { Some(*k) } else { None }).collect();
    // How many digits are shown: through the last nonzero digit or the last `0` placeholder.
    let mut show = kinds.len();
    while show > 0 && digits[show - 1] == 0 && kinds[show - 1] != b'0' {
        show -= 1;
    }
    let mut k = 0;
    for t in toks {
        match t {
            Tok::Digit(kind) => {
                if k < show {
                    out.push(digit_char(digits[k]));
                } else if *kind == b'?' {
                    out.push(' ');
                }
                k += 1;
            }
            Tok::Lit(l) => out.push_str(l),
            Tok::Percent => out.push('%'),
            Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..) => out.push_str(&letters(t)),
            _ => {}
        }
    }
}

fn format_plain(x: f64, s: &Section) -> Result<String, FormatError> {
    let toks = &s.toks;
    if toks.contains(&Tok::Slash) && toks.iter().any(|t| matches!(t, Tok::Digit(_))) {
        return format_fraction(x, toks);
    }
    let digit_at = |t: &Tok| matches!(t, Tok::Digit(_));
    let first_digit = toks.iter().position(digit_at);
    let has_general = toks.contains(&Tok::General);
    let Some(first) = first_digit else {
        // No placeholder: General, or literals around nothing.
        let mut out = String::new();
        let neg = x < 0.0;
        if neg && !has_general && !toks.contains(&Tok::At) {
            out.push('-');
        }
        for t in toks {
            match t {
                Tok::General | Tok::At => out.push_str(&crate::excel_functions::number_to_text(x)),
                Tok::Lit(l) => out.push_str(l),
                Tok::Percent => out.push('%'),
                Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..) => out.push_str(&letters(t)),
                _ => {}
            }
        }
        return Ok(out);
    };
    let exp_at = toks.iter().position(|t| matches!(t, Tok::Exp(_)));
    let num_end = exp_at.unwrap_or(toks.len());
    let point_at = toks[..num_end].iter().position(|t| *t == Tok::Point);
    let int_end = point_at.unwrap_or(num_end);
    // A code whose first placeholder follows the point (`.00`) has no integer placeholders.
    let first = first.min(int_end);
    let last_digit = toks[..num_end].iter().rposition(digit_at).unwrap_or(first);

    // Commas: one between integer placeholders groups; each right after the last placeholder of the number scales.
    let int_digits_last = toks[..int_end].iter().rposition(digit_at);
    let group = toks[first..int_end]
        .iter()
        .enumerate()
        .any(|(k, t)| *t == Tok::Comma && int_digits_last.is_some_and(|l| first + k < l));
    let scale_from = int_digits_last.map_or(int_end, |l| l + 1);
    let scale_commas = toks[scale_from..int_end].iter().take_while(|t| **t == Tok::Comma).count()
        + if point_at.is_some() {
            toks[last_digit + 1..num_end].iter().take_while(|t| **t == Tok::Comma).count()
        } else {
            0
        };
    let percents = toks.iter().filter(|t| **t == Tok::Percent).count();
    let mut v = x.abs();
    for _ in 0..percents {
        v *= 100.0;
    }
    for _ in 0..scale_commas {
        v /= 1000.0;
    }
    let neg = x < 0.0;

    let int_toks: Vec<Tok> = toks[first..int_end].iter().filter(|t| **t != Tok::Comma).cloned().collect();
    let frac_toks: Vec<Tok> = match point_at {
        Some(p) => toks[p + 1..num_end].iter().filter(|t| **t != Tok::Comma).cloned().collect(),
        None => Vec::new(),
    };
    let int_slots = int_toks.iter().filter(|t| digit_at(t)).count();
    let frac_slots = frac_toks.iter().filter(|t| digit_at(t)).count();

    let mut body = String::new();
    let mut exp_text = String::new();
    let (ds, point) = digits15(v);
    if let Some(e_at) = exp_at {
        let Tok::Exp(plus) = toks[e_at] else { unreachable!() };
        let exp_slots = toks[e_at + 1..].iter().take_while(|t| matches!(t, Tok::Digit(_))).count();
        let width = int_slots.max(1) as i64;
        let engineering = int_slots > 1 && matches!(int_toks.iter().find(|t| digit_at(t)), Some(Tok::Digit(b'#')));
        let mut e = if v == 0.0 {
            0
        } else if engineering {
            (point - 1).div_euclid(width) * width
        } else {
            point - width
        };
        let (mut int, mut frac) = rounded(&ds, point - e, frac_slots);
        if v != 0.0 && int.len() as i64 > width {
            e += if engineering { width } else { 1 };
            (int, frac) = rounded(&ds, point - e, frac_slots);
        }
        fill_int(&int_toks, &int, false, &mut body);
        if point_at.is_some() {
            body.push('.');
            fill_frac(&frac_toks, &frac, &mut body);
        }
        let mag = e.unsigned_abs().to_string();
        exp_text.push('E');
        if e < 0 {
            exp_text.push('-');
        } else if plus {
            exp_text.push('+');
        }
        exp_text.push_str(&"0".repeat(exp_slots.saturating_sub(mag.len())));
        exp_text.push_str(&mag);
    } else {
        let (int, frac) = rounded(&ds, point, frac_slots);
        fill_int(&int_toks, &int, group, &mut body);
        if point_at.is_some() {
            body.push('.');
            fill_frac(&frac_toks, &frac, &mut body);
        }
        // A value that rounds to zero shows no minus sign.
        if int.is_empty() && frac.iter().all(|&d| d == 0) {
            return Ok(assemble(toks, first, num_end, &body, "", false));
        }
    }
    Ok(assemble(toks, first, num_end, &body, &exp_text, neg))
}

/// The literals and percent signs around the number, the number in place of its placeholders.
fn assemble(toks: &[Tok], first: usize, num_end: usize, body: &str, exp_text: &str, neg: bool) -> String {
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    for t in &toks[..first] {
        push_outside(t, &mut out);
    }
    out.push_str(body);
    out.push_str(exp_text);
    let after = if exp_text.is_empty() {
        num_end
    } else {
        // The exponent's own digit placeholders are spent.
        num_end + 1 + toks[num_end + 1..].iter().take_while(|t| matches!(t, Tok::Digit(_))).count()
    };
    for t in &toks[after.min(toks.len())..] {
        push_outside(t, &mut out);
    }
    out
}

fn push_outside(t: &Tok, out: &mut String) {
    match t {
        Tok::Lit(l) => out.push_str(l),
        Tok::Percent => out.push('%'),
        Tok::Date(..) | Tok::AmPm(..) | Tok::Elapsed(..) => out.push_str(&letters(t)),
        _ => {}
    }
}

/// A date token written back as the letters it was read from, for a number code that holds them as literals.
fn letters(t: &Tok) -> String {
    match t {
        Tok::Date(_, _, raw) => raw.clone(),
        Tok::AmPm(am, pm) => format!("{am}/{pm}"),
        Tok::Elapsed(c, n) => format!("[{}]", char::from(*c).to_string().repeat(*n)),
        _ => String::new(),
    }
}

/// `# ?/?`, `?/8`, `# ??/100`: a whole part when the code has one, then the closest fraction its denominator allows.
fn format_fraction(x: f64, toks: &[Tok]) -> Result<String, FormatError> {
    let slash = toks.iter().position(|t| *t == Tok::Slash).unwrap();
    let num_start = toks[..slash].iter().rposition(|t| !matches!(t, Tok::Digit(_))).map_or(0, |p| p + 1);
    let num_toks = &toks[num_start..slash];
    let whole_toks: Vec<Tok> = toks[..num_start].to_vec();
    let has_whole = whole_toks.iter().any(|t| matches!(t, Tok::Digit(_)));
    // The denominator: placeholders, or a fixed number written in literal digits.
    let mut den_end = slash + 1;
    let mut fixed = String::new();
    let mut den_slots = Vec::new();
    while let Some(t) = toks.get(den_end) {
        match t {
            Tok::Digit(k) => {
                fixed.push(char::from(*k));
                den_slots.push(*k);
            }
            Tok::Lit(l) if l.chars().all(|c| c.is_ascii_digit()) => fixed.push_str(l),
            Tok::Lit(l) => {
                let lead: String = l.chars().take_while(char::is_ascii_digit).collect();
                if lead.is_empty() {
                    break;
                }
                fixed.push_str(&lead);
                break;
            }
            _ => break,
        }
        den_end += 1;
    }
    let fixed_den: Option<u64> = (fixed.chars().any(|c| ('1'..='9').contains(&c))
        && fixed.chars().all(|c| c.is_ascii_digit()))
    .then(|| fixed.parse().ok())
    .flatten();
    let neg = x < 0.0;
    let v = x.abs();
    let (mut whole, f) = if has_whole { (v.trunc(), v - v.trunc()) } else { (0.0, v) };
    let (mut n, d) = match fixed_den {
        Some(d) => ((f * d as f64).round() as u64, d),
        None => {
            let max = 10u64.pow(den_slots.len().clamp(1, 5) as u32) - 1;
            best_fraction(f, max)
        }
    };
    if has_whole && n == d {
        whole += 1.0;
        n = 0;
    }
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    if has_whole {
        // A zero whole part under `#` shows nothing and the fraction stands alone, unless there is no fraction
        // either: zero itself shows as 0.
        let digits: Vec<u8> =
            if whole == 0.0 && n != 0 { Vec::new() } else { format!("{whole:.0}").bytes().map(|b| b - b'0').collect() };
        let mut w = String::new();
        fill_int(&whole_toks, &digits, false, &mut w);
        out.push_str(&w);
    }
    if n == 0 && has_whole {
        // A whole number: the fraction's room stays blank.
        out.push_str(&" ".repeat(num_toks.len() + 1 + den_end - slash - 1));
        out.push_str(&tail_literals(&toks[den_end..]));
        return Ok(out);
    }
    let ns: Vec<u8> = n.to_string().bytes().map(|b| b - b'0').collect();
    let mut num_text = String::new();
    fill_int(num_toks, &ns, false, &mut num_text);
    if n == 0 && num_text.trim().is_empty() {
        num_text = "0".to_string();
    }
    out.push_str(&num_text);
    out.push('/');
    let ds = d.to_string();
    out.push_str(&ds);
    if fixed_den.is_none() {
        out.push_str(&" ".repeat(den_slots.iter().filter(|&&k| k == b'?').count().saturating_sub(ds.len())));
    }
    out.push_str(&tail_literals(&toks[den_end..]));
    Ok(out)
}

fn tail_literals(toks: &[Tok]) -> String {
    let mut out = String::new();
    for t in toks {
        push_outside(t, &mut out);
    }
    out
}

/// The fraction nearest `f` whose denominator is at most `max`, the smaller denominator on a tie.
fn best_fraction(f: f64, max: u64) -> (u64, u64) {
    let mut best = ((f).round() as u64, 1u64);
    let mut err = (f - best.0 as f64).abs();
    for d in 2..=max {
        let n = (f * d as f64).round();
        let e = (f - n / d as f64).abs();
        if e < err - 1e-12 {
            best = (n as u64, d);
            err = e;
        }
    }
    best
}

// ─── Dates and times ────────────────────────────────────────────────────────────

fn format_date(x: f64, s: &Section) -> Result<String, FormatError> {
    let toks = &s.toks;
    // Fractional seconds: `0`s after a point that follows seconds.
    let mut frac_digits = 0usize;
    for (i, t) in toks.iter().enumerate() {
        if *t == Tok::Point && toks[..i].iter().any(|p| matches!(p, Tok::Date(b's', _, _) | Tok::Elapsed(b's', _))) {
            frac_digits = frac_digits.max(toks[i + 1..].iter().take_while(|t| **t == Tok::Digit(b'0')).count());
        }
    }
    let unit = 10u64.pow(frac_digits.min(15) as u32) as f64;
    let total = (x * 86_400.0 * unit).round();
    let whole_secs = (total / unit).floor();
    let sub = (total - whole_secs * unit) as u64;
    let days = (whole_secs / 86_400.0).floor();
    let in_day = (whole_secs - days * 86_400.0) as i64;
    let (y, mo, d) = civil_from_days(days as i64 - 25_569);
    if !(1..=9999).contains(&y) {
        return Err("The date is outside the calendar's range");
    }
    let weekday = (days as i64 - 25_569 + 4).rem_euclid(7) as usize;
    let (h, mi, se) = (in_day / 3600, in_day / 60 % 60, in_day % 60);
    let twelve = toks.iter().any(|t| matches!(t, Tok::AmPm(..)));

    // `m` is minutes right after an hour or right before seconds.
    let is_minute = |i: usize| {
        let prev = toks[..i].iter().rev().find(|t| !matches!(t, Tok::Lit(_)));
        let next = toks[i + 1..].iter().find(|t| !matches!(t, Tok::Lit(_)));
        matches!(prev, Some(Tok::Date(b'h', _, _) | Tok::Elapsed(b'h', _)))
            || matches!(next, Some(Tok::Date(b's', _, _) | Tok::Elapsed(b's', _)))
    };
    let mut out = String::new();
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        match t {
            Tok::Date(c, n, _) => {
                let n = *n;
                match c {
                    b'y' => {
                        if n <= 2 {
                            out.push_str(&format!("{:02}", y % 100));
                        } else {
                            out.push_str(&format!("{y:04}"));
                        }
                    }
                    b'm' if n <= 2 && is_minute(i) => out.push_str(&pad(mi, n)),
                    b'm' => match n {
                        1 | 2 => out.push_str(&pad(i64::from(mo), n)),
                        3 => out.push_str(&MONTHS[mo as usize - 1][..3]),
                        5 => out.push_str(&MONTHS[mo as usize - 1][..1]),
                        _ => out.push_str(MONTHS[mo as usize - 1]),
                    },
                    b'd' => match n {
                        1 | 2 => out.push_str(&pad(i64::from(d), n)),
                        3 => out.push_str(&DAYS[weekday][..3]),
                        _ => out.push_str(DAYS[weekday]),
                    },
                    b'h' => {
                        let hh = if twelve {
                            match h % 12 {
                                0 => 12,
                                v => v,
                            }
                        } else {
                            h
                        };
                        out.push_str(&pad(hh, n.min(2)));
                    }
                    _ => out.push_str(&pad(se, n.min(2))),
                }
            }
            Tok::Elapsed(c, n) => {
                let v = match c {
                    b'h' => whole_secs as i64 / 3600,
                    b'm' => whole_secs as i64 / 60,
                    _ => whole_secs as i64,
                };
                out.push_str(&pad(v, *n));
            }
            Tok::AmPm(am, pm) => out.push_str(if h < 12 { am } else { pm }),
            Tok::Point if frac_digits > 0 && matches!(toks.get(i + 1), Some(Tok::Digit(b'0'))) => {
                let n = toks[i + 1..].iter().take_while(|t| **t == Tok::Digit(b'0')).count();
                let text = format!("{sub:0w$}", w = frac_digits);
                out.push('.');
                out.push_str(&text[..n]);
                i += n;
            }
            Tok::Lit(l) => out.push_str(l),
            Tok::Point => out.push('.'),
            Tok::Comma => out.push(','),
            Tok::Slash => out.push('/'),
            Tok::Percent => out.push('%'),
            Tok::Digit(k) => out.push(char::from(*k)),
            Tok::General => out.push_str(&crate::excel_functions::number_to_text(x)),
            Tok::At | Tok::Exp(_) => {}
        }
        i += 1;
    }
    Ok(out)
}

fn pad(v: i64, width: usize) -> String {
    format!("{v:0width$}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(x: f64, code: &str) -> String {
        format_number(x, code).unwrap()
    }

    #[test]
    fn microsoft_examples() {
        // https://support.microsoft.com/office/text-function-20d5ac4d-7b94-49fd-bb38-93d29371225c and the number
        // format codes page.
        assert_eq!(f(1234.567, "$#,##0.00"), "$1,234.57");
        assert_eq!(f(0.285, "0.0%"), "28.5%");
        assert_eq!(f(1234.567, "0.00E+00"), "1.23E+03");
        assert_eq!(f(4.34, "# ?/?"), "4 1/3");
        assert_eq!(f(0.285, "# ?/?"), " 2/7");
        assert_eq!(f(12200000.0, "0.00E+00"), "1.22E+07");
        assert_eq!(f(1234.59, "####.#"), "1234.6");
        assert_eq!(f(8.9, "#.000"), "8.900");
        assert_eq!(f(0.631, "0.#"), "0.6");
        assert_eq!(f(12.0, "#.0#"), "12.0");
        assert_eq!(f(1234.568, "#.0#"), "1234.57");
        assert_eq!(f(12000.0, "#,###"), "12,000");
        assert_eq!(f(12000.0, "#,"), "12");
        assert_eq!(f(12200000.0, "0.0,,"), "12.2");
        assert_eq!(f(5.25, "# ???/???"), "5   1/4  ");
        assert_eq!(f(44.398, "???.???"), " 44.398");
        assert_eq!(f(0.75, "# ?/4"), " 3/4");
        assert_eq!(f(-1234.5, "#,##0.00;(#,##0.00)"), "(1,234.50)");
        assert_eq!(f(0.0, "0;-0;\"zero\""), "zero");
        assert_eq!(f(1234.0, "0000000"), "0001234");
        assert_eq!(f(123456789.0, "##0.0E+0"), "123.5E+6");
        assert_eq!(f(0.5, "#.00"), ".50");
    }

    #[test]
    fn dates_and_times() {
        // 2012-03-14 13:30:55
        let t = 40982.0 + (13.0 * 3600.0 + 30.0 * 60.0 + 55.0) / 86400.0;
        assert_eq!(f(t, "MM/DD/YY"), "03/14/12");
        assert_eq!(f(t, "dddd"), "Wednesday");
        assert_eq!(f(t, "H:MM AM/PM"), "1:30 PM");
        assert_eq!(f(t, "h:mm:ss"), "13:30:55");
        assert_eq!(f(t, "mmmm d, yyyy"), "March 14, 2012");
        assert_eq!(f(t, "mmm"), "Mar");
        assert_eq!(f(t, "mmmmm"), "M");
        assert_eq!(f(t, "yyyy-mm-dd hh:mm"), "2012-03-14 13:30");
        assert_eq!(f(1.5, "[h]:mm"), "36:00");
        assert_eq!(f(0.5 / 86400.0 + 1.0 / 86400.0, "ss.0"), "01.5");
        assert_eq!(f(45000.0, "DD-MMM-YYYY"), "15-Mar-2023");
    }

    #[test]
    fn text_and_sections() {
        assert_eq!(format_text("abc", "0;0;0;\"[\"@\"]\"").unwrap(), "[abc]");
        assert_eq!(format_text("abc", "0.00").unwrap(), "abc");
        assert_eq!(f(-5.0, "0"), "-5");
        assert_eq!(f(-5.0, "0;0"), "5");
        assert_eq!(f(-0.001, "0.00"), "0.00");
        assert_eq!(f(150.0, "[>100]\"big\";\"small\""), "big");
        assert_eq!(f(1234.5, "General"), "1234.5");
    }

    /// The author's Excel, 2026-11-01.
    #[test]
    fn excel_answers() {
        assert_eq!(f(0.0, "# ?/?"), "0    ");
        assert_eq!(f(2.0, "# ?/?"), "2    ");
        assert_eq!(f(0.285, "?/?"), "2/7");
        assert_eq!(f(1.5, "?/?"), "3/2");
        assert_eq!(f(0.3, "# ?/10"), " 3/10");
        assert_eq!(f(12.0, "#."), "12.");
        assert_eq!(f(0.0, "#"), "");
        assert_eq!(f(0.0, "0;-0;"), "");
        assert_eq!(f(-150.0, "[>100]\"big\";0"), "-150");
        assert_eq!(f(5.0, "x0"), "x5");
        assert!(format_number(5.0, "0 days").is_err());
        // The author's Excel, 2026-11-01.
        assert_eq!(f(-5.0, "[>10]0;[<0]-0"), "-5");
        assert!(format_number(5.0, "[>10]0;[<0]0").is_err());
        assert!(format_number(45000.0, "0.00 yyyy").is_err());
        // Excel refuses a day before 1900; Solenoid shows it ([[D119]] datesBefore1900).
        assert_eq!(f(-1.0, "dd-mmm-yyyy"), "29-Dec-1899");
        assert_eq!(f(-1.0, "yyyy;yyyy"), "1899");
        assert_eq!(f(-0.001, "0"), "0");
        // Excel answered ...345000: it cuts a typed number to 15 digits as it is entered; the formatter rounds.
        assert_eq!(f(123456789012345678.0, "0"), "123456789012346000");
        assert_eq!(f(1e21, "0"), "1000000000000000000000");
        assert_eq!(f(12.0, "00.00E+00"), "12.00E+00");
        assert_eq!(f(1234.5, "[$€-x-euro] #,##0.00"), "€ 1,234.50");
        assert_eq!(f(1234.5, "#,##0.00_)"), "1,234.50 ");
        assert_eq!(f(1234.5, "*-0"), "1235");
        let t = 40982.5643;
        assert_eq!(f(t, "h:mm am/pm"), "1:32 PM");
        assert_eq!(f(t, "h:mm A/P"), "1:32 P");
        assert_eq!(f(0.99999999, "hh:mm:ss"), "00:00:00");
        assert_eq!(f(0.0000174, "ss.00"), "01.50");
    }
}
