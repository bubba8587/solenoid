// [[C16]] polarsEngine, [[C44]] dateSerials
//! Port of `src/graph/nodes/dateSerial.ts` `formatDateSerial`: a serial day, read as UTC.

const FORMAT_MONTHS: [&str; 12] =
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FORMAT_DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
pub const DEFAULT_DATE_FORMAT: &str = "DD-MMM-YYYY";

const TOKENS: [&str; 17] = ["MMMM", "MMM", "MM", "M", "DDDD", "DDD", "DD", "D", "YYYY", "YY", "HH", "hh", "h", "mm", "ss", "A", "a"];

/// Howard Hinnant's `civil_from_days`.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ─── A JS `Date` read as UTC: time values in ms, None for an Invalid Date ───────

pub const MS_PER_DAY: f64 = 86_400_000.0;

/// `serialToJsDate(serial).getTime()`.
pub fn serial_to_ms(serial: f64) -> Option<f64> {
    time_clip(crate::jsnum::math_round((serial - 25569.0) * MS_PER_DAY))
}

/// ECMAScript TimeClip.
pub fn time_clip(ms: f64) -> Option<f64> {
    (ms.is_finite() && ms.abs() <= 8.64e15).then(|| ms.trunc() + 0.0)
}

/// `Date.UTC(y, m, d)`: month and day carry, as MakeDay has it.
pub fn date_utc(y: f64, m: f64, d: f64) -> Option<f64> {
    if !(y.is_finite() && m.is_finite() && d.is_finite()) {
        return None;
    }
    let (y, m, d) = (y.trunc(), m.trunc(), d.trunc());
    let ym = y + (m / 12.0).floor();
    let mn = m.rem_euclid(12.0);
    if ym.abs() > 400_000.0 || d.abs() > 1e9 {
        return None;
    }
    let day = days_from_civil(ym as i64, mn as u32 + 1, 1) as f64 + d - 1.0;
    time_clip(day * MS_PER_DAY)
}

pub fn parts_of_ms(ms: f64) -> UtcParts {
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    UtcParts {
        year,
        month,
        day,
        hours: in_day / 3_600_000,
        minutes: in_day / 60_000 % 60,
        seconds: in_day / 1000 % 60,
        weekday: (days + 4).rem_euclid(7) as usize,
    }
}

/// Howard Hinnant's `days_from_civil`: days since 1970-01-01.
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn pad(n: i64, width: usize) -> String {
    if n < 0 { format!("-{:0>width$}", -n, width = width) } else { format!("{n:0>width$}") }
}

/// `serialToJsDate`'s UTC fields: `new Date(Math.round((serial - 25569) * 86400000))`, `None` for an Invalid Date.
pub struct UtcParts {
    pub year: i64,
    pub month: u32,
    pub day: u32,
    pub hours: i64,
    pub minutes: i64,
    pub seconds: i64,
    pub weekday: usize,
}

pub fn serial_to_utc_parts(serial: f64) -> Option<UtcParts> {
    let ms = crate::jsnum::math_round((serial - 25569.0) * 86_400_000.0);
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    Some(UtcParts {
        year,
        month,
        day,
        hours: in_day / 3_600_000,
        minutes: in_day / 60_000 % 60,
        seconds: in_day / 1000 % 60,
        weekday: (days + 4).rem_euclid(7) as usize,
    })
}

pub fn format_date_serial(serial: f64, pattern: &str) -> String {
    if !serial.is_finite() {
        return crate::jsnum::number_to_string(serial);
    }
    let Some(UtcParts { year, month, day, hours, minutes, seconds, weekday }) = serial_to_utc_parts(serial) else {
        return "Invalid Date".to_string();
    };
    let yyyy = pad(year, 4);
    let h12 = if hours % 12 == 0 { 12 } else { hours % 12 };
    let mut out = String::with_capacity(pattern.len() + 8);
    let mut rest = pattern;
    while !rest.is_empty() {
        if let Some(tok) = TOKENS.iter().find(|t| rest.starts_with(**t)) {
            out.push_str(&match *tok {
                "MMMM" => FORMAT_MONTHS[month as usize - 1].to_string(),
                "MMM" => FORMAT_MONTHS[month as usize - 1][..3].to_string(),
                "MM" => pad(i64::from(month), 2),
                "M" => month.to_string(),
                "DDDD" => FORMAT_DAYS[weekday].to_string(),
                "DDD" => FORMAT_DAYS[weekday][..3].to_string(),
                "DD" => pad(i64::from(day), 2),
                "D" => day.to_string(),
                "YYYY" => yyyy.clone(),
                "YY" => yyyy[yyyy.len() - 2..].to_string(),
                "HH" => pad(hours, 2),
                "hh" => pad(h12, 2),
                "h" => h12.to_string(),
                "mm" => pad(minutes, 2),
                "ss" => pad(seconds, 2),
                "A" => (if hours < 12 { "AM" } else { "PM" }).to_string(),
                _ => (if hours < 12 { "am" } else { "pm" }).to_string(),
            });
            rest = &rest[tok.len()..];
        } else {
            let c = rest.chars().next().unwrap();
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        assert_eq!(format_date_serial(45000.0, DEFAULT_DATE_FORMAT), "15-Mar-2023");
        assert_eq!(format_date_serial(25569.5, "YYYY-MM-DD HH:mm A DDDD"), "1970-01-01 12:00 PM Thursday");
        assert_eq!(format_date_serial(1.0, "D/M/YY"), "31/12/99");
    }
}
