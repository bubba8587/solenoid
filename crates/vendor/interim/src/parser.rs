use logos::{Lexer, Logos};

use crate::{
    types::{
        month_name, time_unit, week_day, AbsDate, ByName, DateSpec, DateTimeSpec, Direction,
        Lowercase, TimeSpec,
    },
    DateError, DateResult, Dialect, Interval,
};

// when we parse dates, there's often a bit of time parsed..
#[derive(Clone, Copy, Debug)]
enum TimeKind {
    Formal,
    Informal,
    Am,
    Pm,
    Unknown,
}

pub struct DateParser<'a> {
    s: Lexer<'a, Tokens>,
    maybe_time: Option<(u32, TimeKind)>,
}

#[derive(logos::Logos, Debug, PartialEq, Eq, Clone, Copy)]
#[logos(skip r"[ \t\n\f]+")]
enum Tokens {
    #[regex("[0-9]{1,4}", |lex| lex.slice().parse().map_err(|_| ()))]
    Number(u32),

    #[regex("[a-zA-Z]+")]
    Ident,

    // punctuation
    #[token("-")]
    Dash,
    #[token("/")]
    Slash,
    #[token(":")]
    Colon,
    #[token(".")]
    Dot,
    #[token(",")]
    Comma,
    #[token("+")]
    Plus,
}

const NOW: Lowercase = Lowercase::literal("now");
const TODAY: Lowercase = Lowercase::literal("today");
const YESTERDAY: Lowercase = Lowercase::literal("yesterday");
const TOMORROW: Lowercase = Lowercase::literal("tomorrow");
const NEXT: Lowercase = Lowercase::literal("next");
const LAST: Lowercase = Lowercase::literal("last");
const THIS: Lowercase = Lowercase::literal("this");
const AM: Lowercase = Lowercase::literal("am");
const PM: Lowercase = Lowercase::literal("pm");
const Z: Lowercase = Lowercase::literal("z");
const AGO: Lowercase = Lowercase::literal("ago");
const AT: Lowercase = Lowercase::literal("at");
const TONIGHT: Lowercase = Lowercase::literal("tonight");
const NIGHT: Lowercase = Lowercase::literal("night");
const IN: Lowercase = Lowercase::literal("in");
const A: Lowercase = Lowercase::literal("a");
const AN: Lowercase = Lowercase::literal("an");
const FROM: Lowercase = Lowercase::literal("from");
const LATER: Lowercase = Lowercase::literal("later");
const HENCE: Lowercase = Lowercase::literal("hence");
const THE: Lowercase = Lowercase::literal("the");
const DAY: Lowercase = Lowercase::literal("day");
const AFTER: Lowercase = Lowercase::literal("after");
const BEFORE: Lowercase = Lowercase::literal("before");
const COMING: Lowercase = Lowercase::literal("coming");
const UPCOMING: Lowercase = Lowercase::literal("upcoming");
const WEEKEND: Lowercase = Lowercase::literal("weekend");

