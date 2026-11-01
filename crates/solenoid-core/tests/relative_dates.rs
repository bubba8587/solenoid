//! [[C44]] dateSerials: relative date phrases as a date Value Input reads them (`relative_date.rs`, on the patched
//! interim). Natively the host's zone is UTC; the reference is Wednesday 2026-11-04 at 15:00.

use solenoid_core::relative_date::{is_relative, relative_date};

const NOW: f64 = 1_793_804_400_000.0;

fn day(text: &str) -> Option<String> {
    relative_date(text, NOW).map(|s| solenoid_core::date_serial::format_date_serial(s, "YYYY-MM-DD"))
}

#[test]
fn reads_the_phrases_people_type() {
    for (text, want) in [
        ("today", "2026-11-04"),
        ("tonight", "2026-11-04"),
        ("Tomorrow", "2026-11-05"),
        ("yesterday", "2026-11-03"),
        ("last night", "2026-11-03"),
        ("the day after tomorrow", "2026-11-06"),
        ("day before yesterday", "2026-11-02"),
        ("friday", "2026-11-06"),
        ("this friday", "2026-11-06"),
        ("next friday", "2026-11-13"),
        ("this coming friday", "2026-11-06"),
        ("last friday", "2026-10-30"),
        ("last wednesday", "2026-10-28"),
        ("mon", "2026-11-09"),
        ("next week", "2026-11-11"),
        ("last week", "2026-10-28"),
        ("next month", "2026-12-04"),
        ("last month", "2026-10-04"),
        ("next year", "2027-11-04"),
        ("this weekend", "2026-11-07"),
        ("next weekend", "2026-11-14"),
        ("in 3 days", "2026-11-07"),
        ("in a week", "2026-11-11"),
        ("3 days from now", "2026-11-07"),
        ("2 weeks later", "2026-11-18"),
        ("3 days ago", "2026-11-01"),
        ("a month ago", "2026-10-04"),
        ("tomorrow at 5pm", "2026-11-05"),
        ("next friday.", "2026-11-13"),
    ] {
        assert!(is_relative(text), "{text} is relative");
        assert_eq!(day(text).as_deref(), Some(want), "{text}");
    }
}

#[test]
fn reads_no_date_from_noise() {
    for text in ["nonsense today foo", "today foo", "next blue", "in three days"] {
        assert_eq!(day(text), None, "{text}");
    }
}

#[test]
fn the_gate() {
    for text in ["15 March 1996", "Monday, 16 March 2026", "2026-11-04", "3/5", "", "  "] {
        assert!(!is_relative(text), "{text} is not relative");
    }
    for text in ["in 2 weeks", "an hour from now", "upcoming monday", "a year hence"] {
        assert!(is_relative(text), "{text} is relative");
    }
}
