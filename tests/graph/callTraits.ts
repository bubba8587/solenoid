// [[D99]] rustIsSpec
// The core's call table (crates/solenoid-core/data/call_traits.json): each function name's dispatch facts, for tests
// that pin which step of the ladder a name takes.
import * as fs from "node:fs";
import * as path from "node:path";

export interface CallTraits { kind: "handler" | "whole" | "range" | "broadcast"; scalar: boolean[]; resolves: boolean }

const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../crates/solenoid-core/data/call_traits.json"), "utf8")) as Record<string, CallTraits>;

export const callTraits = (name: string): CallTraits | undefined => table[name.toUpperCase()];
/** A range function reads its lists whole (SUM, COUNTIF), where a broadcast one maps over them. */
export const isRange = (name: string): boolean => callTraits(name)?.kind === "range";
/** The range functions with an argument a list lifts in (`RANGE_SCALAR_ARGS`): LARGE's k, PERCENTILE's p. */
export const liftsAScalar = (name: string): boolean => callTraits(name)?.scalar.some(Boolean) ?? false;
export const callTraitNames = (): string[] => Object.keys(table);