impl<'a> DateParser<'a> {
    pub fn new(text: &'a str) -> DateParser<'a> {
        DateParser {
            s: Tokens::lexer(text),
            maybe_time: None,
        }
    }

    fn next_num(&mut self, expected: &'static str) -> DateResult<u32> {
        match self.s.next() {
            Some(Ok(Tokens::Number(n))) => Ok(n),
            Some(_) => Err(DateError::ExpectedToken(expected, self.s.span())),
            None => Err(DateError::EndOfText(expected)),
        }
    }

    fn iso_date(&mut self, year: i32) -> DateResult<DateSpec> {
        let month = self.next_num("a month number after '-'")?;

        match self.s.next() {
            Some(Ok(Tokens::Dash)) => {}
            Some(_) => return Err(DateError::ExpectedToken("'-'", self.s.span())),
            None => return Err(DateError::EndOfText("'-'")),
        }

        let day = self.next_num("a day number after '-'")?;
        Ok(DateSpec::Absolute(AbsDate { year, month, day }))
    }

    // We have already parsed maybe the next/last/...
    // and the first set of numbers followed by the slash
    //
    // US:
    // mm/dd/yy
    // mm/dd/yyyy
    // next mm/dd
    //
    // UK:
    // dd/mm/yy
    // dd/mm/yyyy
    // next dd/mm
    fn informal_date(
        &mut self,
        day_or_month: u32,
        dialect: Dialect,
        direct: Direction,
    ) -> DateResult<DateSpec> {
        let month_or_day = self.next_num(if dialect == Dialect::Us {
            "a day number after '/'"
        } else {
            "a month number after '/'"
        })?;
        let (day, month) = if dialect == Dialect::Us {
            (month_or_day, day_or_month)
        } else {
            (day_or_month, month_or_day)
        };
        let s = self.s.clone();
        if self.s.next() != Some(Ok(Tokens::Slash)) {
            // backtrack
            self.s = s;
            Ok(DateSpec::FromName(ByName::DayMonth { day, month }, direct))
        } else {
            // pivot (1940, 2040)
            let year = match self.next_num("a year after '/'")? as i32 {
                y @ 0..=40 => 2000 + y,
                y @ 41..=99 => 1900 + y,
                y => y,
            };
            Ok(DateSpec::Absolute(AbsDate { year, month, day }))
        }
    }

    // PATCH(3): the time unit after a count, then what follows it: 'ago' counts back; 'from now', 'later' and
    // 'hence' count forward, as does nothing at all ('3 days'); an hour number starts the time.
    fn unit_tail(&mut self, u: Interval, n: i32) -> DateResult<Option<DateSpec>> {
        match self.s.next() {
            Some(Ok(Tokens::Ident)) => match Lowercase::from(self.s.slice()) {
                AGO => Ok(Some(DateSpec::Relative(u * -n))),
                LATER | HENCE => Ok(Some(DateSpec::Relative(u * n))),
                FROM => match self.s.next() {
                    Some(Ok(Tokens::Ident)) if Lowercase::from(self.s.slice()) == NOW => {
                        Ok(Some(DateSpec::Relative(u * n)))
                    }
                    Some(_) => Err(DateError::ExpectedToken(
                        "'now' after 'from'",
                        self.s.span(),
                    )),
                    None => Err(DateError::EndOfText("'now' after 'from'")),
                },
                _ => Err(DateError::ExpectedToken(
                    "'ago', 'from now' or 'later'",
                    self.s.span(),
                )),
            },
            Some(Ok(Tokens::Number(h))) => {
                self.maybe_time = Some((h, TimeKind::Unknown));
                Ok(Some(DateSpec::Relative(u * n)))
            }
            _ => Ok(Some(DateSpec::Relative(u * n))),
        }
    }

    // PATCH(4): 'a' or 'an' counts one: 'a month ago', 'an hour from now'.
    fn counted_unit(&mut self, n: i32) -> DateResult<Option<DateSpec>> {
        match self.s.next() {
            Some(Ok(Tokens::Ident)) => match time_unit(Lowercase::from(self.s.slice())) {
                Some(u) => self.unit_tail(u, n),
                None => Err(DateError::ExpectedToken("a time unit", self.s.span())),
            },
            Some(_) => Err(DateError::ExpectedToken("a time unit", self.s.span())),
            None => Err(DateError::EndOfText("a time unit")),
        }
    }

    // PATCH(2): 'in 3 days', 'in a week': a count forward.
    fn in_interval(&mut self) -> DateResult<Option<DateSpec>> {
        let n = match self.s.next() {
            Some(Ok(Tokens::Number(n))) => n as i32,
            Some(Ok(Tokens::Ident)) if matches!(Lowercase::from(self.s.slice()), A | AN) => 1,
            Some(_) => {
                return Err(DateError::ExpectedToken(
                    "a number after 'in'",
                    self.s.span(),
                ))
            }
            None => return Err(DateError::EndOfText("a number after 'in'")),
        };
        match self.s.next() {
            Some(Ok(Tokens::Ident)) => match time_unit(Lowercase::from(self.s.slice())) {
                Some(u) => Ok(Some(DateSpec::Relative(u * n))),
                None => Err(DateError::ExpectedToken(
                    "a time unit after the number",
                    self.s.span(),
                )),
            },
            Some(_) => Err(DateError::ExpectedToken(
                "a time unit after the number",
                self.s.span(),
            )),
            None => Err(DateError::EndOfText("a time unit after the number")),
        }
    }

    // PATCH(6): '[the] day after tomorrow' is two days on, '[the] day before yesterday' two days back.
    fn day_after_before(&mut self, saw_the: bool) -> DateResult<Option<DateSpec>> {
        let word = |p: &mut Self, expected: &'static str| match p.s.next() {
            Some(Ok(Tokens::Ident)) => Ok(Lowercase::from(p.s.slice())),
            Some(_) => Err(DateError::ExpectedToken(expected, p.s.span())),
            None => Err(DateError::EndOfText(expected)),
        };
        if saw_the && word(self, "'day' after 'the'")? != DAY {
            return Err(DateError::ExpectedToken("'day' after 'the'", self.s.span()));
        }
        let after = match word(self, "'after' or 'before'")? {
            AFTER => true,
            BEFORE => false,
            _ => {
                return Err(DateError::ExpectedToken(
                    "'after' or 'before'",
                    self.s.span(),
                ))
            }
        };
        match word(self, "'tomorrow' or 'yesterday'")? {
            TOMORROW if after => Ok(Some(DateSpec::Relative(Interval::Days(2)))),
            YESTERDAY if !after => Ok(Some(DateSpec::Relative(Interval::Days(-2)))),
            _ => Err(DateError::ExpectedToken(
                "'tomorrow' or 'yesterday'",
                self.s.span(),
            )),
        }
    }

