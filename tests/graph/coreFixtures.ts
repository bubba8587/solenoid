// [[D99]] rustIsSpec
// Frozen answers the Rust core is held to. FREEZE_CORE=1 runs a suite's generator through the TypeScript and writes
// its cases to fixtures/core/<suite>.json.gz; without it, the suite reads the file, so it needs no TypeScript body.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { solError, isSolError, type SolErrorCode } from "../../src/graph/errorValue";

export const FREEZING = process.env.FREEZE_CORE === "1";
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

/** The suite's cases: made and written when freezing, read back otherwise. `make` is the only place the TypeScript runs. */
export function frozen<C>(suite: string, make: () => C[]): C[] {
  const file = path.join(DIR, `${suite}.json.gz`);
  if (FREEZING) {
    const cases = make();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(cases.map(enc)), { level: 9 }));
    return cases;
  }
  if (!fs.existsSync(file)) throw new Error(`no frozen cases for ${suite}: run FREEZE_CORE=1 while its TypeScript exists`);
  return (JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as unknown[]).map(dec) as C[];
}
