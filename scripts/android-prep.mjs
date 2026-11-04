// Patches the Android project `tauri android init` generates (src-tauri/gen/android) with what Solenoid needs beyond
// Tauri's template (docs/android.md): All files access, so Local File, Vault Folder and the Obsidian cards read shared
// storage by path as the desktop does; the legacy storage permissions for Android 10 and older; and plain-http fetches
// for connection cards that name an http:// URL. Idempotent: run it after every init, and before a build.
//   node scripts/android-prep.mjs [path/to/AndroidManifest.xml]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MANIFEST = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";

const PERMISSIONS = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
];

/** The manifest with Solenoid's permissions and application flags, each added once. */
export function patchManifest(xml) {
  let out = xml;
  for (const p of PERMISSIONS) {
    const name = /android:name="([^"]+)"/.exec(p)[1];
    if (new RegExp(`<uses-permission[^>]*android:name="${name.replace(/\./g, "\\.")}"`).test(out)) continue;
    out = out.replace(/(\n?)(\s*)<application\b/, (_m, nl, indent) => `${nl}${indent}${p}${nl || "\n"}${indent}<application`);
  }
  out = setAppAttr(out, "android:usesCleartextTraffic", "true");
  out = setAppAttr(out, "android:requestLegacyExternalStorage", "true");
  return out;
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
}
