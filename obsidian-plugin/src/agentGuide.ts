// [[obsidian-plugin]], [[obsidian-plugin#The guide for agents]]
// What an agent needs to write Solenoid data objects (the lists, matrices, frames and cubes this plugin types) into a
// vault's notes, as Markdown. The type table comes from PROPERTY_KINDS and every example is checked against the
// plugin's validator and Solenoid's note reader (agentGuide.test.ts), so the guide can't drift from what the plugin does.
import { PROPERTY_KINDS } from "./yamlValue";

/** The file the plugin writes in its own folder, and the note its command writes. */
export const AGENT_GUIDE_FILE = "AGENTS.md";
export const AGENT_GUIDE_NOTE = "Solenoid data objects (guide for agents).md";

/** One worked example: a property of each kind, as YAML under its key. */
export interface GuideExample {
  kind: string;
  key: string;
  yaml: string;
}

export const GUIDE_EXAMPLES: GuideExample[] = [
  { kind: "solenoid-list", key: "readings", yaml: "readings:\n  - 12.5\n  - 14\n  - 13.25" },
  { kind: "solenoid-strlist", key: "crew", yaml: "crew:\n  - Ana\n  - Ben\n  - Chidi" },
  { kind: "solenoid-datelist", key: "inspections", yaml: "inspections:\n  - 2026-09-01\n  - 2026-10-15" },
  { kind: "solenoid-logicallist", key: "signed_off", yaml: "signed_off:\n  - true\n  - false\n  - true" },
  { kind: "solenoid-complexlist", key: "impedance", yaml: "impedance:\n  - 3+4i\n  - 1-2i" },
  { kind: "solenoid-table", key: "grid", yaml: "grid:\n  - [1, 2, 3]\n  - [4, 5, 6]" },
  { kind: "solenoid-strtable", key: "seating", yaml: "seating:\n  - [Ana, Ben]\n  - [Chidi, Dee]" },
  {
    kind: "solenoid-frame",
    key: "purchases",
    yaml: [
      "purchases:",
      "  - item: Cabinets",
      "    cost: 4200",
      "    ordered: 2026-09-02",
      "    paid: true",
      "  - item: Tile",
      "    cost: 880",
      "    ordered: 2026-09-12",
      "    paid: null",
    ].join("\n"),
  },
  {
    kind: "solenoid-cube",
    key: "phases",
    yaml: [
      "phases:",
      "  - phase: Demolition",
      "    days: 3",
      "    crew: [Ana, Ben]",
      "    tasks:",
      "      - task: Strip cabinets",
      "        hours: 6",
      "      - task: Haul debris",
      "        hours: 4",
      "  - phase: Install",
      "    days: 8",
      "    crew: [Chidi]",
      "    tasks:",
      "      - task: Hang cabinets",
      "        hours: 20",
    ].join("\n"),
  },
  { kind: "solenoid-complex", key: "load", yaml: "load: 3+4i" },
];

const CELLS: Record<string, string> = {
  number: "numbers",
  string: "text",
  date: "ISO dates",
  complex: "`a+bi` text or numbers",
  logical: "`true` / `false`",
};

const shapeYaml = (k: (typeof PROPERTY_KINDS)[number]): string => {
  switch (k.shape) {
    case "scalar": return "`a+bi` text, or a number";
    case "list": return `a sequence of ${CELLS[k.family!]}`;
    case "matrix": return `a sequence of rows, each a sequence of ${CELLS[k.family!]}`;
    case "frame": return "a sequence of `key: value` maps, every value a number, text, a date, a Boolean or `null`";
    case "cube": return "a sequence of maps whose values may also be lists, or sequences of maps";
  }
};

/** The guide, for the plugin `version` it ships with: the copy in the plugin's folder (kept current) or a note the
 *  user asked for (written once). */
