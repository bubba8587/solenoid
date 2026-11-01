// [[C44]] dateSerials, [[D99]] rustIsSpec
// The relative phrases a date entry reads (`relative_date.rs`), each against reference instants in a few zones: month
// and year ends, a leap day, both DST edges in New York and Lord Howe (half an hour), Sundays and Mondays. Made
// deterministically, so a refreeze writes the same cases. No imports: a plain Node script loads it too.

export interface RelativeCase { text: string; zone: string; now: number }

/** A small seeded generator. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ZONES = ["UTC", "America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu"];

/** The reference instants, in UTC. */
export const INSTANTS = [
  "2026-01-31T23:30:00Z", "2026-02-01T04:10:00Z", "2026-02-28T12:00:00Z", "2024-02-29T09:15:00Z",
  "2024-02-28T22:45:00Z", "2024-12-31T23:59:00Z", "2025-01-01T00:01:00Z", "2026-03-08T06:30:00Z",
  "2026-03-08T07:30:00Z", "2026-03-08T04:59:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z",
  "2026-10-03T15:00:00Z", "2026-10-03T16:00:00Z", "2026-04-04T14:30:00Z", "2026-04-04T15:30:00Z",
  "2026-11-02T00:15:00Z", "2026-06-15T05:59:00Z", "2026-06-14T18:00:00Z", "2026-12-27T13:00:00Z",
  "2027-07-04T03:00:00Z", "2026-04-30T23:00:00Z", "2026-10-31T11:00:00Z", "2026-11-01T12:00:00Z",
].map((s) => Date.parse(s));

const WEEKDAYS = [
  "sunday", "sun", "sun.", "monday", "mon", "mon.", "tuesday", "tue", "tue.", "tues", "wednesday", "wed", "wed.",
  "thursday", "thurs", "thurs.", "thur", "thur.", "thu", "thu.", "friday", "fri", "fri.", "saturday", "sat", "sat.",
  "weekend", "weekday",
];
const MONTHS = [
  "january", "jan", "jan.", "february", "feb", "march", "mar", "april", "apr", "may", "june", "jun", "july", "jul",
  "august", "aug", "september", "sep", "sept", "sept.", "october", "oct", "november", "nov", "december", "dec",
];
const UNITS = [
  "s", "sec", "second", "seconds", "m", "min", "mins", "minute", "minutes", "h", "hr", "hrs", "hour", "hours", "d",
  "day", "days", "w", "week", "weeks", "mo", "mon", "mos", "month", "months", "qtr", "quarter", "quarters", "y", "yr",
  "year", "years",
];
const NUMBERS = [
  "1", "2", "3", "0", "7", "10", "12", "31", "100", "365", "1.5", "2.5", "0.5", "one", "two", "three", "five", "ten",
  "twelve", "a", "an", "the", "half", "half a", "half an", "a few", "few", "several", "a couple of", "couple", "couple of",
];
const ORDINALS = ["1st", "2nd", "3rd", "4th", "11th", "21st", "22nd", "29th", "30th", "31st", "32nd", "first", "second", "fifteenth", "twenty first", "twenty-third", "thirty-first", "5", "15", "29", "31"];
const TIMES = [
  "5pm", "5 pm", "5:30pm", "5:30 p.m.", "17:00", "9am", "9:15", "9.30", "12am", "12pm", "12:00", "0:30", "23:59",
  "24:00", "11:59:59 pm", "10:30:15.250", "noon", "midnight", "3", "11 o'clock", "8 at night", "4 in the afternoon",
  "7 in the morning", "1a", "130", "1130", "25", "9-11", "9pm - 1am", "10 to 11", "5pm EST", "11pm PST", "1am JST",
  "11:30 pm CET", "2am ET", "9pm GMT", "9pm gmt", "10pm +0530", "10pm GMT+2", "6pm UTC-03:00", "noon IST", "8pm (PDT)",
  "11 PM ACDT", "3pm NZDT", "9pm xyz",
];
const CASUAL = [
  "now", "today", "tonight", "tomorrow", "overmorrow", "tmr", "tmrw", "yesterday", "last night", "lastnight",
  "this morning", "this afternoon", "this evening", "tonight at 11", "today at noon", "today midnight", "tomorrow morning",
  "tomorrow night", "yesterday evening", "yesterday afternoon", "tomorrow noon", "tomorrow at midnight", "today evening",
  "now please", "right now", "just now", "today!", "today?", "today...", "today,", "today.", "(today)", "today;",
];
const RELATIVE_UNITS = ["day", "week", "month", "year", "quarter", "hour", "minute", "second", "weekend", "mon", "w", "d", "y", "mo", "qtr", "yr", "hr", "m", "s", "h"];
const MODIFIERS = ["this", "next", "last", "past", "after this", "coming", "upcoming"];
const SURROUND = [
  (s: string) => s, (s: string) => `  ${s}  `, (s: string) => `${s}.`, (s: string) => `${s},`, (s: string) => `${s} .`,
  (s: string) => `by ${s}`, (s: string) => `due ${s}`, (s: string) => `${s} please`, (s: string) => `until ${s}`,
  (s: string) => `on ${s}`, (s: string) => `${s}!`, (s: string) => `${s} ,.`, (s: string) => `(${s})`,
];

