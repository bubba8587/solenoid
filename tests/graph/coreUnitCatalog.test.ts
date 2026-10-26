// [[C25]] firstClassUnits, [[D99]] rustIsSpec
// Every display unit id the app can name, as `fcUnitToUnit` resolves it, frozen for the core's catalog
// (`crates/solenoid-core/src/unit_catalog.rs`, held to these by its `tests/unit_catalog.rs`).
import { isDeepStrictEqual } from "node:util";
import { it, expect } from "vitest";
import { frozen } from "./coreFixtures";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { UNIT_ANNOTATIONS } from "../../src/graph/formatAnnotationStore";
import { CONVERT_UNIT_DEFS } from "../../src/graph/nodes/convertUnits";
import { FX_CURRENCIES } from "../../src/graph/fxProvider";

const PARSED = ["km/h", "m/s2", "m^2", "m^-1", "kg·m/s2", "kg*m^2/s^3", "N·m", "kN", "MPa", "kWh", "mL", "dL", "daL", "µs", "us",
  "ms", "Mbyte", "kbyte", "GHz", "mm2", "cm3", "dam", "hPa", "%", "1", "1/s", "m/s/s", "m^0.5", "degC", "kdegC", "x", "", " m ", "m**2", "L", "l", "kl"];

it("the catalog's ids resolve as frozen", () => {
  const ids = new Set<string>([...UNIT_ANNOTATIONS.map((u) => u.id), ...Object.keys(CONVERT_UNIT_DEFS), ...FX_CURRENCIES.map((c) => c.code.toLowerCase()), ...PARSED]);
  for (const id of [...ids]) { ids.add(`${id}2`); ids.add(`${id}3`); }
  const fresh = [...ids].map((id) => ({ id, unit: fcUnitToUnit(id) }));
  const cases = frozen("unit-catalog", () => fresh);
  expect(cases.length).toBeGreaterThan(200);
  const now = new Map(fresh.map((c) => [c.id, c.unit]));
  expect(cases.filter((c) => !isDeepStrictEqual(c.unit, now.get(c.id) ?? null)).map((c) => c.id)).toEqual([]);
});
