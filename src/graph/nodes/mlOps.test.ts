import { describe, it, expect } from "vitest";
import { kmeans, pca } from "./mlOps";

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
