//! The phrases Solenoid's patches add (PATCHES.md), each read on Wednesday 2026-11-04 at 10:30.

#[cfg(feature = "jiff_0_2")]
mod jiff {
    use interim::{parse_date_string, Dialect};
    use jiff_0_2::{civil::date, tz::TimeZone, Zoned};

    fn base() -> Zoned {
        date(2026, 11, 4)
            .at(10, 30, 0, 0)
            .to_zoned(TimeZone::UTC)
            .unwrap()
    }

    fn day(text: &str) -> String {
        match parse_date_string(text, base(), Dialect::Us) {
            Ok(z) => z.date().to_string(),
            Err(e) => format!("error: {e}"),
        }
    }

    #[test]
    fn uppercase_meridiem_reads() {
        assert_eq!(day("tomorrow 9 PM"), "2026-11-05");
        assert_eq!(day("friday 11 PM"), "2026-11-06");
    }

    #[test]
    fn in_a_count() {
        assert_eq!(day("in 3 days"), "2026-11-07");
        assert_eq!(day("in 2 weeks"), "2026-11-18");
        assert_eq!(day("in a month"), "2026-12-04");
        assert_eq!(day("in 1 year"), "2027-11-04");
    }

    #[test]
    fn from_now_later_hence() {
        assert_eq!(day("3 days from now"), "2026-11-07");
        assert_eq!(day("2 weeks later"), "2026-11-18");
        assert_eq!(day("a year hence"), "2027-11-04");
        assert!(day("3 days from tomorrow").starts_with("error"));
    }

    #[test]
    fn a_or_an_is_one() {
        assert_eq!(day("a month ago"), "2026-10-04");
        assert_eq!(day("a week from now"), "2026-11-11");
        assert_eq!(day("an hour ago"), "2026-11-04");
    }

    #[test]
    fn tonight_and_last_night() {
        assert_eq!(day("tonight"), "2026-11-04");
        assert_eq!(day("last night"), "2026-11-03");
    }

    #[test]
    fn day_after_and_before() {
        assert_eq!(day("the day after tomorrow"), "2026-11-06");
        assert_eq!(day("day before yesterday"), "2026-11-02");
        assert!(day("the day after yesterday").starts_with("error"));
    }

    #[test]
    fn plus_counts_forward() {
        assert_eq!(day("+3 days"), "2026-11-07");
        assert_eq!(day("-3 days"), "2026-11-01");
        assert!(day("+june").starts_with("error"));
    }

    #[test]
    fn weekend_is_its_saturday() {
        assert_eq!(day("this weekend"), "2026-11-07");
        assert_eq!(day("next weekend"), "2026-11-07");
        assert_eq!(day("last weekend"), "2026-10-31");
        assert_eq!(day("next week"), "2026-11-11");
    }

    #[test]
    fn coming_is_next() {
        assert_eq!(day("upcoming friday"), "2026-11-06");
        assert_eq!(day("this coming monday"), "2026-11-09");
        let uk = |t: &str| {
            parse_date_string(t, base(), Dialect::Uk)
                .unwrap()
                .date()
                .to_string()
        };
        assert_eq!(uk("this coming friday"), "2026-11-06");
        assert_eq!(uk("next friday"), "2026-11-13");
    }

    #[test]
    fn last_todays_weekday_is_a_week_ago() {
        assert_eq!(day("last wednesday"), "2026-10-28");
        assert_eq!(day("last wednesday 9am"), "2026-11-04");
        assert_eq!(day("last tuesday"), "2026-11-03");
    }

    #[test]
    fn at_before_the_time() {
        assert_eq!(day("tomorrow at 5pm"), "2026-11-05");
        assert_eq!(day("friday at 17:30"), "2026-11-06");
        assert!(day("tomorrow at").starts_with("error"));
    }
}
