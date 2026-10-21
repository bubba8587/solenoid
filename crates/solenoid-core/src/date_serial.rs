// [[C16]] polarsEngine, [[C44]] dateSerials
//! Port of `src/graph/nodes/dateSerial.ts` `formatDateSerial`: a serial day, read as UTC.

const FORMAT_MONTHS: [&str; 12] =
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FORMAT_DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
pub const DEFAULT_DATE_FORMAT: &str = "DD-MMM-YYYY";

const TOKENS: [&str; 17] = ["MMMM", "MMM", "MM", "M", "DDDD", "DDD", "DD", "D", "YYYY", "YY", "HH", "hh", "h", "mm", "ss", "A", "a"];

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
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

fn pad(n: i64, width: usize) -> String {
    if n < 0 { format!("-{:0>width$}", -n, width = width) } else { format!("{n:0>width$}") }
}

pub fn format_date_serial(serial: f64, pattern: &str) -> String {
    if !serial.is_finite() {
        return crate::jsnum::number_to_string(serial);
    }
    let ms = ((serial - 25569.0) * 86_400_000.0).round();
    if ms.abs() > 8.64e15 {
        return "Invalid Date".to_string();
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let (hours, minutes, seconds) = (in_day / 3_600_000, in_day / 60_000 % 60, in_day / 1000 % 60);
    let weekday = (days + 4).rem_euclid(7) as usize;
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