function cases(s: string, r: () => number): string[] {
  const out = [s, s.toUpperCase()];
  out.push(s.replace(/\b\w/g, (c) => c.toUpperCase()));
  out.push([...s].map((c) => (r() < 0.5 ? c.toUpperCase() : c)).join(""));
  return out;
}

/** Every phrase, once. */
export function relativePhrases(): string[] {
  const r = rng(44);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const out = new Set<string>();
  const add = (s: string) => out.add(s);

  // Casual dates and times, with their cases and surroundings.
  for (const c of CASUAL) {
    for (const v of cases(c, r)) add(v);
    for (const f of SURROUND) add(f(c));
  }
  // Weekdays with this/next/last, before or after.
  for (const w of WEEKDAYS) {
    for (const pre of ["", "this ", "next ", "last ", "past ", "on ", "on next ", "coming ", "upcoming ", "this coming ", "the next ", "next  ", "nexT ", "on the "]) add(pre + w);
    for (const post of [" this week", " next week", " last week", " past week", " of next week", " of last week", ",", " (next week)", " next", " last"]) add(w + post);
    add(`(${w})`); add(`, ${w}`); add(`${w.toUpperCase()}`); add(`Next ${w}`);
  }
  // Weekdays with times, a date and time merged.
  for (let i = 0; i < 260; i++) {
    const w = pick(WEEKDAYS), t = pick(TIMES), pre = pick(["", "next ", "last ", "this "]);
    add(pick([`${pre}${w} ${t}`, `${pre}${w} at ${t}`, `${t} ${pre}${w}`, `${t} on ${pre}${w}`, `${pre}${w}, ${t}`, `${pre}${w} - ${t}`]));
  }
  // Casual words with times.
  for (const c of ["today", "tomorrow", "yesterday", "tonight", "now", "tmr", "overmorrow", "last night"]) {
    for (const t of TIMES) add(pick([`${c} ${t}`, `${c} at ${t}`, `${t} ${c}`, `${c}, ${t}`, `${c} @ ${t}`, `${c} T${t}`]));
    add(`${c} at 5`); add(`${c} at 5pm`); add(`${c} 11:59pm`); add(`${c} 0:00`); add(`5pm ${c}`);
  }
  // "N units ago / from now / later / before / after / in N units / within / +N".
  const forms = [
    (n: string, u: string) => `in ${n} ${u}`, (n: string, u: string) => `${n} ${u} ago`, (n: string, u: string) => `${n} ${u} from now`,
    (n: string, u: string) => `${n} ${u} later`, (n: string, u: string) => `${n} ${u} before`, (n: string, u: string) => `after ${n} ${u}`,
    (n: string, u: string) => `within ${n} ${u}`, (n: string, u: string) => `for ${n} ${u}`, (n: string, u: string) => `+${n} ${u}`,
    (n: string, u: string) => `-${n} ${u}`, (n: string, u: string) => `next ${n} ${u}`, (n: string, u: string) => `last ${n} ${u}`,
    (n: string, u: string) => `past ${n} ${u}`, (n: string, u: string) => `this ${n} ${u}`, (n: string, u: string) => `in ${n}${u}`,
    (n: string, u: string) => `${n}${u} ago`, (n: string, u: string) => `in about ${n} ${u}`, (n: string, u: string) => `about ${n} ${u} ago`,
    (n: string, u: string) => `${n} ${u} earlier`, (n: string, u: string) => `${n} ${u} after`, (n: string, u: string) => `${n} ${u} out`,
    (n: string, u: string) => `in ${n} ${u} from now`, (n: string, u: string) => `${n} ${u} henceforth`, (n: string, u: string) => `in just ${n} ${u}`,
  ];
  for (const n of NUMBERS) for (const u of UNITS) for (let k = 0; k < 2; k++) add(pick(forms)(n, u));
  for (const f of forms) for (const u of ["day", "days", "week", "weeks", "month", "months", "year", "years", "hours", "minutes"]) add(f("3", u));
  // Several units at once.
  for (let i = 0; i < 160; i++) {
    const parts = Array.from({ length: 2 + Math.floor(r() * 2) }, () => `${pick(NUMBERS)} ${pick(UNITS)}`);
    const joined = parts.join(pick([" ", ", ", " and ", ",", " , and "]));
    add(pick([`in ${joined}`, `${joined} ago`, `${joined} from now`, `+${joined}`, `${joined} later`]));
  }
  // "this/next/last unit", "end of", "last day of".
  for (const m of MODIFIERS) for (const u of RELATIVE_UNITS) { add(`${m} ${u}`); add(`${m}${u}`); }
  for (const m of ["this", "next", "last", "past"]) for (const p of ["week", "month", "year"]) {
    add(`end of ${m} ${p}`); add(`last day of ${m} ${p}`); add(`the end of ${m} ${p}`); add(`End Of ${m} ${p}`);
  }
  for (const s of ["end of month", "end of the month", "last day of month", "last day of the month", "end of month next", "end of this month"]) add(s);
  for (const mo of MONTHS) {
    for (const m of ["this", "next", "last"]) { add(`end of ${mo} ${m} year`); add(`${mo} ${m} year`); add(`last day of ${mo} next year`); }
    add(`in ${mo} next year`); add(`next ${mo}`); add(`last ${mo}`); add(`${mo} next`);
  }
  // Month names and ordinals with a relative word somewhere.
  for (let i = 0; i < 260; i++) {
    const mo = pick(MONTHS), d = pick(ORDINALS), w = pick(["next year", "last year", "this year", "next week", "tomorrow", "next friday", "at 5pm today", "this", "next", "last"]);
    add(pick([`${d} ${mo} ${w}`, `${mo} ${d} ${w}`, `${d} of ${mo} ${w}`, `${w} ${mo} ${d}`, `${mo} ${d} - ${pick(ORDINALS)} ${w}`, `${d} to ${pick(ORDINALS)} ${mo} ${w}`, `on ${d} ${mo} ${w}`, `${mo} ${d}, 26 ${w}`, `${d} ${mo} 99 ${w}`]));
  }
  // Ranges.
  for (let i = 0; i < 140; i++) {
    const a = pick([...CASUAL.slice(0, 9), "next friday", "monday", "last tuesday", "this weekend", "next week", "in 3 days"]);
    const b = pick([...CASUAL.slice(0, 9), "next friday", "sunday", "next monday", "next month", "in 2 weeks", "5pm"]);
    add(`${a} ${pick(["to", "-", "–", "until", "through", "till", "and"])} ${b}`);
  }
  // Relative to a date: "3 days after tomorrow", "next friday +2 days".
  for (let i = 0; i < 160; i++) {
    const d = pick(["tomorrow", "next friday", "today", "yesterday", "last monday", "monday", "next week", "this friday"]);
    const n = `${pick(["1", "2", "3", "10", "a", "two", "a few"])} ${pick(["days", "day", "weeks", "hours", "months", "years", "d", "w"])}`;
    add(pick([`${n} after ${d}`, `${n} before ${d}`, `${n} from ${d}`, `${n} since ${d}`, `${d} +${n}`, `${d} -${n}`, `${d} + ${n}`, `${n} later than ${d}`]));
  }
  // Numeric dates beside a relative word, two-digit years, slashes and dots.
  for (let i = 0; i < 180; i++) {
    const a = 1 + Math.floor(r() * 35), b = 1 + Math.floor(r() * 35), y = Math.floor(r() * 100);
    const num = pick([`${a}/${b}`, `${a}/${b}/${String(y).padStart(2, "0")}`, `${a}.${b}.${y}`, `${a}-${b}-${y}`, `${a}.${b}`, `${a}-${b}`, `0${a % 10}/0${b % 10}`]);
    add(pick([`next ${num}`, `${num} next week`, `today ${num}`, `on ${num} at 5pm tomorrow`, `${num} tomorrow`, `tomorrow ${num}`, `${num} ago`, `in ${num}`, `friday ${num}`, `friday, ${num}`, `${num} friday`]));
  }
  // Year eras and suffixes.
  for (const s of ["march 12 AD next", "5 BC next year", "jan 5 BE last", "12 AD march next", "1 CE jan tomorrow", "may 5 next", "in may next year", "may next", "may tomorrow", "next may", "tomorrow may", "you may come tomorrow", "the second tomorrow", "tomorrow the second", "next the second", "on the second next week"]) add(s);
  // Things it rejects or reads only partly.
  for (const s of [
    "next", "last", "this", "ago", "from now", "in 3", "in 3 bananas", "3 days", "the next one", "nextfriday", "friday-ish",
    "in a while", "sometime next week", "next friday or so", "every monday", "monday or tuesday", "mon tue", "mon, tue",
    "tomorrow tomorrow", "today today", "now now", "next next friday", "last last week", "yesterday's", "tomorrows",
    "todayx", "xtoday", "to-day", "to day", "tomorow", "yesturday", "friday13", "13friday", "monday 3/4", "next mon",
    "next tues", "next thu.", "next sat.", "past sun", "next sunday morning", "monday at 25", "tomorrow at 1.1",
    "tomorrow at 1.25", "tomorrow at 12.30", "tomorrow at 203", "tomorrow at 2014", "tomorrow at 1", "tomorrow +thes",
    "tomorrow +ad", "tomorrow +the d", "next friday +", "+2 days", "-2 days", "+ 2 days", "in -2 days", "in 1e3 days",
    "in 99999999 years", "in 300000 years", "999999 days ago", "in 0 days", "0 days ago", "in 1.25 days", "in 2.5 hours",
    "in 1.5 weeks", "in 0.5 months", "in 1.5 years", "in 2.75 quarters", "in half a day", "in half an hour", "half a year ago",
    "in a day", "in an hour", "in a week", "a day ago", "an hour ago", "a week from now", "a month later", "the day after tomorrow",
    "day after tomorrow", "the day before yesterday", "2 days after tomorrow", "tomorrow at 5pm EST", "tomorrow 5pm est",
    "tomorrow est", "tomorrow EST", "tomorrow GMT", "tomorrow gmt", "today CET", "today 11pm CET", "now UTC", "now PST",
    "in 3 days EST", "in 3 days est", "in 3 hours PST", "in 3 hours pst", "tomorrow +05:30", "tomorrow 5pm +05:30",
    "tomorrow 5pm -0800", "tomorrow 5pm UTC+14", "tomorrow 5pm UTC+15", "next friday (EST)", "yesterday 10am JST",
    "\ttomorrow\t", "tomorrow at 5pm", "next friday", "ｔｏｍｏｒｒｏｗ", "tomorrow：5", "tomorrow at 5：30",
    "tomorrow（）", "（friday）", "（next friday）", "friday）", "friday)", "(friday", "fri, next week", "on friday, next week",
    "thursday of next week", "next week thursday", "the weekend", "this weekend", "next weekend", "last weekend",
    "weekday", "next weekday", "last weekday", "this weekday", "coming friday", "upcoming friday", "after friday",
    "after this week", "after this month", "afterthis week", "after this d", "this d", "this s", "next s", "next h", "next m",
    "last mo", "next qtr", "this qtr", "past year", "past week", "past month", "last sec", "next min", "this hour",
    "tonight 11", "tonight 23:00", "tonight 3am", "midnight tonight", "noon tomorrow", "midday tomorrow", "this midday",
    "this night", "tomorrow this morning", "last night 11pm", "last night at 3am", "yesterday night", "now at 5pm",
    "today 9-11", "today 9pm-1am", "today 10:00 to 12:00", "tomorrow 11pm - 2am", "tomorrow 9 to 5", "friday 9pm to 1am",
    "today 2022-12", "tomorrow 456-12", "today 12:5", "today 7.5", "tomorrow at 12.300", "today at 5 pm.", "today at 5pm,",
    "in 5 minutes", "in 90 minutes", "in 23 hours", "in 24 hours", "in 25 hours", "in 48 hours", "in 3600 seconds",
    "30 minutes ago", "12 hours ago", "36 hours from now", "in 1 hour 30 minutes", "2 hours and 30 minutes ago",
  ]) add(s);
  for (const s of [...out]) if (r() < 0.06) add(pick(SURROUND)(s));
  // Random runs of the vocabulary, for the combinations no list above names.
  const VOCAB = [
    "next", "last", "this", "past", "coming", "in", "ago", "from now", "after", "before", "at", "on", "of", "the", "to",
    "-", "+", ",", ".", "and", "until", "end of", "today", "tomorrow", "yesterday", "tonight", "now", "morning", "noon",
    "midnight", "evening", "week", "month", "year", "weekend", ...WEEKDAYS.slice(0, 12), ...MONTHS.slice(0, 10),
    ...NUMBERS.slice(0, 12), ...UNITS.slice(0, 16), ...ORDINALS.slice(0, 8), ...TIMES.slice(0, 20), "3/4", "12/31/26", "EST", "pm",
  ];
  for (let i = 0; i < 2600; i++) {
    const len = 2 + Math.floor(r() * 4);
    add(Array.from({ length: len }, () => pick(VOCAB)).join(r() < 0.85 ? " " : ""));
  }
  return [...out];
}

