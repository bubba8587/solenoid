// Files that hold no case for any family: every family's harvest reads these reasons (scripts/function-records/build.ts).
import type { Plan } from "../harvest.ts";

export const plan: Pick<Plan, "files"> = {
  files: {
    "tests/graph/fixtures/excelNames.ts": "a list of Formula.js's function names, no answers",
    "tests/graph/fixtures/excelArity.ts": "Excel's argument counts per function, which the arity check reads; no answers",
    "tests/graph/groupPushCore.test.ts": "canvas layout, no function answers",
    "tests/graph/tidyArrangeGroups.test.ts": "canvas layout, no function answers",
    "tests/graph/layoutTidyIntegration.test.ts": "canvas layout, no function answers",
    "tests/graph/hicCableGeom.test.ts": "cable geometry, no function answers",
    "tree/specs/canvas/auto-arrange-tidy.md": "canvas layout, no function answers",
    "tests/graph/passBench.test.ts": "a benchmark of card chains; it times, it answers nothing",
    "tests/graph/cardBatchBench.test.ts": "a benchmark of card bodies; it times, it answers nothing",
    "tests/graph/formulaLayout.test.ts": "formula text laid out for display, never evaluated",
  },
};