    fn parse_date(&mut self, dialect: Dialect) -> DateResult<Option<DateSpec>> {
        let (sign, mut direct);
        // PATCH(7): '+3 days' counts forward, as '-3 days' counts back.
        let mut plus = false;
        let token = match self.s.next() {
            Some(Ok(Tokens::Dash)) => {
                sign = true;
                direct = None;
                self.s.next()
            }
            Some(Ok(Tokens::Plus)) => {
                sign = false;
                plus = true;
                direct = None;
                self.s.next()
            }
            Some(Ok(Tokens::Ident)) => {
                sign = false;
                direct = match Lowercase::from(self.s.slice()) {
                    // PATCH(5): tonight is today.
                    NOW | TODAY | TONIGHT => {
                        return Ok(Some(DateSpec::Relative(Interval::Days(0))))
                    }
                    YESTERDAY => return Ok(Some(DateSpec::Relative(Interval::Days(-1)))),
                    TOMORROW => return Ok(Some(DateSpec::Relative(Interval::Days(1)))),
                    IN => return self.in_interval(),
                    A | AN => return self.counted_unit(1),
                    THE => return self.day_after_before(true),
                    DAY => return self.day_after_before(false),
                    NEXT => Some(Direction::Next),
                    LAST => Some(Direction::Last),
                    // PATCH(9): 'upcoming friday' is the coming one, as a bare 'friday' is, in either dialect.
                    THIS | COMING | UPCOMING => Some(Direction::Here),
                    _ => None,
                };
                if direct.is_some() {
                    // consume
                    let t = self.s.next();
                    // PATCH(9): 'this coming friday' is the coming one too.
                    if t == Some(Ok(Tokens::Ident))
                        && matches!(Lowercase::from(self.s.slice()), COMING | UPCOMING)
                    {
                        direct = Some(Direction::Here);
                        self.s.next()
                    } else {
                        t
                    }
                } else {
                    Some(Ok(Tokens::Ident))
                }
            }
            t => {
                sign = false;
                direct = None;
                t
            }
        };

        match token {
            // date needs some token
            None => Err(DateError::EndOfText(if sign {
                "a number after '-'"
            } else if direct.is_some() {
                "a weekday, month name, or relative time unit"
            } else {
                "a date or duration"
            })),
            // none of these characters begin a date or duration
            Some(
                Ok(
                    Tokens::Colon
                    | Tokens::Comma
                    | Tokens::Dash
                    | Tokens::Dot
                    | Tokens::Slash
                    | Tokens::Plus,
                )
                | Err(()),
            ) => Err(DateError::MissingDate),
            // '-June' doesn't make sense
            Some(Ok(Tokens::Ident)) if sign => Err(DateError::ExpectedToken(
                "a number after '-'",
                self.s.span(),
            )),
            Some(Ok(Tokens::Ident)) if plus => Err(DateError::ExpectedToken(
                "a number after '+'",
                self.s.span(),
            )),
            // {weekday} [{time}]
            // {month} [{day}, {year}] [{time}]
            // {month} [{day}] [{time}]
            Some(Ok(Tokens::Ident)) => {
                let direct = direct.unwrap_or(Direction::Here);
                let name = Lowercase::from(self.s.slice());
                if direct == Direction::Last && name == NIGHT {
                    // PATCH(5): last night is yesterday.
                    return Ok(Some(DateSpec::Relative(Interval::Days(-1))));
                }
                if name == WEEKEND {
                    // PATCH(8): a weekend is named by its Saturday, as a weekday is: 'this weekend' is the
                    // coming one. Before this, 'weekend' read as the unit 'week'.
                    return Ok(Some(DateSpec::FromName(ByName::WeekDay(5), direct)));
                }
                if let Some(month) = month_name(Lowercase::from(self.s.slice())) {
                    // {month} [{day}, {year}]
                    // {month} [{day}] [{time}]
                    if let Some(Ok(Tokens::Number(day))) = self.s.next() {
                        let s = self.s.clone();
                        if self.s.next() == Some(Ok(Tokens::Comma)) {
                            // comma found, expect year
                            let year = self.next_num("a year after ','")? as i32;
                            Ok(Some(DateSpec::Absolute(AbsDate { year, month, day })))
                        } else {
                            // no comma found, we might expect a time component (if any)
                            // backtrack, we'll try parse the time component later
                            self.s = s;
                            Ok(Some(DateSpec::FromName(
                                ByName::DayMonth { day, month },
                                direct,
                            )))
                        }
                    } else {
                        // We only have a month name to work with
                        Ok(Some(DateSpec::FromName(ByName::MonthName(month), direct)))
                    }
                } else if let Some(weekday) = week_day(Lowercase::from(self.s.slice())) {
                    // {weekday} [{time}]
                    // we'll try parse the time component later
                    Ok(Some(DateSpec::FromName(ByName::WeekDay(weekday), direct)))
                } else if let Some(interval) = time_unit(Lowercase::from(self.s.slice())) {
                    let interval = match direct {
                        Direction::Last => interval * -1,
                        #[allow(clippy::erasing_op)]
                        Direction::Here => interval * 0,
                        Direction::Next => interval,
                    };
                    Ok(Some(DateSpec::Relative(interval)))
                } else {
                    Err(DateError::ExpectedToken(
                        "a weekday, month name, or relative time unit",
                        self.s.span(),
                    ))
                }
            }
            // {day}/{month}
            // {month}/{day}
            // {day} {month}
            // {n} {interval}
            // {year}-{month}-{day}
            Some(Ok(Tokens::Number(n))) => {
                match self.s.next() {
                    // if sign is set, we should expect something like '- 5 minutes'
                    None if sign || plus => Err(DateError::EndOfText("duration")),
                    // we want a full date
                    Some(Ok(Tokens::Comma | Tokens::Plus | Tokens::Number(_)) | Err(())) => {
                        Err(DateError::ExpectedToken("date", self.s.span()))
                    }
                    // if direct is set, we should expect a day or month to direct against
                    None | Some(Ok(Tokens::Colon | Tokens::Dot | Tokens::Dash))
                        if direct.is_some() =>
                    {
                        Err(DateError::EndOfText("day or month name"))
                    }
                    // if no extra tokens, this is probably just a year
                    None => Ok(Some(DateSpec::Absolute(AbsDate {
                        year: n as i32,
                        month: 1,
                        day: 1,
                    }))),
                    Some(Ok(Tokens::Ident)) => {
                        let direct = direct.unwrap_or(Direction::Here);
                        let name = Lowercase::from(self.s.slice());
                        if let Some(month) = month_name(name) {
                            let day = n;
                            if let Some(Ok(Tokens::Number(year))) = self.s.next() {
                                // 4 July 2017
                                let year = year as i32;
                                Ok(Some(DateSpec::Absolute(AbsDate { year, month, day })))
                            } else {
                                // 4 July
                                Ok(Some(DateSpec::FromName(
                                    ByName::DayMonth { day, month },
                                    direct,
                                )))
                            }
                        } else if let Some(u) = time_unit(name) {
                            let n = n as i32;
                            // '2 days'
                            if sign {
                                Ok(Some(DateSpec::Relative(u * -n)))
                            } else {
                                self.unit_tail(u, n)
                            }
                        } else if name == AM {
                            self.maybe_time = Some((n, TimeKind::Am));
                            Ok(None)
                        } else if name == PM {
                            self.maybe_time = Some((n, TimeKind::Pm));
                            Ok(None)
                        } else {
                            Err(DateError::ExpectedToken(
                                "a month name or time unit after the number",
                                self.s.span(),
                            ))
                        }
                    }
                    Some(Ok(Tokens::Colon)) => {
                        self.maybe_time = Some((n, TimeKind::Formal));
                        Ok(None)
                    }
                    Some(Ok(Tokens::Dot)) => {
                        self.maybe_time = Some((n, TimeKind::Informal));
                        Ok(None)
                    }
                    Some(Ok(Tokens::Dash)) => Ok(Some(self.iso_date(n as i32)?)),
                    Some(Ok(Tokens::Slash)) => Ok(Some(self.informal_date(
                        n,
                        dialect,
                        direct.unwrap_or(Direction::Here),
                    )?)),
                }
            }
        }
    }