/** Each phrase against a few drawn references, and the core phrases against every zone and instant. */
export function relativeDateCorpus(): RelativeCase[] {
  const r = rng(7);
  const phrases = relativePhrases();
  const out: RelativeCase[] = [];
  const core = new Set([
    "today", "tomorrow", "yesterday", "now", "tonight", "next friday", "last monday", "this sunday", "monday", "sunday",
    "saturday", "in 3 days", "3 days ago", "2 weeks ago", "in 2 weeks", "in 1 month", "1 month ago", "in 1 year", "next week",
    "last week", "this week", "next month", "last month", "this month", "next year", "last year", "this year", "end of month",
    "end of next month", "end of this year", "end of last week", "in 3 hours", "in 30 minutes", "12 hours ago", "in 1.5 days",
    "tomorrow at 5pm", "tomorrow 11pm EST", "today 11pm CET", "midnight", "noon", "this morning", "last night", "overmorrow",
    "next weekend", "last weekend", "next weekday", "last weekday", "next mon", "3 days after tomorrow", "2 days before next friday",
    "next friday +2 days", "tomorrow - friday", "in a few days", "half a year ago", "next quarter", "in 2 quarters",
  ]);
  for (const text of phrases) {
    if (core.has(text)) {
      for (const zone of ZONES) for (const now of INSTANTS) out.push({ text, zone, now });
      continue;
    }
    out.push({ text, zone: "UTC", now: INSTANTS[Math.floor(r() * INSTANTS.length)] });
    for (let k = 0; k < 4; k++) out.push({ text, zone: ZONES[Math.floor(r() * ZONES.length)], now: INSTANTS[Math.floor(r() * INSTANTS.length)] });
  }
  return out;
}
