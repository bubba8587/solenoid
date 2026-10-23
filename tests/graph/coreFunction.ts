// [[D99]] rustIsSpec
// A formula function by name, as a callable on the core (`engine_call`): the body as a formula's call reads its
// arguments, or null where no function goes by that name.
import { callOnCore } from "../../src/graph/coreValues";
import { isFunctionName } from "../../src/graph/excelFunctions";

export function coreFunction(name: string): ((...args: unknown[]) => unknown) | null {
  return isFunctionName(name) ? (...args: unknown[]) => callOnCore(name.toUpperCase(), args) : null;
}