    fn formal_time(&mut self, hour: u32) -> DateResult<TimeSpec> {
        let min = self.next_num("minutes after ':'")?;
        let mut sec = 0;
        let mut micros = 0;

        // minute may be followed by [:secs][am|pm]
        let tnext = match self.s.next() {
            Some(Ok(Tokens::Colon)) => {
                sec = self.next_num("seconds after ':'")?;
                match self.s.next() {
                    Some(Ok(Tokens::Dot)) => {
                        // after a `.` implies these are subseconds.
                        // We only care for microsecond precision, so let's
                        // get only the 6 most significant digits
                        micros = self.next_num("fractional seconds after '.'")?;
                        while micros > 1_000_000 {
                            micros /= 10;
                        }
                        self.s.next()
                    }
                    t => t,
                }
            }
            // we don't expect any of these after parsing minutes
            Some(
                Ok(Tokens::Dash | Tokens::Slash | Tokens::Dot | Tokens::Comma | Tokens::Plus)
                | Err(()),
            ) => {
                return Err(DateError::ExpectedToken("':'", self.s.span()));
            }
            t => t,
        };

        match tnext {
            // we need no timezone or hour offset. All good :)
            None => Ok(TimeSpec::new(hour, min, sec, micros)),
            // +/- timezone offset
            Some(Ok(tok @ (Tokens::Plus | Tokens::Dash))) => {
                let sign = if tok == Tokens::Dash { -1 } else { 1 };

                // after a +/-, we expect a numerical offset.
                // either HH:MM or HHMM
                let mut hours = self.next_num("a numeric UTC offset after '+' or '-'")?;

                let s = self.s.clone();
                let minutes = if self.s.next() != Some(Ok(Tokens::Colon)) {
                    // backtrack, we should have the hours and minutes in the single number
                    self.s = s;

                    // 0030
                    //   ^^
                    let minutes = hours % 100;
                    hours /= 100;
                    minutes
                } else {
                    // 02:00
                    //    ^^
                    self.next_num("UTC offset minutes after ':'")?
                };
                // hours and minutes offset in seconds
                let res = 60 * (minutes + 60 * hours);
                let offset = i64::from(res) * sign;
                Ok(TimeSpec::new(hour, min, sec, micros).with_offset(offset))
            }
            Some(Ok(Tokens::Ident)) => match Lowercase::from(self.s.slice()) {
                // 0-offset timezone
                Z => Ok(TimeSpec::new(hour, min, sec, micros).with_offset(0)),
                // morning
                AM if hour == 12 => Ok(TimeSpec::new(0, min, sec, micros)),
                AM => Ok(TimeSpec::new(hour, min, sec, micros)),
                // afternoon
                PM if hour == 12 => Ok(TimeSpec::new(12, min, sec, micros)),
                PM => Ok(TimeSpec::new(hour + 12, min, sec, micros)),
                _ => Err(DateError::ExpectedToken(
                    "'am', 'pm', or 'Z' after the time",
                    self.s.span(),
                )),
            },
            Some(
                Ok(Tokens::Slash | Tokens::Colon | Tokens::Dot | Tokens::Comma | Tokens::Number(_))
                | Err(()),
            ) => Err(DateError::ExpectedToken(
                "a UTC offset or 'Z' after the time",
                self.s.span(),
            )),
        }
    }

