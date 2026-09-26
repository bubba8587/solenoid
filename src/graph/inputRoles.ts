// [[D86]] blankRoles, [[C80]] blankArgIsExcelBlank
import { solError, isSolError, type SolError } from "./errorValue";

/**
 * What a blank means for one input. An input with no declared role is data: its blank stays blank.
 * `setting`: a blank reads as `blank` (`LEFT_OUT` for the function's own default), item by item in a list.
 * `required`: a setting with no default; a blank is `#SYNTAX!`.
 * `picks`: positions; a blank pick is dropped, none left is the picks left out (`#SYNTAX!` when `required`).
 */
export type InputRole =
  | { kind: "setting"; blank: unknown }
  | { kind: "required" }
  | { kind: "picks"; required: boolean };

export const LEFT_OUT = undefined;
export const setting = (blank: unknown): InputRole => ({ kind: "setting", blank });
export const required: InputRole = { kind: "required" };
export const picks = (opts: { required?: boolean } = {}): InputRole => ({ kind: "picks", required: opts.required ?? false });

/** A function's roles by zero-based argument; `rest` covers every argument past the highest numbered one. */
export type ArgRoles = { readonly [i: number]: InputRole; readonly rest?: InputRole };

/** The one declaration: formulas read it by argument, cards point their sockets at it (`rolesFrom`). */
export const ARG_ROLES: Record<string, ArgRoles> = {
  TEXTJOIN: { 0: setting(""), 1: setting(false) },
  XMATCH: { 2: setting(0), 3: setting(0) },
  XLOOKUP: { 4: setting(0), 5: setting(0) },
  INDEX: { 1: picks(), 2: picks() },
  EXPAND: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  TAKE: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  DROP: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  ROUND: { 1: setting(0) },
  ROUNDUP: { 1: setting(0) },
  ROUNDDOWN: { 1: setting(0) },
  CHOOSEROWS: { 1: picks({ required: true }), rest: picks({ required: true }) },
  CHOOSECOLS: { 1: picks({ required: true }), rest: picks({ required: true }) },
  SORT: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  // SORTBY's by_arrays are data; each sort_order after one is a setting.
  SORTBY: Object.fromEntries(Array.from({ length: 127 }, (_, k) => [2 + 2 * k, setting(LEFT_OUT)])),
  UNIQUE: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  VDB: { 5: setting(LEFT_OUT), 6: setting(false) },
  TREND: { 3: setting(LEFT_OUT) },
  GROWTH: { 3: setting(LEFT_OUT) },
  TEXTSPLIT: { 1: required, 2: setting(LEFT_OUT), 3: setting(false), 4: setting(0), 5: setting(LEFT_OUT) },
  TEXTAFTER: { 2: setting(LEFT_OUT), 3: setting(0), 4: setting(0), 5: setting(LEFT_OUT) },
  TEXTBEFORE: { 2: setting(LEFT_OUT), 3: setting(0), 4: setting(0), 5: setting(LEFT_OUT) },
  // The settings sweep ([[D86]] blankRoles): optional settings read a blank as left out, required ones as Excel's
  // typed blank when it works (a blank cumulative is FALSE) and as #SYNTAX! when it doesn't. Distribution parameters
  // are data. Reviewed in docs/settings-audit.md.
  CHOOSE: { 0: required },
  LOG: { 1: setting(LEFT_OUT) },
  TRUNC: { 1: setting(LEFT_OUT) },
  MROUND: { 1: required },
  CEILING: { 1: required },
  FLOOR: { 1: required },
  LARGE: { 1: required },
  SMALL: { 1: required },
  RANK: { 2: setting(LEFT_OUT) },
  PERCENTILE: { 1: required },
  PERCENTRANK: { 2: setting(LEFT_OUT) },
  RANDDIST: { 1: required },
  "NORM.DIST": { 3: setting(false) },
  "NORM.S.DIST": { 1: setting(false) },
  "T.DIST": { 2: setting(false) },
  "CHISQ.DIST": { 2: setting(false) },
  "F.DIST": { 3: setting(false) },
  "BINOM.DIST": { 3: setting(false) },
  "POISSON.DIST": { 2: setting(false) },
  "EXPON.DIST": { 2: setting(false) },
  LEFT: { 1: setting(LEFT_OUT) },
  RIGHT: { 1: setting(LEFT_OUT) },
  MID: { 1: required, 2: required },
  REPLACE: { 1: required, 2: required },
  FIND: { 2: setting(LEFT_OUT) },
  SEARCH: { 2: setting(LEFT_OUT) },
  TEXT: { 1: required },
  REPT: { 1: required },
  DATEDIF: { 2: required },
  WEEKDAY: { 1: setting(LEFT_OUT) },
  WEEKNUM: { 1: setting(LEFT_OUT) },
  YEARFRAC: { 2: setting(LEFT_OUT) },
  PMT: { 4: setting(LEFT_OUT) },
  PV: { 4: setting(LEFT_OUT) },
  FV: { 4: setting(LEFT_OUT) },
  NPER: { 4: setting(LEFT_OUT) },
  RATE: { 4: setting(LEFT_OUT), 5: setting(LEFT_OUT) },
  IPMT: { 5: setting(LEFT_OUT) },
  PPMT: { 5: setting(LEFT_OUT) },
  IRR: { 1: setting(LEFT_OUT) },
  XIRR: { 2: setting(LEFT_OUT) },
  DDB: { 4: setting(LEFT_OUT) },
  CLAMP: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  REGEXEXTRACT: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  COUPDAYBS: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  COUPDAYSNC: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  COUPNUM: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  COUPNCD: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  COUPPCD: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  ACCRINTM: { 4: setting(LEFT_OUT) },
  INTRATE: { 4: setting(LEFT_OUT) },
  RECEIVED: { 4: setting(LEFT_OUT) },
  YIELDDISC: { 4: setting(LEFT_OUT) },
  PRICEMAT: { 5: setting(LEFT_OUT) },
  YIELDMAT: { 5: setting(LEFT_OUT) },
  DURATION: { 4: setting(LEFT_OUT), 5: setting(LEFT_OUT) },
  MDURATION: { 4: setting(LEFT_OUT), 5: setting(LEFT_OUT) },
  PRICE: { 5: setting(LEFT_OUT) },
  YIELD: { 5: setting(LEFT_OUT) },
  ODDFPRICE: { 7: setting(LEFT_OUT) },
  ODDFYIELD: { 7: setting(LEFT_OUT) },
  ODDLPRICE: { 6: setting(LEFT_OUT) },
  ODDLYIELD: { 6: setting(LEFT_OUT) },
  CONVERT: { 1: required, 2: required },
  VALUETOTEXT: { 1: setting(LEFT_OUT) },
  SLUGIFY: { 1: setting(LEFT_OUT) },
  PADTEXT: { 1: required, 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  TRUNCATETEXT: { 1: required, 2: setting(LEFT_OUT) },
  WRAPTEXT: { 1: required },
  SAVGOL: { 1: required, 2: required },
  CAGR: { 1: setting(LEFT_OUT) },
  VOLATILITY: { 1: setting(LEFT_OUT) },
  SHARPE: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  SORTINO: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  DOLLAR: { 1: setting(LEFT_OUT) },
  "RANK.EQ": { 2: setting(LEFT_OUT) },
  "RANK.AVG": { 2: setting(LEFT_OUT) },
  "T.TEST": { 2: required, 3: required },
  "GAMMA.DIST": { 3: setting(false) },
  WRAPROWS: { 1: required, 2: setting(LEFT_OUT) },
  WRAPCOLS: { 1: required, 2: setting(LEFT_OUT) },
  TOCOL: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  TOROW: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  SEQUENCE: { 0: required, 1: setting(LEFT_OUT), 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  RANDARRAY: { 0: setting(LEFT_OUT), 1: setting(LEFT_OUT), 2: setting(LEFT_OUT), 3: setting(LEFT_OUT), 4: setting(LEFT_OUT) },
  FILTER: { 2: setting(LEFT_OUT) },
  MAKEARRAY: { 0: required, 1: required },
  SLICE: { 1: required, 2: setting(LEFT_OUT) },
  NTHELEMENT: { 1: required },
  PADRIGHT: { 1: required },
  PADLEFT: { 1: required },
  SIMILARITY: { 2: setting(LEFT_OUT) },
  FUZZYMATCH: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  SPARKLINE: { 1: setting(LEFT_OUT) },
  COMBINATIONS: { 1: required },
  PERMUTATIONS: { 1: required },
  POLYFIT: { 2: required },
  ISOUTLIER: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  FROMEPOCH: { 1: setting(LEFT_OUT) },
  TOEPOCH: { 1: setting(LEFT_OUT) },
  DATETRUNC: { 1: required, 2: setting(LEFT_OUT) },
  RUNNING: { 2: setting(LEFT_OUT) },
  LINSPACE: { 0: required, 2: required },
  REPEAT: { 1: required },
  GEOMETRIC: { 0: required, 2: required },
  FIBONACCI: { 0: required },
  RANGE: { 0: required, 2: setting(LEFT_OUT) },
  "CEILING.MATH": { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  "FLOOR.MATH": { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  BASE: { 1: required, 2: setting(LEFT_OUT) },
  DECIMAL: { 1: required },
  BESSELI: { 1: setting(0) },
  BESSELJ: { 1: setting(0) },
  BESSELK: { 1: setting(0) },
  BESSELY: { 1: setting(0) },
  BIN2HEX: { 1: setting(LEFT_OUT) },
  BIN2OCT: { 1: setting(LEFT_OUT) },
  DEC2BIN: { 1: setting(LEFT_OUT) },
  DEC2HEX: { 1: setting(LEFT_OUT) },
  DEC2OCT: { 1: setting(LEFT_OUT) },
  HEX2BIN: { 1: setting(LEFT_OUT) },
  HEX2OCT: { 1: setting(LEFT_OUT) },
  OCT2BIN: { 1: setting(LEFT_OUT) },
  OCT2HEX: { 1: setting(LEFT_OUT) },
  GESTEP: { 1: setting(LEFT_OUT) },
  "PERCENTILE.EXC": { 1: required },
  "PERCENTILE.INC": { 1: required },
  "PERCENTRANK.EXC": { 2: setting(LEFT_OUT) },
  "PERCENTRANK.INC": { 2: setting(LEFT_OUT) },
  "BETA.DIST": { 3: setting(false) },
  "HYPGEOM.DIST": { 4: setting(false) },
  "LOGNORM.DIST": { 3: setting(false) },
  "NEGBINOM.DIST": { 3: setting(false) },
  "WEIBULL.DIST": { 3: setting(false) },
  FIXED: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
  DAYS360: { 2: setting(LEFT_OUT) },
  "NETWORKDAYS.INTL": { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  "WORKDAY.INTL": { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  ACCRINT: { 5: required, 6: setting(LEFT_OUT) },
  COUPDAYS: { 2: setting(LEFT_OUT), 3: setting(LEFT_OUT) },
  CUMIPMT: { 5: setting(0) },
  CUMPRINC: { 5: setting(0) },
  DISC: { 4: setting(LEFT_OUT) },
  PRICEDISC: { 4: setting(LEFT_OUT) },
  NETWORKDAYS: { 2: setting(LEFT_OUT) },
  WORKDAY: { 2: setting(LEFT_OUT) },
  EWMA: { 1: required },
  TRAPZ: { 1: setting(LEFT_OUT) },
  MUNIT: { 0: required },
  QUARTILE: { 1: setting(0) },
  "QUARTILE.INC": { 1: setting(0) },
  "QUARTILE.EXC": { 1: required },
  ISCLOSE: { 2: setting(LEFT_OUT) },
  TRIMMEAN: { 1: setting(0) },
  SHIFT: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
};

export function argRole(name: string, i: number): InputRole | undefined {
  const roles = ARG_ROLES[name];
  if (!roles) return undefined;
  if (roles[i]) return roles[i];
  const top = Math.max(...Object.keys(roles).filter((k) => k !== "rest").map(Number));
  return i > top ? roles.rest : undefined;
}

/** A card's sockets, each named for the formula argument it is: `rolesFrom("TAKE", { rows: 1, cols: 2 })`. */
export function rolesFrom(name: string, sockets: Record<string, number>): Record<string, InputRole> {
  const out: Record<string, InputRole> = {};
  for (const [key, i] of Object.entries(sockets)) {
    const role = argRole(name, i);
    if (!role) throw new Error(`rolesFrom: ${name} declares no role for argument ${i}`);
    out[key] = role;
  }
  return out;
}

const noDefault = (label: string): SolError => solError("#SYNTAX!", `${label} is blank, and it has no default`);
const isList = (v: unknown): v is unknown[] => Array.isArray(v);
const isTable = (v: unknown): v is unknown[][] => isList(v) && v.length > 0 && isList(v[0]);

/** A blank setting item reads as the role's blank, at any depth. */
function fillBlanks(v: unknown, blank: unknown): unknown {
  return isList(v) ? v.map((x) => fillBlanks(x, blank)) : (v ?? blank);
}

/**
 * One value read by its role. `label` names the input in an error. Errors pass through untouched; a blank inside a
 * table of positions can't be dropped without breaking the table, so that cell is `#SYNTAX!`.
 */
export function applyRole(role: InputRole, v: unknown, label: string): unknown {
  if (isSolError(v)) return v;
  switch (role.kind) {
    case "setting": return fillBlanks(v, role.blank);
    case "required": return isList(v) ? v.map((x) => applyRole(role, x, label)) : (v ?? noDefault(label));
    case "picks": {
      let out: unknown = v;
      if (isTable(v)) out = v.map((r) => r.map((x) => x ?? solError("#SYNTAX!", `A position in ${label} is blank`)));
      else if (isList(v)) { const kept = v.filter((x) => x != null); out = kept.length ? kept : LEFT_OUT; }
      else if (v == null) out = LEFT_OUT;
      return out === LEFT_OUT && role.required ? noDefault(label) : out;
    }
  }
}

/**
 * A formula's arguments read by their roles. `settled[i]` marks a slot the null rule must not blank the answer on:
 * a slot left empty, or one with a role. A variadic `required` picks group errors only when every one is left out.
 */
export function applyArgRoles(name: string, emptySlots: readonly boolean[], argv: unknown[]): { argv: unknown[]; settled: boolean[] } {
  const settled = [...emptySlots];
  if (!ARG_ROLES[name]) return { argv, settled };
  const label = (i: number) => `${name}: argument ${i + 1}`;
  const out = argv.map((v, i) => {
    const role = argRole(name, i);
    if (!role) return v;
    settled[i] = true;
    return role.kind === "picks" ? applyRole({ ...role, required: false }, v, label(i)) : applyRole(role, v, label(i));
  });
  const group = out.map((_, i) => i).filter((i) => { const r = argRole(name, i); return r?.kind === "picks" && r.required; });
  if (group.length && group.every((i) => out[i] === LEFT_OUT)) out[group[0]] = solError("#SYNTAX!", `${name}: no positions given, and they have no default`);
  return { argv: out, settled };
}
