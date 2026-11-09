// Deletes the imports, helpers and locals left unused in the given files, with TypeScript's own fix ("Delete all
// unused declarations"), after a cut such as scripts/answer-tests.mjs makes. TypeScript isn't a dependency (the app
// type-checks with tsrs): it is installed for the run and not saved.
//   npm i --no-save typescript && node scripts/fix-unused.mjs <files>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");
const files = process.argv.slice(2).map((f) => path.resolve(f));
const config = ts.getParsedCommandLineOfConfigFile(path.resolve("tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const versions = new Map();
const host = {
  getScriptFileNames: () => [...new Set([...config.fileNames, ...files])],
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : undefined),
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => ({ ...config.options, noUnusedLocals: true, noUnusedParameters: false }),
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host);
let changed = 0;
for (const file of files) {
  // A deletion can leave something else unused, so run the fix until it finds nothing more.
  for (let round = 0; round < 10; round++) {
    let edits = [];
    for (const id of ["unusedIdentifier_deleteImports", "unusedIdentifier_delete"]) {
      const fix = service.getCombinedCodeFix({ type: "file", fileName: file }, id, {}, {});
      edits = fix.changes.filter((c) => c.fileName === file).flatMap((c) => c.textChanges);
      if (edits.length) break;
    }
    // What has no fix-all (an unused destructuring): the fix TypeScript offers for each remaining diagnostic, one at a time.
    if (!edits.length) {
      const UNUSED = [6133, 6192, 6196, 6198, 6199, 6205];
      const d = service.getSemanticDiagnostics(file).concat(service.getSuggestionDiagnostics(file)).find((x) => UNUSED.includes(x.code));
      if (d) {
        const fixes = service.getCodeFixesAtPosition(file, d.start, d.start + d.length, [d.code], {}, {});
        const del = fixes.find((x) => x.fixName === "unusedIdentifier" && /^(Remove|Delete)/.test(x.description)) ?? fixes[0];
        edits = del ? del.changes.filter((c) => c.fileName === file).flatMap((c) => c.textChanges) : [];
      }
    }
    if (!edits.length) break;
    let text = fs.readFileSync(file, "utf8");
    for (const e of edits.sort((a, b) => b.span.start - a.span.start)) {
      text = text.slice(0, e.span.start) + e.newText + text.slice(e.span.start + e.span.length);
    }
    fs.writeFileSync(file, text);
    versions.set(file, (versions.get(file) ?? 0) + 1);
    changed++;
  }
}
console.log(`${changed} fix rounds over ${files.length} files`);
