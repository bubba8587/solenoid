// [[C130]] rustCore, [[C44]] dateSerials
// Writes crates/solenoid-core/data/zones.bin from this Node's Intl: every time zone name Intl takes, and each zone's
// offsets over all of a JS Date's range, for the core's native build (desktop, `cargo test`), which has no Intl. The
// wasm reads the browser's Intl instead. Rerun after a Node (ICU) upgrade; it checks what it wrote against Intl and
// fails on a miss.
//   node scripts/gen-zone-table.mjs
//
// A zone is its first offset (LMT), its transitions from 1800 on, and from some year its yearly rule: two
// transitions, each the first given weekday on or after a day of a month, a fixed number of seconds after that day's
// UTC midnight. The scan runs to 2141; the rule is read off its last forty years and holds from the year it starts
// for ever after, as ICU's final rule does.
//
// The format, every number a LEB128 varint, a signed one zigzagged:
//   names:  count, then each: length, its ASCII bytes in lower case, its zone's index   (sorted)
//   zones:  count, then each: palette size, the palette's offsets in seconds (signed), the first offset's index,
//           transition count, the first's seconds since 1970 (signed) and offset index, then each other as one
//           number: (the time since the previous, as minutes × 2 where it is whole minutes, else seconds × 2 + 1)
//           × palette size + offset index;
//           then 0, or 1 and the rule's first year and its two transitions: month, weekday (0 Sunday), first day,
//           seconds after that day's midnight UTC (signed), offset index
import * as fs from "node:fs";
import * as path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "crates/solenoid-core/data/zones.bin");
const SCAN_FROM = Date.UTC(1800, 0, 1) / 1000;
const SCAN_TO = Date.UTC(2141, 0, 1) / 1000;
const STEP = 12 * 3600;
const RULE_YEARS = [2101, 2140];
// The last seconds of a Date: past them the wall clock itself leaves the range and every read is NaN.
const MAX_S = 8.64e12 - 2 * 86400;

const formats = new Map();
function offsetAt(zone, s) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", era: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formats.set(zone, f);
  }
  const p = {};
  for (const part of f.formatToParts(new Date(s * 1000))) p[part.type] = part.value;
  const y = p.era === "BC" || p.era === "B" ? 1 - Number(p.year) : Number(p.year);
  const d = new Date(0);
  d.setUTCFullYear(y, Number(p.month) - 1, Number(p.day));
  d.setUTCHours(Number(p.hour), Number(p.minute), Number(p.second), 0);
  return d.getTime() / 1000 - s;
}

const days = (s) => Math.floor(s / 86400);
const civil = (day) => {
  const d = new Date(day * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
};
const dayOf = (y, m, d) => {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getTime() / 86400000;
};

/** The transitions in [lo, hi) where the offset at lo is `a` and at hi is `b`. */
function bisect(zone, lo, hi, a, b, out) {
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const o = offsetAt(zone, mid);
    if (o === a) lo = mid;
    else { if (o !== b) bisect(zone, mid, hi, o, b, out); hi = mid; b = o; }
  }
  out.push([hi, b]);
}

function scan(zone, hints) {
  const first = offsetAt(zone, SCAN_FROM);
  const out = [];
  let prev = first;
  for (let s = SCAN_FROM + STEP; s <= SCAN_TO; s += STEP) {
    const o = offsetAt(zone, s);
    if (o !== prev) bisect(zone, s - STEP, s, prev, o, out);
    prev = o;
  }
  // A pair of transitions a step apart that ends where it began shows only at the instants the system's tz files name.
  const seen = new Set(out.map(([t]) => t));
  for (const t of hints) {
    if (t <= SCAN_FROM || t > SCAN_TO || seen.has(t)) continue;
    const a = offsetAt(zone, t - 1), b = offsetAt(zone, t);
    if (a !== b) { out.push([t, b]); seen.add(t); }
  }
  out.sort((x, y) => x[0] - y[0]);
  // A hint inside a step can split one change in two; keep only the transitions that change the offset.
  const trans = [];
  let at = first;
  for (const [t, o] of out) if (o !== at) { trans.push([t, o]); at = o; }
  return { first, trans };
}

/** The year's transitions a rule names, by the wall date before each. */
function ruleTransitions(rule, y) {
  return rule.parts.map((p) => {
    const d0 = dayOf(y, p.month, p.min);
    const d = d0 + ((p.weekday - civil(d0).w + 7) % 7);
    return [d * 86400 + p.secs, p.offset];
  });
}

