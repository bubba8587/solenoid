// [[B1]] obsidianBet, [[obsidian-plugin]], [[obsidian-plugin#The guide for agents]]
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { agentGuide, GUIDE_EXAMPLES } from "../../obsidian-plugin/src/agentGuide";
import { PROPERTY_KINDS, validateYaml } from "../../obsidian-plugin/src/yamlValue";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";

describe("the guide for agents", () => {
  it("shows a frame, a cube, a list and a matrix, and names every type", () => {
    const guide = agentGuide("9.9.9");
    for (const k of PROPERTY_KINDS) expect(guide).toContain(`\`${k.id}\``);
    for (const shape of ["list", "matrix", "frame", "cube"]) {
      expect(GUIDE_EXAMPLES.some((e) => PROPERTY_KINDS.find((k) => k.id === e.kind)?.shape === shape)).toBe(true);
    }
  });

  it("gives examples the plugin accepts as their type and Solenoid reads back as that type", () => {
    for (const e of GUIDE_EXAMPLES) {
      const kind = PROPERTY_KINDS.find((k) => k.id === e.kind)!;
      expect(validateYaml(kind, (parse(e.yaml) as Record<string, unknown>)[e.key]), e.kind).toBe(true);
      const read = parseNoteFrontmatter(`---\n${e.yaml}\n---\n`).fields.find((f) => f.key === e.key);
      expect(read?.guessed, e.kind).toBe(e.kind.replace(/^solenoid-/, ""));
    }
  });

  it("says where the current copy lives in a note the user asked for", () => {
    expect(agentGuide("1.0.0", "note")).toContain(".obsidian/plugins/solenoid-properties/AGENTS.md");
    expect(agentGuide("1.0.0")).toContain("rewritten when the plugin updates");
  });
});
