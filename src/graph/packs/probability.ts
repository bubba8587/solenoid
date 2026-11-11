// [[B15]] leanCore, [[C79]] packActivationIsPresentation; tree/specs/computation/probability-pack.md
import type { Pack } from "./packShared";
import { NEXT_RELEASE } from "../release";
import { ProbabilityBetweenNode, AbTestNode, BootstrapNode } from "../nodeClasses";

// Catalog type strings must not change: saves and formula names key on them.
const PATH = ["Packs", "Probability"];

export const PROBABILITY_PACK: Pack = {
  id: "probability",
  seed: "pack-probability",
  name: "Probability",
  description: "Probability Between, A/B Test and Bootstrap, each drawing the distribution behind its answer.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: {
      type: "prob-between", added: NEXT_RELEASE, label: "Probability Between",
      description: "The chance a value lands between two numbers, shaded on the distribution's curve. Drag the handles or type the ends. Excel: `NORM.DIST` at each end, subtracted.",
      create: () => new ProbabilityBetweenNode(), parity: false,
      keywords: "probability between range interval area under curve shade normal bell tail chance odds likelihood cdf",
    } },
    { path: PATH, entry: {
      type: "ab-test", added: NEXT_RELEASE, label: "A/B Test",
      description: "Visitors and conversions for two versions give the chance B beats A, and how much better B is with its likely range. Bayesian, from a flat prior.",
      create: () => new AbTestNode(), parity: false,
      keywords: "ab test a/b split test experiment conversion rate bayesian beta posterior chance to beat lift variant control",
    } },
    { path: PATH, entry: {
      type: "bootstrap", added: NEXT_RELEASE, label: "Bootstrap",
      description: "How far a mean, median or standard deviation could be off: the middle 95% of it across thousands of resamples of the values. R `boot`, scipy `bootstrap`.",
      create: () => new BootstrapNode(), parity: false,
      keywords: "bootstrap resample resampling confidence interval uncertainty error bars margin of error mean median standard deviation",
    } },
  ],
};