function inferRule(first, trans) {
  const rows = [];
  for (let i = 0; i < trans.length; i++) {
    const before = i === 0 ? first : trans[i - 1][1];
    const [t, after] = trans[i];
    const day = days(t + before);
    const c = civil(day);
    rows.push({ i, t, after, year: c.y, month: c.m, d: c.d, weekday: c.w, secs: t - day * 86400, before });
  }
  // A zone whose last change is long before the scan's end keeps its last offset (Morocco's listed changes end in 2087).
  if (rows.length === 0 || rows[rows.length - 1].year < RULE_YEARS[1] - 5) return null;
  const window = rows.filter((r) => r.year >= RULE_YEARS[0] && r.year <= RULE_YEARS[1]);
  // The two transitions of a year differ in the offset they bring. Each falls in the same week of a month, which the
  // date can run past (Egypt's last Thursday at 24:00 is a Friday, now and then November's first).
  const groups = new Map();
  for (const r of window) {
    const g = groups.get(r.after);
    if (!g) groups.set(r.after, { weekday: r.weekday, secs: r.secs, offset: r.after, rows: [r] });
    else if (g.weekday !== r.weekday || g.secs !== r.secs) throw new Error(`no yearly rule: ${r.year} moves a transition's weekday or time`);
    else g.rows.push(r);
  }
  const years = RULE_YEARS[1] - RULE_YEARS[0] + 1;
  if (groups.size !== 2 || window.length !== 2 * years) throw new Error(`no yearly rule: ${groups.size} kinds, ${window.length} transitions`);
  const parts = [...groups.values()].map((g) => {
    for (const month of new Set(g.rows.map((r) => r.month))) {
      const rel = g.rows.map((r) => days(r.t + r.before) - dayOf(r.year, month, 1) + 1);
      const min = Math.min(...rel);
      if (Math.max(...rel) - min <= 6 && min >= 1) return { month, weekday: g.weekday, min, secs: g.secs, offset: g.offset };
    }
    throw new Error("no yearly rule: a transition's week wanders");
  });
  const rule = { parts: parts.sort((a, b) => a.month - b.month || a.min - b.min) };
  const byYear = new Map();
  for (const r of rows) (byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)).push([r.t, r.after]);
  const fits = (y) => {
    const want = ruleTransitions(rule, y).sort((a, b) => a[0] - b[0]);
    const got = byYear.get(y) ?? [];
    return got.length === 2 && want.every(([t, o], k) => got[k][0] === t && got[k][1] === o);
  };
  let start = RULE_YEARS[1];
  while (fits(start - 1)) start--;
  for (let y = start; y <= RULE_YEARS[1]; y++) if (!fits(y)) throw new Error(`rule breaks in ${y}`);
  rule.start = start;
  const cut = Math.min(...ruleTransitions(rule, start).map(([t]) => t));
  return { rule, explicit: trans.filter(([t]) => t < cut) };
}

/** The offset the table gives at s, as the core reads it. */
function lookup(z, s) {
  if (z.rule) {
    const cut = Math.min(...ruleTransitions(z.rule, z.rule.start).map(([t]) => t));
    if (s >= cut) {
      const y = civil(days(s)).y;
      let best = null;
      for (const yy of [y - 1, y, y + 1]) {
        if (yy < z.rule.start) continue;
        for (const [t, o] of ruleTransitions(z.rule, yy)) if (t <= s && (!best || t > best[0])) best = [t, o];
      }
      if (best) return best[1];
    }
  }
  let o = z.first;
  for (const [t, off] of z.trans) { if (t <= s) o = off; else break; }
  return o;
}

function tzifTransitions(zone) {
  try {
    const b = fs.readFileSync(path.join("/usr/share/zoneinfo", zone));
    if (b.toString("latin1", 0, 4) !== "TZif") return [];
    const counts = (at) => [0, 1, 2, 3, 4, 5].map((k) => b.readUInt32BE(at + 20 + 4 * k));
    let [isut, isstd, leap, time, type, chars] = counts(0);
    const v1 = 44 + time * 5 + type * 6 + chars + leap * 8 + isstd + isut;
    if (b[4] < 0x32) return [];
    [isut, isstd, leap, time, type, chars] = counts(v1);
    void isut; void isstd; void leap; void type; void chars;
    const out = [];
    for (let k = 0; k < time; k++) out.push(Number(b.readBigInt64BE(v1 + 44 + 8 * k)));
    return out;
  } catch { return []; }
}

function work(zone) {
  const { first, trans } = scan(zone, tzifTransitions(zone));
  const inferred = inferRule(first, trans);
  const z = inferred ? { first, trans: inferred.explicit, rule: inferred.rule } : { first, trans, rule: null };
  // The check: the far past is the first offset, every transition the scan found and every rule transition to 2600
  // read the same both sides, and random instants over the whole range agree.
  const probes = [-MAX_S, SCAN_FROM - 86400 * 365 * 500, MAX_S];
  for (const [t] of trans) probes.push(t - 1, t);
  if (z.rule) for (let y = 2141; y < 2600; y++) for (const [t] of ruleTransitions(z.rule, y)) probes.push(t - 1, t);
  let seed = 1;
  for (const c of zone) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < 3000; k++) probes.push(Math.floor(-MAX_S + rand() * 2 * MAX_S));
  for (let k = 0; k < 2000; k++) probes.push(Math.floor(SCAN_FROM + rand() * (SCAN_TO + 86400 * 365 * 300 - SCAN_FROM)));
  for (const s of probes) {
    const want = offsetAt(zone, s), got = lookup(z, s);
    if (want !== got) throw new Error(`${zone}: at ${new Date(s * 1000).toISOString()} Intl reads ${want}s, the table ${got}s`);
  }
  return z;
}

