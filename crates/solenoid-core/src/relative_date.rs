// [[C44]] dateSerials
//! Relative date phrases read by interim (`crates/vendor/interim`) at an instant, as the calendar day the phrase lands
//! on in the host's zone (`tree/specs/computation/formula-language.md` § Date kernels, `parseDate`).

use interim::{parse_date_string, Dialect};
use jiff::{tz::TimeZone, Timestamp};

const DAY_MS: f64 = 86_400_000.0;

/// The words that make typed date text a relative phrase, beside "from now" and "in" before a count.
const WORDS: &[&str] = &[
    "today",
    "tonight",
    "tomorrow",
    "yesterday",
    "now",
    "next",
    "last",
    "this",
    "coming",
    "upcoming",
    "ago",
    "later",
    "hence",
    "weekend",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "mon",
    "tue",
    "tues",
    "wed",
    "thu",
    "thur",
    "thurs",
    "fri",
    "sat",
    "sun",
];

/// Whether typed date text is a relative phrase: no four-digit run, and a relative word.
pub fn is_relative(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    let mut run = 0;
    for c in lower.chars() {
        run = if c.is_ascii_digit() { run + 1 } else { 0 };
        if run == 4 {
            return false;
        }
    }
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    words.iter().enumerate().any(|(i, w)| {
        let next = words.get(i + 1).copied().unwrap_or("");
        WORDS.contains(w)
            || (*w == "from" && next == "now")
            || (*w == "in" && (next.starts_with(|c: char| c.is_ascii_digit()) || matches!(next, "a" | "an")))
    })
}

/// A relative phrase's day as a serial at `now` (an instant, milliseconds since 1970 UTC), the local day in the host's
/// zone; `None` where it reads as no date. Trailing dots and commas are dropped.
pub fn relative_date(text: &str, now: f64) -> Option<f64> {
    // The host's wall clock, given to interim as UTC, so its day arithmetic runs on the local calendar.
    let local = crate::zone::local_time(now);
    let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
    let text = text.trim().trim_end_matches(|c: char| c == '.' || c == ',' || c.is_whitespace());
    let day = parse_date_string(text, base, Dialect::Uk).ok()?.date();
    let days = day.to_zoned(TimeZone::UTC).ok()?.timestamp().as_millisecond() as f64 / DAY_MS;
    Some(days.floor() + 25569.0)
}
