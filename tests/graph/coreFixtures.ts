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

/** A suite's frozen cases. */
export function readFrozen<C>(suite: string): C[] {
  const file = fileOf(suite);
  if (!fs.existsSync(file)) throw new Error(`no frozen cases for ${suite}`);
  return (JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as unknown[]).map(dec) as C[];
}

export function writeFrozen<C>(suite: string, cases: readonly C[]): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(suite), zlib.gzipSync(JSON.stringify(cases.map(enc)), { level: 9 }));
}

/** Each frozen case's answer, `got`, held to its `want`: with FREEZE_CORE naming the suite, `got` becomes the case's
 *  `want` and the file is written; otherwise the cases that differ come back (the first few, for the failure). */
export function replay<C extends { want: unknown }>(suite: string, cases: C[], got: (c: C) => unknown, same = sameJson): unknown[] {
  const bad: unknown[] = [];
  for (const c of cases) {
    const g = got(c);
    if (freezes(suite)) c.want = g;
    else if (!same(g, c.want)) bad.push({ ...c, got: g });
  }
  if (freezes(suite)) writeFrozen(suite, cases);
  return bad.slice(0, 5);
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(enc(a)) === JSON.stringify(enc(b));

/** The suite's cases: made and written when freezing, read back otherwise. `make` is the only place they are made. */
export function frozen<C>(suite: string, make: () => C[]): C[] {
  if (freezes(suite)) {
    const cases = make();
    writeFrozen(suite, cases);
    return cases;
  }
  return readFrozen<C>(suite);
}
