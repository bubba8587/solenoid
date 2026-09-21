// The Chromium the probe/tuner scripts drive: $CHROME if set, else the first system
// browser found for this platform.
import fs from "node:fs";

const CANDIDATES = {
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
  win32: [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
};

export function browserPath() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = (CANDIDATES[process.platform] ?? []).find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chromium-family browser found; set CHROME to its executable path.");
  return found;
}
