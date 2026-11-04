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
  it("adds All files access and the legacy storage permissions once, beside the template's INTERNET", () => {
    const out = patchManifest(TEMPLATE) as string;
    expect(out.match(/MANAGE_EXTERNAL_STORAGE/g)).toHaveLength(1);
    expect(out.match(/READ_EXTERNAL_STORAGE/g)).toHaveLength(1);
    expect(out.match(/WRITE_EXTERNAL_STORAGE/g)).toHaveLength(1);
    expect(out.match(/android\.permission\.INTERNET/g)).toHaveLength(1);
    expect(out.indexOf("MANAGE_EXTERNAL_STORAGE")).toBeLessThan(out.indexOf("<application"));
  });

  it("allows plain http in release too, and legacy storage on Android 10", () => {
    const out = patchManifest(TEMPLATE) as string;
    expect(out).toContain('android:usesCleartextTraffic="true"');
    expect(out).not.toContain("${usesCleartextTraffic}");
    expect(out).toContain('android:requestLegacyExternalStorage="true"');
  });

  it("is idempotent", () => {
    const once = patchManifest(TEMPLATE) as string;
    expect(patchManifest(once)).toBe(once);
  });
});
