// Pinnable launchers for the local release + debug apps (docs/layout-chrome.md).
//   npm run desktop:launchers
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") throw new Error("Linux only.");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const meta = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml")], { encoding: "utf8", maxBuffer: 1 << 26 });
if (meta.status !== 0) throw new Error(meta.stderr);
const target = JSON.parse(meta.stdout).target_directory;

const home = os.homedir();
const bin = path.join(home, ".local", "bin");
const apps = path.join(home, ".local", "share", "applications");
const iconDir = path.join(home, ".local", "share", "icons", "hicolor", "256x256", "apps");
for (const d of [bin, apps, iconDir]) fs.mkdirSync(d, { recursive: true });

const debugLink = path.join(bin, "solenoid-debug");
fs.rmSync(debugLink, { force: true });
fs.symlinkSync(path.join(target, "debug", "solenoid"), debugLink);

const icons = path.join(root, "src-tauri", "icons");
const APPS = [
  { id: "solenoid", name: "Solenoid", exec: path.join(target, "release", "solenoid"), wmClass: "Solenoid", icon: path.join(icons, "128x128@2x.png") },
  { id: "solenoid-debug", name: "Solenoid (debug)", exec: debugLink, wmClass: "Solenoid-debug", icon: path.join(icons, "debug", "icon.png") },
];
for (const a of APPS) {
  fs.copyFileSync(a.icon, path.join(iconDir, `${a.id}.png`));
  fs.writeFileSync(path.join(apps, `${a.id}.desktop`), [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${a.name}`,
    "Comment=Visual computation graph",
    `Exec="${a.exec}"`,
    `Icon=${a.id}`,
    `StartupWMClass=${a.wmClass}`,
    "Categories=Office;",
    "Terminal=false",
    "",
  ].join("\n"));
  console.log(`installed ${a.id}.desktop`);
}
spawnSync("update-desktop-database", [apps]);
spawnSync("gtk-update-icon-cache", ["-f", "-t", path.join(home, ".local", "share", "icons", "hicolor")]);