if (!isMainThread) {
  parentPort.postMessage(workerData.zones.map((zone) => {
    try { return { zone, z: work(zone) }; } catch (e) { return { zone, error: String(e.message ?? e) }; }
  }));
} else {
  const accepts = (z) => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
  const canonical = (z) => new Intl.DateTimeFormat("en-US", { timeZone: z }).resolvedOptions().timeZone;
  // Every name Intl takes: the identifiers in ICU's data, which this Node carries in its binary, as UTF-16 runs and as
  // invariant-character keys, beside the system's tz files and Intl's own list. Case aside: Intl matches names
  // without regard to ASCII case. An offset like "+05:30" is no name; the core parses those.
  const candidates = new Set(Intl.supportedValuesOf("timeZone"));
  const bin = fs.readFileSync(process.execPath);
  for (const start of [0, 1]) {
    let cur = "";
    for (let i = start; i + 1 < bin.length; i += 2) {
      if (bin[i + 1] === 0 && bin[i] > 0x20 && bin[i] < 0x7f) cur += String.fromCharCode(bin[i]);
      else { if (cur.length >= 2 && cur.length <= 40) candidates.add(cur); cur = ""; }
    }
  }
  for (const m of bin.toString("latin1").matchAll(/[A-Za-z][A-Za-z0-9_+\/-]{1,39}/g)) candidates.add(m[0]);
  const walk = (dir, pre) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const name = pre ? `${pre}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), name);
      else candidates.add(name);
    }
  };
  walk("/usr/share/zoneinfo", "");
  const names = new Map();
  for (const c of candidates) {
    if (!/^[A-Za-z][A-Za-z0-9_+\/-]*$/.test(c)) continue;
    const lower = c.toLowerCase();
    if (names.has(lower) || !accepts(c)) continue;
    names.set(lower, canonical(c));
  }
  const zones = [...new Set(names.values())].sort();
  console.log(`${names.size} names, ${zones.length} zones; scanning on ${availableParallelism()} threads`);
  const n = availableParallelism();
  const shards = Array.from({ length: n }, (_, k) => zones.filter((_, i) => i % n === k));
  const results = (await Promise.all(shards.map((s) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { zones: s } });
    w.once("message", resolve);
    w.once("error", reject);
  })))).flat();
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    for (const f of failed) console.error(`${f.zone}: ${f.error}`);
    process.exit(1);
  }
  const byZone = new Map(results.map((r) => [r.zone, r.z]));

  const bytes = [];
  const uv = (x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new Error(`bad varint ${x}`);
    do { let b = x % 128; x = Math.floor(x / 128); if (x > 0) b |= 128; bytes.push(b); } while (x > 0);
  };
  const sv = (x) => uv(x < 0 ? -2 * x - 1 : 2 * x);
  // Zones with the same offsets share one entry.
  const encoded = new Map();
  const zoneIndex = new Map();
  const blobs = [];
  for (const zone of zones) {
    const z = byZone.get(zone);
    const start = bytes.length;
    const palette = [...new Set([z.first, ...z.trans.map(([, o]) => o), ...(z.rule ? z.rule.parts.map((p) => p.offset) : [])])];
    const at = (o) => palette.indexOf(o);
    uv(palette.length);
    for (const o of palette) sv(o);
    uv(at(z.first));
    uv(z.trans.length);
    let prev = 0;
    z.trans.forEach(([t, o], k) => {
      if (k === 0) { sv(t); uv(at(o)); } else {
        const d = t - prev;
        uv((d % 60 === 0 ? (d / 60) * 2 : d * 2 + 1) * palette.length + at(o));
      }
      prev = t;
    });
    if (z.rule) {
      uv(1);
      uv(z.rule.start);
      for (const p of z.rule.parts) { uv(p.month); uv(p.weekday); uv(p.min); sv(p.secs); uv(at(p.offset)); }
    } else uv(0);
    const blob = bytes.splice(start).map((b) => String.fromCharCode(b)).join("");
    if (!encoded.has(blob)) { encoded.set(blob, blobs.length); blobs.push(blob); }
    zoneIndex.set(zone, encoded.get(blob));
  }
  const sorted = [...names.keys()].sort();
  uv(sorted.length);
  for (const name of sorted) {
    uv(name.length);
    for (const ch of name) bytes.push(ch.charCodeAt(0));
    uv(zoneIndex.get(names.get(name)));
  }
  uv(blobs.length);
  for (const b of blobs) for (const ch of b) bytes.push(ch.charCodeAt(0));
  fs.writeFileSync(OUT, Buffer.from(bytes));
  const transitions = zones.reduce((s, z) => s + byZone.get(z).trans.length, 0);
  console.log(`${path.relative(ROOT, OUT)}: ${bytes.length} bytes, ${sorted.length} names, ${blobs.length} distinct zones, ${transitions} transitions, ICU ${process.versions.icu}, tz ${process.versions.tz}`);
}
