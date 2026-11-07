// The Text family's harvest decisions (scripts/function-records/build.ts).
import type { Plan } from "../harvest.ts";

export const plan: Omit<Plan, "family" | "functions" | "sources"> = {
  envs: {},
  files: {},
  dispositions: {},
};
