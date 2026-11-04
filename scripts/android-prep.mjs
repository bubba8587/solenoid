// Readies the Android project `tauri android init` generates (src-tauri/gen/android) with what Solenoid needs beyond
// Tauri's template (docs/android.md): its folder plugin (`src-tauri/android/SafPlugin.kt`, copied into the app's own
// package, where `saf.rs` registers it), and plain http in a release build too (the template allows it only in debug),
// for an image or link at an http:// address. Files need no permission: the app reaches only the folders the user
// grants in Android's folder picker. Idempotent: run it after every init, and before a build.
//   node scripts/android-prep.mjs [path/to/AndroidManifest.xml]
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
const PLUGIN_FROM = "src-tauri/android/SafPlugin.kt";
const PLUGIN_TO = "src-tauri/gen/android/app/src/main/java/com/solenoid/app/SafPlugin.kt";

const PERMISSIONS = [
  '<uses-permission android:name="android.permission.INTERNET" />',
];

/** The manifest with Solenoid's permissions and application flags, each added once. */
export function patchManifest(xml) {
  let out = xml;
  for (const p of PERMISSIONS) {
    const name = /android:name="([^"]+)"/.exec(p)[1];
    if (new RegExp(`<uses-permission[^>]*android:name="${name.replace(/\./g, "\\.")}"`).test(out)) continue;
    out = out.replace(/(\n?)(\s*)<application\b/, (_m, nl, indent) => `${nl}${indent}${p}${nl || "\n"}${indent}<application`);
  }
  return setAppAttr(out, "android:usesCleartextTraffic", "true");
}

function setAppAttr(xml, attr, value) {
  return xml.replace(/<application\b([^>]*)>/, (m, attrs) => {
    const re = new RegExp(`${attr}="[^"]*"`);
    return re.test(attrs) ? `<application${attrs.replace(re, `${attr}="${value}"`)}>` : `<application${attrs} ${attr}="${value}">`;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? MANIFEST;
  if (!existsSync(path)) {
    console.error(`android-prep: no ${path}. Run \`npm run android:init\` first (it needs the Android SDK and NDK, docs/android.md).`);
    process.exit(1);
  }
  const before = readFileSync(path, "utf8");
  const after = patchManifest(before);
  if (after === before) console.log("android-prep: manifest already patched");
  else { writeFileSync(path, after); console.log(`android-prep: patched ${path}`); }
  if (!process.argv[2]) {
    mkdirSync(dirname(PLUGIN_TO), { recursive: true });
    copyFileSync(PLUGIN_FROM, PLUGIN_TO);
    console.log(`android-prep: copied ${PLUGIN_FROM}`);
  }
}
