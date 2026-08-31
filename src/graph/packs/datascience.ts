import type { Pack } from "./packShared";

// Re-homes the R/sklearn-shaped tools out of the base Add menu. Tags only — every
// node stays registered and saved graphs load with the pack off. The mainstream
// tests (z, t, F, chi-squared, ANOVA, proportion, binomial) stay core.
export const DATA_SCIENCE_PACK: Pack = {
  id: "datascience",
  name: "Data Science",
  description: "Machine learning and nonparametric statistics: K-Means, PCA, logistic regression, and the Kruskal-Wallis, Mann-Whitney, Wilcoxon, Fisher exact, and Kolmogorov-Smirnov tests.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  tags: [
    "kmeans", "pca", "logistic",
    "kruskal-test", "mannwhitney-test", "wilcoxon-test",
    "fisher-exact-test", "ks-test",
  ],
};