export function agentGuide(version: string, copy: "folder" | "note" = "folder"): string {
  const types = PROPERTY_KINDS.map((k) => `| \`${k.id}\` | ${k.name} | ${shapeYaml(k)} |`).join("\n");
  const examples = GUIDE_EXAMPLES.map((e) => {
    const name = PROPERTY_KINDS.find((k) => k.id === e.kind)?.name ?? e.kind;
    return `**${name}** (\`${e.kind}\`):\n\n\`\`\`yaml\n${e.yaml}\n\`\`\``;
  }).join("\n\n");
  const typesJson = GUIDE_EXAMPLES.map((e) => `    "${e.key}": "${e.kind}"`).join(",\n");
  return `# Solenoid data objects: a guide for agents

${copy === "folder"
    ? `Written by Solenoid Properties ${version}, and rewritten when the plugin updates, so edits here don't last.`
    : `Written by Solenoid Properties ${version}. The plugin keeps a current copy in its folder, \`.obsidian/plugins/solenoid-properties/${AGENT_GUIDE_FILE}\`.`}

Solenoid Properties adds Solenoid's data objects to Obsidian's note properties: lists, matrices, frames (tables of
rows) and cubes (tables whose cells may hold lists or more rows), plus complex numbers. In a note each one is plain
YAML in the frontmatter. With the plugin on, Obsidian shows it as a chip that opens Solenoid's table editor, and
Solenoid (the app) reads the same note as the same type: a Note card, Import Obsidian Note and Vault Folder all do.

## Making one

1. Write the value as YAML under a property in the note's frontmatter (the shapes are below).
2. Give the property its type in the vault's \`.obsidian/types.json\`, under \`"types"\`. Obsidian keeps one type per
   property name for the whole vault, and the type is what makes it draw the chip; without one, Obsidian guesses its
   own type and shows the value as text. Keep the file's other entries as they are.

\`\`\`json
{
  "types": {
${typesJson}
  }
}
\`\`\`

## The types

| Type id | Name in Obsidian | YAML |
|---|---|---|
${types}

The five list types and the five matrix types differ only in what their cells hold: Numeric (numbers), String (text),
Date, Complex and Boolean. Keep a matrix's rows one length.

## Examples

${examples}

## The rules a value must follow

- **Dates** are unquoted ISO text, \`2026-09-01\`, or with a time, \`2026-09-01T14:30\`. A quoted date, or a day the
  month doesn't have (\`2026-02-30\`), reads as text.
- **Complex numbers** are \`a+bi\` text (\`3+4i\`, \`1-2i\`, \`5i\`) or a plain number.
- **Booleans** are \`true\` and \`false\`, unquoted.
- **A frame** is a sequence of maps whose values are scalars (a number, text, a date, a Boolean or \`null\`). Give
  every row every key, in the same order, and write a missing cell as \`null\`. A frame column whose every present cell
  is a number, a Boolean or a date takes that type; any other mix is text.
- **A cube** is a frame whose cells may also be a list (\`crew: [Ana, Ben]\`) or a sequence of maps (\`tasks:\` above),
  which is a frame inside the cell, to any depth.
- **One family a list.** A list that mixes numbers and text reads as text in Solenoid. Keep a list to one kind of value.
- **Empty** is \`[]\` for every type but Complex, which is left blank.
- **Keys** are the property names Obsidian shows. Solenoid reads them as written, spaces and case included.

A value that doesn't fit its type isn't lost: Obsidian shows a type warning on the property and the YAML stays as
written. The editor's Save rewrites it into the type's shape.

## Column types

Solenoid types a frame's columns from their cells (above). A person can pick a column's type in the editor; the plugin
keeps those picks in its own \`data.json\`, not in the note, and Solenoid reads them. Don't write \`data.json\` while
Obsidian runs, since the plugin rewrites it. Another plugin records types with
\`app.plugins.getPlugin("solenoid-properties").api.setColumnTypes(key, { column: "number" })\` (the types are
\`number\`, \`string\`, \`date\` and \`logical\`).

## Notes that fill themselves in

A note with \`knap: true\` in its properties renders its body as a template of its own properties, as a Solenoid Note
card does: \`{{ budget }}\` prints the property, \`{% for p in purchases %}{{ p.item }}{% endfor %}\` loops over a
frame's rows, and a bare \`{{ purchases }}\` on a list, matrix, frame or cube property shows its chip in the body.

\`\`\`markdown
---
knap: true
budget: 12000
purchases:
  - item: Cabinets
    cost: 4200
---
Budget: {{ budget }}

{% for p in purchases %}- {{ p.item }}: {{ p.cost }}
{% endfor %}
{{ purchases }}
\`\`\`
`;
}
