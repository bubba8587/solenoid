// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PROPERTY_KINDS } from "../../obsidian-plugin/src/yamlValue";

const spec = readFileSync("specs/obsidian-plugin.md", "utf8");
const config = readFileSync("obsidian-plugin/vite.config.ts", "utf8");

describe("specs/obsidian-plugin.md states what the plugin is built from", () => {
  it("names every shimmed app module, and every shim is in the build's map", () => {
    for (const file of readdirSync("obsidian-plugin/src/shims")) {
      const name = file.replace(/\.ts$/, "");
      if (name === "reactDom") continue; // the portal redirect: requirement 5, not a module swap
      expect(spec, `the spec's requirement 2 lists \`${name}\``).toContain(`\`${name}\``);
      expect(config, `SHIMMED maps ${file}`).toContain(`"${file}"`);
    }
  });

  it("lists every property type id", () => {
    for (const kind of PROPERTY_KINDS) {
      const suffix = kind.id.replace(/^solenoid/, "");
      expect(spec.includes(`\`${kind.id}\``) || spec.includes(`\`${suffix}\``), kind.id).toBe(true);
    }
  });
});
