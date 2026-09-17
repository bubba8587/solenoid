import { describe, it, expect, afterEach } from "vitest";
import {
  DEMO_VAULT_ROOT,
  isDemoVaultPath,
  getVaultRoot,
  getCsvFolder,
  forceDemoVault,
  demoVaultFs,
} from "../../src/graph/demoVault";
import { settingsStore } from "../../src/graph/settingsStore";
import { LocalFileNode } from "../../src/graph/nodes/connection";
import { isFrameValue, type FrameValue } from "../../src/graph/frame";

// The bundled read-only demo vault seam: the sentinel root, the resolver (setting +
// force override), and the in-memory FsProvider read against the real demo-vault files.

const R = DEMO_VAULT_ROOT;
const p = (rel: string) => `${R}/${rel}`;

describe("isDemoVaultPath", () => {
  it("matches the sentinel root and anything under it", () => {
    expect(isDemoVaultPath(R)).toBe(true);
    expect(isDemoVaultPath(p("Notes/Deep Work.md"))).toBe(true);
  });
  it("rejects other paths and nullish", () => {
    expect(isDemoVaultPath("C:/vault")).toBe(false);
    expect(isDemoVaultPath("solenoid:demo-vault-evil/x")).toBe(false); // not a path boundary
    expect(isDemoVaultPath("")).toBe(false);
    expect(isDemoVaultPath(null)).toBe(false);
    expect(isDemoVaultPath(undefined)).toBe(false);
  });
});

describe("getVaultRoot / getCsvFolder / forceDemoVault", () => {
  afterEach(() => {
    forceDemoVault(false);
    settingsStore.set("useDemoVault", false);
    settingsStore.set("obsidianVault", "");
    settingsStore.set("csvFolder", "");
  });

  it("the force wins over the settings and pins both root and data folder", () => {
    settingsStore.set("obsidianVault", "C:/real");
    settingsStore.set("csvFolder", "C:/data");
    forceDemoVault(true);
    expect(getVaultRoot()).toBe(R);
    expect(getCsvFolder()).toBe(`${R}/Data`);
    forceDemoVault(false);
    expect(getVaultRoot()).toBe("C:/real");
    expect(getCsvFolder()).toBe("C:/data");
  });

  it("a configured folder always wins; the demo is the fallback only while the setting allows it ([[D62]] demoVaultResolution)", () => {
    settingsStore.set("obsidianVault", "C:/real");
    settingsStore.set("useDemoVault", true);
    expect(getVaultRoot()).toBe("C:/real");
    settingsStore.set("obsidianVault", "");
    expect(getVaultRoot()).toBe(R);
    settingsStore.set("useDemoVault", false);
    expect(getVaultRoot()).toBe("");
  });
});

describe("demoVaultFs — reads against the bundled files", () => {
  it("readDir on the root lists the top-level folders and files", async () => {
    const entries = await demoVaultFs.readDir(R);
    const dirs = entries.filter((e) => e.isDirectory).map((e) => e.name);
    const files = entries.filter((e) => e.isFile).map((e) => e.name);
    expect(dirs).toEqual(expect.arrayContaining(["Notes", "Projects", "Daily"]));
    expect(files).toContain("README.md");
  });

  it("readDir on a subfolder lists its notes, not nested ones", async () => {
    const names = (await demoVaultFs.readDir(p("Notes"))).map((e) => e.name);
    expect(names).toContain("Deep Work.md");
    expect(names).not.toContain("Notes"); // no self, no parent
  });

  it("exists is true for the root, a file and a folder; false for a miss", async () => {
    expect(await demoVaultFs.exists(R)).toBe(true);
    expect(await demoVaultFs.exists(p("Notes/Deep Work.md"))).toBe(true);
    expect(await demoVaultFs.exists(p("Notes"))).toBe(true);
    expect(await demoVaultFs.exists(p("Notes/Nope.md"))).toBe(false);
  });

  it("readTextFile returns a note's content; a miss throws", async () => {
    const text = await demoVaultFs.readTextFile(p("Notes/Deep Work.md"));
    expect(text).toContain("rating:");
    await expect(demoVaultFs.readTextFile(p("Notes/Nope.md"))).rejects.toThrow();
  });

  it("join and dirname do POSIX path math", async () => {
    expect(await demoVaultFs.join(R, "Notes", "Deep Work.md")).toBe(p("Notes/Deep Work.md"));
    expect(await demoVaultFs.join(R, "", "Notes")).toBe(p("Notes"));
    expect(await demoVaultFs.dirname(p("Notes/Deep Work.md"))).toBe(p("Notes"));
  });

  it("is read-only: every writer throws", async () => {
    await expect(demoVaultFs.writeTextFile(p("x.md"), "y")).rejects.toThrow();
    await expect(demoVaultFs.mkdir(p("x"), true)).rejects.toThrow();
    await expect(demoVaultFs.rename(p("a"), p("b"))).rejects.toThrow();
    await expect(demoVaultFs.readBinary(p("x"))).rejects.toThrow();
  });

  it("stat carries no timestamps (the bundle has none)", async () => {
    expect(await demoVaultFs.stat(p("Notes/Deep Work.md"))).toEqual({ mtimeMs: null, birthtimeMs: null });
  });
});

describe("Local File over the demo seam (works without desktop)", () => {
  afterEach(() => forceDemoVault(false));

  it("reads a bundled CSV as a typed frame", async () => {
    forceDemoVault(true);
    const node = new LocalFileNode({ label: "expenses.csv", fileName: "expenses.csv" });
    const { frame } = await node.data();
    expect(isFrameValue(frame)).toBe(true);
    const f = frame as FrameValue;
    expect(f.columns.map((c) => c.name)).toEqual(["date", "category", "vendor", "amount"]);
    expect(f.columns[0].values.length).toBe(6);
  });
});
