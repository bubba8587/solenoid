// [[B2]] webTryDesktopFull: the Android shell's manifest patch (docs/android.md).
import { describe, it, expect } from "vitest";
// @ts-expect-error a plain .mjs script, no types
import { patchManifest } from "../../scripts/android-prep.mjs";

const TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`;

describe("android-prep patchManifest", () => {
  it("asks for no storage permission (the user grants folders), and keeps the template's INTERNET once", () => {
    const out = patchManifest(TEMPLATE) as string;
    expect(out).not.toMatch(/STORAGE/);
    expect(out.match(/android\.permission\.INTERNET/g)).toHaveLength(1);
  });

  it("allows plain http in release too", () => {
    const out = patchManifest(TEMPLATE) as string;
    expect(out).toContain('android:usesCleartextTraffic="true"');
    expect(out).not.toContain("${usesCleartextTraffic}");
  });

  it("is idempotent", () => {
    const once = patchManifest(TEMPLATE) as string;
    expect(patchManifest(once)).toBe(once);
  });
});

describe("the Android capability", async () => {
  const { readFileSync } = await import("node:fs");
  const cap = readFileSync("src-tauri/capabilities/android.json", "utf8");
  // The app reaches only the folders the user grants, through the saf command (docs/android.md § Folders on Android).
  it("grants no file scope", () => {
    expect(cap).not.toMatch(/"fs:/);
    expect(cap).not.toMatch(/storage/);
  });
});
