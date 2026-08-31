import { describe, it, expect } from "vitest";
import { kmeans, pca } from "../../../src/graph/nodes/mlOps";

describe("k-means (k-means++ seeded restarts, lowest inertia)", () => {
  const P = [[1, 1], [1.2, 0.8], [0.8, 1.1], [5, 5], [5.2, 4.9], [4.8, 5.1], [1.1, 1.2]];
  it("finds two obvious clusters, labels 1-based in first-appearance order, exact centers + inertia", () => {
    const r = kmeans(P, 2)!;
    expect(r.labels).toEqual([1, 1, 1, 2, 2, 2, 1]);
    expect(r.centers[0][0]).toBeCloseTo(1.025, 9); expect(r.centers[0][1]).toBeCloseTo(1.025, 9);
    expect(r.centers[1]).toEqual([5, 5]);
    expect(r.inertia).toBeCloseTo(0.275, 9);
    expect(kmeans(P, 2)).toEqual(r); // seeded: the same answer every recalculation
  });
  it("k = n puts every point in its own cluster; bad k is null", () => {
    expect(kmeans(P, 7)!.inertia).toBeCloseTo(0, 12);
    expect(kmeans(P, 0)).toBeNull();
    expect(kmeans(P, 8)).toBeNull();
    expect(kmeans([], 1)).toBeNull();
  });
});

describe("PCA (numpy eigh of the covariance; sklearn / prcomp sign convention)", () => {
  const X = [[2.5, 2.4], [0.5, 0.7], [2.2, 2.9], [1.9, 2.2], [3.1, 3.0], [2.3, 2.7], [2, 1.6], [1, 1.1], [1.5, 1.6], [1.1, 0.9]];
  it("variance, ratio, loadings and scores match numpy", () => {
    const r = pca(X)!;
    expect(r.variance[0]).toBeCloseTo(1.2840277121727837, 9);
    expect(r.variance[1]).toBeCloseTo(0.04908339893832714, 9);
    expect(r.ratio[0]).toBeCloseTo(0.9631813143486462, 9);
    expect(r.loadings[0][0]).toBeCloseTo(0.677873, 5); expect(r.loadings[1][0]).toBeCloseTo(0.735179, 5);
    expect(r.loadings[0][1]).toBeCloseTo(0.735179, 5); expect(r.loadings[1][1]).toBeCloseTo(-0.677873, 5);
    expect(r.scores[0][0]).toBeCloseTo(0.82797, 5); expect(r.scores[0][1]).toBeCloseTo(0.175115, 5);
    expect(r.scores[1][0]).toBeCloseTo(-1.77758, 5);
    expect(r.scores[2][1]).toBeCloseTo(-0.384375, 5);
  });
  it("standardize works off the correlation matrix", () => {
    const r = pca(X, { standardize: true })!;
    expect(r.ratio[0]).toBeCloseTo(0.9629646363461228, 9);
    expect(pca([[1, 2]])).toBeNull();
  });
});

describe("logistic regression (IRLS; references from a numpy IRLS transcription + scipy norm)", () => {
  const x = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4, 4.25, 4.5, 4.75, 5, 5.5];
  const y = [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1];
  it("the hours-studied example: coefficients, Wald SE / z / p, probabilities, log-likelihood", async () => {
    const { logisticFit } = await import("../../../src/graph/nodes/mlOps");
    const f = logisticFit(x.map((v) => [v]), y)!;
    expect(f.converged).toBe(true);
    expect(f.coefficients[0]).toBeCloseTo(-4.077713431087625, 6);
    expect(f.coefficients[1]).toBeCloseTo(1.5046454283733315, 6);
    expect(f.stdErrors[0]).toBeCloseTo(1.7609943141564697, 6);
    expect(f.stdErrors[1]).toBeCloseTo(0.6287208459453852, 6);
    expect(f.z[1]).toBeCloseTo(2.393185207833931, 6);
    expect(f.pValues[0]).toBeCloseTo(0.02058151551245868, 8);
    expect(f.pValues[1]).toBeCloseTo(0.016702807340367887, 8);
    expect(f.probabilities[0]).toBeCloseTo(0.034710335976879586, 8);
    expect(f.logLikelihood).toBeCloseTo(-8.029878464344675, 8);
  });
  it("two features; degenerate designs are null", async () => {
    const { logisticFit } = await import("../../../src/graph/nodes/mlOps");
    const x2 = [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    const f = logisticFit(x.map((v, i) => [v, x2[i]]), y)!;
    expect(f.coefficients[0]).toBeCloseTo(-4.434292614310739, 6);
    expect(f.coefficients[1]).toBeCloseTo(1.5277346065203303, 6);
    expect(f.coefficients[2]).toBeCloseTo(0.5691081986876356, 6);
    expect(logisticFit(x.map((v) => [v]), y.map(() => 1))).toBeNull();
    expect(logisticFit([[1], [2]], [0, 1])).toBeNull();
  });
});
