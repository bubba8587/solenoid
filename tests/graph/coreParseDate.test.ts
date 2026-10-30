// [[C58]] tableInputRawText, [[D99]] rustIsSpec
// Text a typed date input reads (Value Input's date entry, Frame and Table cells, vault properties): the core's
// `engine_parse_date`, frozen from chrono-node's answers to `parseDate` when the absolute shapes moved to the core, with
// one change on purpose: a date that reads as day/month or month/day stays `#AMBIGUOUS!` with a time after it, where
// chrono read it month first. Relative phrases ("next friday") stay with chrono-node behind Settings ▸ Relative dates
// ([[C44]]). FREEZE_CORE=parse-date re-records the core's answers after a deliberate change.
import { it, expect } from "vitest";
import { frozen, sameJson } from "./coreFixtures";
import { wasmInvokeSync } from "../../src/graph/engineWasm";

interface Case { text: string; want: unknown }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ord = (d: number) => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

/** Every shape a typed input meets, over dates that test the edges: leap days, days a month lacks, D/M vs M/D
 *  ambiguity, two-digit and 0-99 years, wrong weekdays, times and zones, noise around the date. */
function corpus(): string[] {
  const out = new Set<string>();
  const dates: [number, number, number][] = [
    [2024, 3, 5], [2024, 2, 29], [2023, 2, 29], [2026, 4, 31], [2026, 12, 31], [1999, 1, 1], [1900, 1, 1],
    [2000, 2, 29], [2026, 10, 24], [2026, 11, 3], [2026, 3, 12], [2026, 7, 7], [1970, 1, 1], [2099, 6, 15],
  ];
  const times = ["", " 10:30", " 3pm", " 3:30 pm", " 15:00:00", " at 9am", ", 10:30", "T10:30", "T10:30:15.5Z", "T08:00+05:30"];
  for (const [y, m, d] of dates) {
    const mon = MONTHS[m - 1], mo3 = mon.slice(0, 3);
    const wd = DAYS[new Date(Date.UTC(y, m - 1, Math.min(d, 28))).getUTCDay()];
    const shapes = [
      `${y}-${pad(m)}-${pad(d)}`, `${y}-${m}-${d}`, `${y}/${pad(m)}/${pad(d)}`, `${y}.${pad(m)}.${pad(d)}`,
      `${d} ${mon} ${y}`, `${d} ${mo3} ${y}`, `${d}-${mo3}-${y}`, `${pad(d)}-${mo3}-${y}`, `${ord(d)} of ${mon} ${y}`,
      `${mon} ${d}, ${y}`, `${mo3} ${d} ${y}`, `${mon} ${ord(d)} ${y}`, `${mo3}. ${d}, ${y}`, `${mon.toLowerCase()} ${d} ${y}`,
      `${mon.toUpperCase()} ${d}, ${y}`, `${wd}, ${mon} ${d}, ${y}`, `Monday, ${mon} ${d}, ${y}`, `${wd.slice(0, 3)} ${mo3} ${pad(d)} ${y}`,
      `${y} ${mon} ${d}`, `${m}/${d}/${y}`, `${d}/${m}/${y}`, `${pad(m)}-${pad(d)}-${y}`, `${d}.${m}.${y}`,
      `${mo3} ${d} ${String(y).slice(2)}`, `${m}/${d}/${String(y).slice(2)}`, `${mon} ${y}`, `${mo3} ${d}`,
    ];
    for (const s of shapes) for (const t of times) out.add(s + t);
  }
  for (const s of [
    "", " ", "2024", "20240305", "45356", "-5", "1.5", "+2024-03-05", "0026-01-01", "0099-12-31", "002024-03-05",
    "2024-03-05 and 2024-03-06", "2024-03-05.", "2024-03-05,", "  2024-03-05  ", "2024-03-05 junk", "March 5, 2024 junk",
    "next friday", "tomorrow", "in 3 days", "last monday", "5 Mar", "Mar 2024", "Q1 2024", "2024-W10", "2024-13-01",
    "2024-00-10", "2024-03-00", "2024-3-5T25:00", "2024-03-05T23:59:60", "2024-03-05T10:30:00-00:30", "Sat Mar 05 2024 10:30:00 GMT+0000",
    "05/03/2024", "13/03/2024", "03/13/2024", "3/3/2024", "12.11.2024", "31.12.2024", "March 32, 2024", "Feb 30 2024",
  ]) out.add(s);
  return [...out];
}

const coreReading = (text: string): unknown => {
  const r = wasmInvokeSync<number | null | { ambiguous: string }>("engine_parse_date", { text });
  return r === null ? NaN : typeof r === "number" ? r : { __err: "#AMBIGUOUS!", msg: r.ambiguous };
};

it("reads typed date text as the inputs read it", () => {
  const cases = frozen<Case>("parse-date", () => corpus().map((text) => ({ text, want: coreReading(text) })));
  expect(cases.length).toBeGreaterThan(3000);
  const bad = cases.filter((c) => !sameJson(coreReading(c.text), c.want));
  expect(bad.slice(0, 5).map((c) => ({ text: c.text, want: c.want, got: coreReading(c.text) }))).toEqual([]);
});
