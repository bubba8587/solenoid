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
  TEXTJOIN: { 1: setting(false) },
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
  TEXTSPLIT: { 2: setting(LEFT_OUT), 3: setting(false), 4: setting(0), 5: setting(LEFT_OUT) },
  TEXTAFTER: { 2: setting(LEFT_OUT), 3: setting(0), 4: setting(0), 5: setting(LEFT_OUT) },
  TEXTBEFORE: { 2: setting(LEFT_OUT), 3: setting(0), 4: setting(0), 5: setting(LEFT_OUT) },
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
