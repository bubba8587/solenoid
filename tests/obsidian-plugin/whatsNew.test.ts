// [[B1]] obsidianBet, [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]], [[obsidian-plugin#What's new]]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { whatsNewDue, readSeenWhatsNew, compareVersions } from "../../obsidian-plugin/src/whatsNew";
import { PLUGIN_NOTES } from "../../obsidian-plugin/src/pluginNotes";

const now = { plugin: "0.1.7", app: "1.6" };

describe("the What's New tab", () => {
  it("opens on a fresh install, a new plugin version and a new app deck", () => {
    expect(whatsNewDue(undefined, now)).toBe(true);
    expect(whatsNewDue({ plugin: "0.1.6", app: "1.6" }, now)).toBe(true);
    expect(whatsNewDue({ plugin: "0.1.7", app: "1.5" }, now)).toBe(true);
  });

  it("stays shut on an unchanged start", () => {
    expect(whatsNewDue({ ...now }, now)).toBe(false);
  });

  it("reads only a well-formed record from data.json, so a damaged one counts as a fresh install", () => {
    expect(readSeenWhatsNew({ plugin: "0.1.6", app: "1.6" })).toEqual({ plugin: "0.1.6", app: "1.6" });
    expect(readSeenWhatsNew({ plugin: 1, app: "1.6" })).toBeUndefined();
    expect(readSeenWhatsNew(null)).toBeUndefined();
  });

  it("has notes for the manifest's version or a later draft, newest first", () => {
    const manifest = JSON.parse(readFileSync("obsidian-plugin/manifest.json", "utf8")) as { version: string };
    expect(compareVersions(PLUGIN_NOTES[0].version, manifest.version)).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < PLUGIN_NOTES.length; i++) expect(compareVersions(PLUGIN_NOTES[i - 1].version, PLUGIN_NOTES[i].version)).toBeGreaterThan(0);
  });

  it("carries no em dash in its copy", () => {
    for (const { notes } of PLUGIN_NOTES) for (const n of notes) expect(`${n.title} ${n.body}`).not.toMatch(/—/);
  });
});