    fn informal_time(&mut self, hour: u32) -> DateResult<TimeSpec> {
        let min = self.next_num("minutes after '.'")?;

        let hour = match self.s.next() {
            None => hour,
            Some(Ok(Tokens::Ident)) if Lowercase::from(self.s.slice()) == AM && hour == 12 => 0,
            Some(Ok(Tokens::Ident)) if Lowercase::from(self.s.slice()) == AM => hour,
            Some(Ok(Tokens::Ident)) if Lowercase::from(self.s.slice()) == PM && hour == 12 => 12,
            Some(Ok(Tokens::Ident)) if Lowercase::from(self.s.slice()) == PM => hour + 12,
            Some(_) => {
                return Err(DateError::ExpectedToken(
                    "'am' or 'pm' after the time",
                    self.s.span(),
                ))
            }
        };

        Ok(TimeSpec::new(hour, min, 0, 0))
    }

    pub fn parse_time(&mut self) -> DateResult<Option<TimeSpec>> {
        // here the date parser looked ahead and saw an hour followed by some separator
        if let Some((h, kind)) = self.maybe_time {
            Ok(Some(match kind {
                TimeKind::Formal => self.formal_time(h)?,
                TimeKind::Informal => self.informal_time(h)?,
                TimeKind::Am if h == 12 => TimeSpec::new(0, 0, 0, 0),
                TimeKind::Am => TimeSpec::new(h, 0, 0, 0),
                TimeKind::Pm if h == 12 => TimeSpec::new(12, 0, 0, 0),
                TimeKind::Pm => TimeSpec::new(h + 12, 0, 0, 0),
                TimeKind::Unknown => match self.s.next() {
                    Some(Ok(Tokens::Colon)) => self.formal_time(h)?,
                    Some(Ok(Tokens::Dot)) => self.informal_time(h)?,
                    Some(_) => {
                        return Err(DateError::ExpectedToken(
                            "':' or '.' before the minutes",
                            self.s.span(),
                        ))
                    }
                    None => return Err(DateError::EndOfText("':' or '.' before the minutes")),
                },
            }))
        } else {
            let s = self.s.clone();
            // PATCH(11): 'at' before the time reads as 'T' does: 'tomorrow at 5pm'.
            let mut saw_at = false;
            if self.s.next() != Some(Ok(Tokens::Ident))
                || (self.s.slice() != "T" && {
                    saw_at = Lowercase::from(self.s.slice()) == AT;
                    !saw_at
                })
            {
                // backtrack if we weren't able to consume a 'T' or 'at' time separator
                self.s = s;
            }

            // we're parsing times so we should expect an hour number.
            // if we don't find one, then there's no time here
            let hour = match self.s.next() {
                None if saw_at => return Err(DateError::EndOfText("an hour after 'at'")),
                None => return Ok(None),
                Some(Ok(Tokens::Number(n))) => n,
                Some(_) => {
                    return Err(DateError::ExpectedToken(
                        "an hour after the date",
                        self.s.span(),
                    ))
                }
            };

            match self.s.next() {
                // hh:mm
                Some(Ok(Tokens::Colon)) => self.formal_time(hour).map(Some),
                // hh.mm
                Some(Ok(Tokens::Dot)) => self.informal_time(hour).map(Some),
                // 9am
                // PATCH(1): user text goes through `from`, which lowercases; `literal` asserts on '9 PM'.
                Some(Ok(Tokens::Ident)) => match Lowercase::from(self.s.slice()) {
                    AM => Ok(Some(TimeSpec::new(hour, 0, 0, 0))),
                    PM => Ok(Some(TimeSpec::new(hour + 12, 0, 0, 0))),
                    _ => Err(DateError::ExpectedToken(
                        "'am' or 'pm' after the hour",
                        self.s.span(),
                    )),
                },
                Some(_) => Err(DateError::ExpectedToken(
                    "'am', 'pm', ':' or '.' after the hour",
                    self.s.span(),
                )),
                None => Err(DateError::EndOfText(
                    "'am', 'pm', ':' or '.' after the hour",
                )),
            }
        }
    }

    pub fn parse(&mut self, dialect: Dialect) -> DateResult<DateTimeSpec> {
        let date = self.parse_date(dialect)?;
        let time = self.parse_time()?;
        Ok(DateTimeSpec { date, time })
    }
}
