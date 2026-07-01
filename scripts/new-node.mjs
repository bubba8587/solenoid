#!/usr/bin/env node
// Scaffold a new Solenoid node. Generates the React component file (a
// one-line makeNodeComponent factory call thanks to the node kit) and prints
// the three snippets you paste by hand — the class, the component-registry
// row, and the Add-menu catalog entry — because those land in specific
// spots / categories that a script shouldn't guess.
//
// Usage:
//   node scripts/new-node.mjs <PascalName> [--template element|list|reduce] [--kind math|list|logic|...]
//
// Examples:
//   node scripts/new-node.mjs Square                 # element-wise (numlist → broadcast)
//   node scripts/new-node.mjs Dedupe --template list # list → list
//   node scripts/new-node.mjs Range2 --template reduce --kind list

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const template = flag("template", "element"); // element | list | reduce
const kind = flag("kind", "math");

if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
  console.error("Provide a PascalCase node name, e.g. `node scripts/new-node.mjs Square`");
  process.exit(1);
}

const Klass = `${name}Node`;
const Comp = `${name}Component`;
const upper = name.toUpperCase();

// ── Component file (the templated, low-value-to-handwrite part) ──────────────
// A standard "inputs + value box" node is a one-line factory call. Nodes that
// need an op <select>, a custom value render, or local state hand-write their
// component against NodeShell instead (see e.g. ArithmeticNode, ContainsNode).
const cachedField = template === "list" ? "cachedList" : "cachedResult";

const componentSrc = `import type { ${Klass} } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ${Comp} = makeNodeComponent<${Klass}>((n) => n.${cachedField});
`;

const compPath = join(root, "src", "graph", "components", `${name}Node.tsx`);
if (existsSync(compPath)) {
  console.error(`Refusing to overwrite existing ${compPath}`);
  process.exit(1);
}
mkdirSync(dirname(compPath), { recursive: true });
writeFileSync(compPath, componentSrc);

// ── Class stub (paste into src/graph/rete-nodes.ts) ──────────────────────────
const classByTemplate = {
  element: `export class ${Klass} extends ClassicPreset.Node {
  label: string;
  cachedResult: number | number[] | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 160;

  constructor(init?: { label?: string }) {
    super("${name}");
    this.label = init?.label ?? "${upper}";
    this.addInput("x", numListIn("X"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { x?: (number | number[])[] }) {
    const x = inputs.x?.[0] ?? this.literals.x ?? 0;
    const result = broadcast((v) => v /* TODO: op */, x);
    this.cachedResult = result;
    return { result };
  }
}`,
  list: `export class ${Klass} extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("${name}");
    this.label = init?.label ?? "${upper}";
    this.addInput("list", listIn("List"));
    this.addOutput("result", listOut("Result"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? [];
    const result = [...arr]; // TODO: transform
    this.cachedList = result;
    return { result };
  }
}`,
  reduce: `export class ${Klass} extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("${name}");
    this.label = init?.label ?? "${upper}";
    this.addInput("list", listIn("List"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? null;
    this.cachedResult = arr ? arr.length /* TODO: aggregate */ : null;
    return { result: this.cachedResult };
  }
}`,
};

const accent = kind === "math" ? "" : `, accent: NODE_KIND_ACCENTS.${kind}`;

console.log(`
✓ Wrote src/graph/components/${name}Node.tsx

Now wire it up (paste points):

1) src/graph/nodes/<domain>.ts — add the class (scalar/list/stats/finance/logic/display/…):

${classByTemplate[template] ?? classByTemplate.element}

   (rete-nodes.ts already re-exports each domain file, so no change needed there.)

2) src/graph/nodes/kind.ts — add instanceof branch in nodeKindOf():

   if (node instanceof ${Klass}) return "${kind}";

   (Skip this step if kind is "math" — that's the fallback.)

3) src/graph/components/index.ts — add one barrel line:

   export { ${Comp} } from "./${name}Node";

4) src/graph/nodeRegistry.ts — registry row (two edits in this one file):

   import { ${Klass} } from "./rete-nodes";      // add to the rete-nodes import block
   import { ${Comp} } from "./components";       // add to the components import block

   // in NODE_COMPONENTS:
   [${Klass}, comp(${Comp})],

5) src/graph/nodeCatalog.ts — Add-menu catalog entry (pick a category):

   { type: "${name.toLowerCase()}", label: "${upper}", description: "TODO   (Excel: =…)"${accent}, create: () => new ${Klass}() },

6) src/graph/nodeExcel.ts — IF this node is an Excel function, declare it (this is
   the ONLY place; EXCEL_TO_CATALOG / CATALOG_TO_EXCEL and the Function Reference
   all derive from it). Omit for a Solenoid-native node.

   "${name.toLowerCase()}": [{ excel: "${upper}", syntax: "=${upper}(…)" }],
   //   add parity: false + note: "…" if it differs from Excel.

   (A pack node declares this inline as \`excel: [...]\` on its catalog entry
   instead. The dev catalog validator warns if metadata points at a missing node.)

Then: npm run build   (the validator runs in dev; it will flag a missing mapping)
`);
