// [[B18]] safeToShare, [[engineering#Content entering or leaving the app is guarded where it crosses]], docs/self-hosting.md
// A hosted copy's solenoid.config.json: the hosts it vouches for skip the network prompt, and nothing else does.
import { afterEach, describe, expect, it } from "vitest";
import {
  parseDeploymentConfig, setDeploymentConfig, isTrustedSource, loadDeploymentConfig, deploymentConfig,
} from "../../src/graph/deploymentConfig";
import { requestNetwork, connectionStore } from "../../src/graph/connectionStore";
import { docMetaStore } from "../../src/graph/docMetaStore";

afterEach(() => setDeploymentConfig({ trustedSources: [] }));

describe("solenoid.config.json", () => {
  it("keeps only well-formed host names, lowercased", () => {
    expect(parseDeploymentConfig({ trustedSources: ["Portal.Company.com", ".company.com", "files:8443", "https://x.com/", "*.evil.com", 7, ""] }))
      .toEqual({ trustedSources: ["portal.company.com", ".company.com", "files:8443"] });
    expect(parseDeploymentConfig(null)).toEqual({ trustedSources: [] });
    expect(parseDeploymentConfig({ trustedSources: "portal.company.com" })).toEqual({ trustedSources: [] });
  });

  it("loads from beside the page, and a missing or non-JSON file leaves it empty", async () => {
    const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    await loadDeploymentConfig(answer({ trustedSources: ["portal.company.com"] }));
    expect(deploymentConfig().trustedSources).toEqual(["portal.company.com"]);
    setDeploymentConfig({ trustedSources: [] });
    await loadDeploymentConfig(answer({}, false));
    expect(deploymentConfig().trustedSources).toEqual([]);
    await loadDeploymentConfig((async () => ({ ok: true, json: async () => { throw new SyntaxError("<!doctype html>"); } })) as unknown as typeof fetch);
    expect(deploymentConfig().trustedSources).toEqual([]);
  });
});

describe("a trusted source", () => {
  it("matches a host exactly, a dotted entry its subdomains too, and a port when one is named", () => {
    setDeploymentConfig(parseDeploymentConfig({ trustedSources: ["portal.company.com", ".sharepoint.company.com", "files.company.com:8443"] }));
    expect(isTrustedSource("https://portal.company.com/data/q3.xlsx")).toBe(true);
    expect(isTrustedSource("https://evilportal.company.com/x")).toBe(false);
    expect(isTrustedSource("https://portal.company.com.evil.net/x")).toBe(false);
    expect(isTrustedSource("https://sharepoint.company.com/x")).toBe(true);
    expect(isTrustedSource("https://team.sharepoint.company.com/x")).toBe(true);
    expect(isTrustedSource("https://files.company.com:8443/a.csv")).toBe(true);
    expect(isTrustedSource("https://files.company.com/a.csv")).toBe(false);
    // An entry naming a scheme's own port matches an address that leaves it out, and no other port.
    setDeploymentConfig(parseDeploymentConfig({ trustedSources: ["data.company.com:443"] }));
    expect(isTrustedSource("https://data.company.com/a.csv")).toBe(true);
    expect(isTrustedSource("https://data.company.com:443/a.csv")).toBe(true);
    expect(isTrustedSource("http://data.company.com/a.csv")).toBe(false);
    expect(isTrustedSource("https://data.company.com:8443/a.csv")).toBe(false);
    setDeploymentConfig(parseDeploymentConfig({ trustedSources: ["portal.company.com", ".sharepoint.company.com", "files.company.com:8443"] }));
    expect(isTrustedSource("ftp://portal.company.com/x")).toBe(false);
    expect(isTrustedSource("not a url")).toBe(false);
  });

  it("is nothing at all with no config", () => {
    expect(isTrustedSource("https://portal.company.com/x")).toBe(false);
  });

  it("lets a card in someone else's document fetch from it without the prompt, and only from it", () => {
    docMetaStore.setDocMeta({ foreign: true });
    try {
      setDeploymentConfig(parseDeploymentConfig({ trustedSources: ["portal.company.com"] }));
      expect(requestNetwork("card-a", undefined, "https://portal.company.com/q3.csv")).toBe(true);
      expect(requestNetwork("card-b", undefined, "https://elsewhere.example/q3.csv")).toBe(false);
      expect(connectionStore.getState("card-b").status).toBe("gated");
      expect(requestNetwork("card-c")).toBe(false);
    } finally {
      docMetaStore.setDocMeta({});
    }
  });
});
