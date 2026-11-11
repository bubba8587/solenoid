// [[C26]] opArgDistinct
// The values each card's settings take, read off the TypeScript types: a class field typed as a union of text
// literals (`how: JoinHow`, `dir: "asc" | "desc"`) can hold only those, so the validator refuses anything else and the
// AI grounding lists them. Writes src/graph/settingChoices.json; `settingChoices.test.ts` fails when it is stale.
//   node scripts/setting-choices.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "src/graph/nodeClasses.ts");
export const OUT = path.join(ROOT, "src/graph/settingChoices.json");

/** `{ ClassName: { field: [values…] } }` for every class `nodeClasses.ts` exports, fields and classes sorted. */
export function settingChoices() {
  const cfg = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile).config;
  const { options } = ts.convertCompilerOptionsFromJson({ ...cfg.compilerOptions, noEmit: true }, ROOT);
  const program = ts.createProgram([ENTRY], options);
  const checker = program.getTypeChecker();
  const entry = checker.getSymbolAtLocation(program.getSourceFile(ENTRY));
  const out = {};
  for (const exported of checker.getExportsOfModule(entry)) {
    const sym = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = sym.valueDeclaration;
    if (!decl || !ts.isClassDeclaration(decl)) continue;
    const fields = {};
    for (const prop of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(sym))) {
      const at = prop.valueDeclaration;
      if (!at || !ts.isPropertyDeclaration(at) || at.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      const type = checker.getTypeOfSymbolAtLocation(prop, at);
      const parts = type.isUnion() ? type.types : [type];
      // Every member a text literal, and more than one of them: a free-text field or a lone literal is no choice.
      if (parts.length < 2 || !parts.every((p) => p.isStringLiteral())) continue;
      // Sorted: the checker's own order follows which file it read first.
      fields[prop.name] = parts.map((p) => p.value).sort();
    }
    if (Object.keys(fields).length) out[sym.name] = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export const render = (choices) => JSON.stringify(choices, null, 1) + "\n";

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const text = render(settingChoices());
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== text) { console.error("src/graph/settingChoices.json is stale: run node scripts/setting-choices.mjs"); process.exit(1); }
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  }
}
