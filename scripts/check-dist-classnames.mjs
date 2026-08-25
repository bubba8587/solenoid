import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "dist/assets";
const NEEDLES = ["XMatchNode", "ListIndexNode"];

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`check-dist-classnames: ${DIR} not found — run a build first.`);
  process.exit(1);
}

const blob = files.map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
const missing = NEEDLES.filter((n) => !blob.includes(n));

if (missing.length) {
  console.error(
    `check-dist-classnames: FAIL — class name(s) not found in ${DIR}: ${missing.join(", ")}.\n` +
    `The minifier mangled class names. A production save's \`type\` (constructor.name) becomes\n` +
    `unopenable single letters. Fix vite.config's minifier/keepNames before shipping.`,
  );
  process.exit(1);
}

console.log(`check-dist-classnames: OK — ${NEEDLES.join(", ")} present in ${files.length} bundle file(s).`);
