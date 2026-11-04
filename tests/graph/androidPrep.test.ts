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
  it("adds All files access once, beside the template's INTERNET", () => {
    const out = patchManifest(TEMPLATE) as string;
    expect(out.match(/MANAGE_EXTERNAL_STORAGE/g)).toHaveLength(1);
    expect(out.match(/android\.permission\.INTERNET/g)).toHaveLength(1);
    expect(out.indexOf("MANAGE_EXTERNAL_STORAGE")).toBeLessThan(out.indexOf("<application"));
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
  const cap = JSON.parse(readFileSync("src-tauri/capabilities/android.json", "utf8")) as { permissions: Array<string | { identifier: string; allow: { path: string }[] }> };
  const paths = (id: string) => (cap.permissions.find((p) => typeof p !== "string" && p.identifier === id) as { allow: { path: string }[] }).allow.map((a) => a.path);
  // `/storage/emulated/0/**` matches everything inside shared storage but not the folder itself (Tauri's glob scope,
  // checked 2026-11-04), and the Android pickers start by listing that folder.
  it("lets the pickers list, test and stat shared storage's root itself", () => {
    for (const id of ["fs:allow-read-dir", "fs:allow-stat", "fs:allow-exists"]) expect(paths(id)).toContain("/storage/emulated/0");
  });
});
