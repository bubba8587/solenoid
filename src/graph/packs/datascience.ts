import type { Pack, PackPlacement } from "./packShared";
import {
  KMeansNode, PcaNode, LogisticNode,
  HypothesisTestNode, HYPOTHESIS_TEST_OP_META, type HypothesisTestOp,
} from "../rete-nodes";

// The R/sklearn-shaped tools, out of the base Add menu: real placements under
// Packs › Data Science, so enabling the pack shows exactly what it added. The
// mainstream tests (z, t, F, chi-squared, ANOVA, proportion, binomial) stay core.
// Catalog type strings are historical and must not change (saves + formula names).
const PATH = ["Packs", "Data Science"];

// Test entries pull label + description from the node's own op meta so the card
// and the menu can't drift; the type strings keep their historical spellings.
const testEntry = (op: HypothesisTestOp, type: string, keywords: string): PackPlacement => ({
  path: PATH,
  entry: {
    type,
    label: HYPOTHESIS_TEST_OP_META[op].label,
    description: HYPOTHESIS_TEST_OP_META[op].description,
    keywords: `hypothesis test ${keywords}`,
    parity: false,
    create: () => new HypothesisTestNode({ op }),
  },
});

export const DATA_SCIENCE_PACK: Pack = {
  id: "datascience",
  name: "Data Science",
  description: "Machine learning and nonparametric statistics: K-Means, PCA, logistic regression, and the Kruskal-Wallis, Mann-Whitney, Wilcoxon, Fisher exact, and Kolmogorov-Smirnov tests.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: { type: "kmeans", label: "K-Means", description: "Groups the rows into k clusters by their number columns (k-means++ seeding, the best of ten runs): a cluster id per row and a centers frame. sklearn `KMeans`, R `kmeans`.", create: () => new KMeansNode(), parity: false, keywords: "kmeans k-means cluster clustering segment centroid unsupervised group rows" } },
    { path: PATH, entry: { type: "pca", label: "PCA", description: "Principal components of the number columns: the rows in the new axes (scores), how each feature loads on each axis, and the share of variance each axis explains, centered or standardized first. sklearn `PCA`, R `prcomp`.", create: () => new PcaNode(), parity: false, keywords: "pca principal component analysis dimensionality reduction loadings scores explained variance prcomp eigen" } },
    { path: PATH, entry: { type: "logistic", label: "Logistic Regression", description: "Fits a 0/1 target on the other number columns: log-odds coefficients with standard errors, z and p, plus the fitted probability per row. Unregularized maximum likelihood (IRLS). R `glm(binomial)`, statsmodels `Logit`.", create: () => new LogisticNode(), parity: false, keywords: "logistic regression logit glm binomial classification probability odds ratio irls sigmoid" } },
    testEntry("kruskal", "kruskal-test", "kruskal wallis nonparametric anova ranks"),
    testEntry("mannwhitney", "mannwhitney-test", "mann whitney wilcoxon rank sum nonparametric u test"),
    testEntry("wilcoxon", "wilcoxon-test", "wilcoxon signed rank paired nonparametric"),
    testEntry("fisher", "fisher-exact-test", "fisher exact 2x2 contingency small sample"),
    testEntry("ks", "ks-test", "kolmogorov smirnov ks distribution two sample"),
  ],
};
