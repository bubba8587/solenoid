// [[C44]] dateSerials
//! Day serials: serial 25569 is 1970-01-01, so serial 1 is 1900-01-01 on Excel's epoch.

const UNIX_EPOCH: f64 = 25569.0;
const MS_PER_DAY: f64 = 86_400_000.0;

/// Days from 1970-01-01 to the proleptic Gregorian `y-m-d`.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// The serial of `y-m-d`. A month past 12 or a day past the month's end rolls forward, as `Date.UTC` does.
pub fn serial(y: i64, m: u32, d: u32) -> f64 {
    let months = y * 12 + i64::from(m) - 1;
    (days_from_civil(months.div_euclid(12), months.rem_euclid(12) as u32 + 1, 1) + i64::from(d) - 1) as f64 + UNIX_EPOCH
}

/// A serial's date and clock, to the minute, rounded to the millisecond first; `None` past the representable range.
pub fn parts(serial: f64) -> Option<(i64, u32, u32, u32, u32)> {
    let ms = crate::num::math_round((serial - UNIX_EPOCH) * MS_PER_DAY);
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let days = (ms / MS_PER_DAY).floor();
    let minute = ((ms - days * MS_PER_DAY) / 60_000.0).floor() as u32;
    let (y, m, d) = civil_from_days(days as i64);
    Some((y, m, d, minute / 60, minute % 60))
}

fn year4(y: i64) -> String {
    if y < 0 {
        format!("-{:0>4}", -y)
    } else {
        format!("{y:0>4}")
    }
}

/// `YYYY-MM-DD`.
pub fn iso(serial: f64) -> String {
    match parts(serial) {
        Some((y, m, d, _, _)) => format!("{}-{m:02}-{d:02}", year4(y)),
        None => "Invalid Date".to_string(),
    }
}

/// `YYYY-MM-DDTHH:MM:00`.
pub fn iso_minute(serial: f64) -> String {
    match parts(serial) {
        Some((y, m, d, h, min)) => format!("{}-{m:02}-{d:02}T{h:02}:{min:02}:00", year4(y)),
        None => "Invalid Date".to_string(),
    }
}
