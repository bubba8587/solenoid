// [[C17]] shareImpl, [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { cellToYaml, frameSourceFromYaml } from "../../obsidian-plugin/src/yamlValue";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";

describe("the plugin reads and writes note dates as the app does", () => {
  it("guesses a date column only for text the app reads as a date", () => {
    const pluginType = (v: string) => frameSourceFromYaml([{ d: v }])[0].type;
    expect(pluginType("2024-03-05")).toBe("date");
    expect(pluginType("2024-03-05T10:30")).toBe("date");
    expect(pluginType("2024-03-05 is a Tuesday")).toBe("string");
    expect(pluginType("2024-03-05T10:30:00Z")).toBe("string");
    for (const text of ["2024-03-05", "2024-03-05T10:30", "2024-03-05 is a Tuesday", "2024-03-05T10:30:00Z"]) {
      const app = parseNoteFrontmatter(`---\nt:\n  - d: ${text}\n---\n`).fields[0];
      expect(app.dateColumns?.includes("d") ?? false).toBe(pluginType(text) === "date");
    }
  });

  it("keeps a date's time when it writes a cell", () => {
    expect(cellToYaml("2024-03-05", "date")).toBe("2024-03-05");
    expect(cellToYaml("2024-03-05T10:30", "date")).toBe("2024-03-05T10:30:00");
  });
});
