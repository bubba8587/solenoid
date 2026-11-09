// [[D99]] rustIsSpec
// Frozen answers the Rust core is held to (fixtures/core/<suite>.json.gz). Without FREEZE_CORE a suite reads its file;
// with it, the suite's cases are answered again by the core and written back, which is how a deliberate change in
// behaviour moves a fixture.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { solError, isSolError, type SolErrorCode } from "../../src/graph/errorValue";

/** FREEZE_CORE=1 freezes every suite; FREEZE_CORE=frame-fns,columns only those, so the rest keep their bytes. */
const FREEZE = process.env.FREEZE_CORE ?? "";
export const FREEZING = FREEZE !== "";
export const freezes = (suite: string): boolean => FREEZE === "1" || FREEZE.split(",").includes(suite);
const DIR = path.resolve(__dirname, "../../fixtures/core");

/** A value as JSON: non-finite numbers, -0, undefined and errors become tagged objects, arrays recurse. */
export function enc(v: unknown): unknown {
  if (v === undefined) return { __undef: 1 };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { __nf: "nan" };
    if (!Number.isFinite(v)) return { __nf: v > 0 ? "inf" : "-inf" };
    return Object.is(v, -0) ? { __nf: "-0" } : v;
  }
  if (isSolError(v)) return { __err: v.code, msg: v.message };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}

export function dec(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("__undef" in o) return undefined;
    if (typeof o.__nf === "string") return { nan: NaN, inf: Infinity, "-inf": -Infinity, "-0": -0 }[o.__nf];
    if (typeof o.__err === "string") return solError(o.__err as SolErrorCode, String(o.msg ?? ""));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, dec(x)]));
  }
  return v;
}

const fileOf = (suite: string) => path.join(DIR, `${suite}.json.gz`);

/** A suite's frozen cases; with `keep`, only those it keeps (it reads each case as the file holds it). */
export function readFrozen<C>(suite: string, keep?: (raw: unknown, i: number) => boolean): C[] {
  const file = fileOf(suite);
  if (!fs.existsSync(file)) throw new Error(`no frozen cases for ${suite}`);
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as unknown[];
  return (keep ? raw.filter(keep) : raw).map(dec) as C[];
}

export function writeFrozen<C>(suite: string, cases: readonly C[]): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(suite), zlib.gzipSync(JSON.stringify(cases.map(enc)), { level: 9 }));
}

/** Each frozen case's answer, `got`, held to its `want`: with FREEZE_CORE naming the suite, `got` becomes the case's
 *  `want` and the file is written; otherwise the cases that differ come back (the first few, for the failure). */
export function replay<C extends { want: unknown }>(suite: string, cases: C[], got: (c: C) => unknown, same = sameJson): unknown[] {
  const bad: unknown[] = [];
  const soured: unknown[] = [];
  for (const c of cases) {
    const g = got(c);
    if (freezes(suite)) {
      if (!isErrorAnswer(c.want) && isErrorAnswer(g)) soured.push({ ...c, got: g });
      c.want = g;
    } else if (!same(g, c.want)) bad.push({ ...c, got: g });
  }
  if (freezes(suite)) {
    refuseSouredFreeze(suite, soured, cases);
    writeFrozen(suite, cases);
  }
  return bad.slice(0, 5);
}

/** An answer that is an error: a wired error value, or a case's error or thrown record. */
const isErrorAnswer = (v: unknown): boolean => {
  const t = JSON.stringify(enc(v)) ?? "";
  return t.includes('"__err"') || t.startsWith('{"error"') || t.startsWith('{"thrown"');
};

/** A refreeze that turns many real answers into errors has usually lost its inputs (a renamed argument, a moved
 *  column), not changed behavior: it would freeze the errors as the answers, and the suite would stop pinning
 *  anything. Counted per function (a case's `name`), so one gutted function can't hide in a big suite: more than a
 *  tenth of a function's cases, and at least 20, souring at once stops the freeze unless FREEZE_ALLOW_ERRORS=1 says
 *  the change is meant. */
function refuseSouredFreeze(suite: string, soured: unknown[], cases: readonly unknown[]): void {
  if (process.env.FREEZE_ALLOW_ERRORS === "1" || soured.length < 20) return;
  const key = (c: unknown) => String((c as { name?: unknown }).name ?? "");
  const count = (cs: readonly unknown[]) => cs.reduce<Map<string, number>>((m, c) => m.set(key(c), (m.get(key(c)) ?? 0) + 1), new Map());
  const totals = count(cases);
  const gone = [...count(soured)].filter(([k, n]) => n >= 20 && n * 10 > (totals.get(k) ?? 0));
  if (!gone.length) return;
  const sample = soured.filter((c) => key(c) === gone[0][0]).slice(0, 2).map((c) => JSON.stringify(enc(c)).slice(0, 300)).join("\n");
  throw new Error(
    `${suite}: answers would freeze as errors where they were values (${gone.map(([k, n]) => `${k || "cases"} ${n} of ${totals.get(k)}`).join(", ")}). ` +
      `Check the cases' inputs still mean what they did; FREEZE_ALLOW_ERRORS=1 freezes anyway.\n${sample}`,
  );
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(enc(a)) === JSON.stringify(enc(b));

/** The cases a wasm replay checks: every one while the suite freezes, so its file is written whole, else every
 *  `every`-th. For a suite the native tests replay whole (each crate's `tests` folder), the wasm build needs only a sample to
 *  show it agrees. */
export function sampled<C>(suite: string, cases: readonly C[], every: number): C[] {
  return freezes(suite) ? [...cases] : cases.filter((_, i) => i % every === 0);
}

/** The suite's cases: made and written when freezing, read back otherwise. `make` is the only place they are made. */
export function frozen<C>(suite: string, make: () => C[]): C[] {
  if (freezes(suite)) {
    const cases = make();
    writeFrozen(suite, cases);
    return cases;
  }
  return readFrozen<C>(suite);
}
