import { measureParity, excelNamedGapNames } from "../src/graph/formulaNodeParity";
const m = measureParity();
const fmt = (xs: string[]) => xs.map((x) => `  "${x}",`).join("\n");
console.log("=== GAP A NAMES (" + excelNamedGapNames(m).length + ") ===");
console.log(fmt(excelNamedGapNames(m)));
console.log("=== GAP C UNTRACKED (" + m.untracked.length + ") ===");
console.log(fmt([...m.untracked].sort()));
