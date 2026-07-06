// Sync the app accent to the native Windows 11 window border (DWMWA_BORDER_COLOR),
// so the focused-frame color Windows draws matches the theme instead of the system
// accent. Called from appTheme's apply() with the resolved accent hex, on every
// accent / mode / palette change. No-op on web (no Tauri) and off Windows 11 (the
// Rust command is a no-op there).
import { isDesktop } from "./fileBridge";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// DISABLED 2026-07-06: setting DWMWA_BORDER_COLOR re-asserts a native window frame,
// which clobbers tauri-plugin-decorum's overlay titlebar → the min/max/close controls
// vanish. The accent border is minor polish; working window controls are not. Flip this
// back on only once the border can be set WITHOUT disturbing decorum's custom frame
// (needs live iteration on the desktop build).
const NATIVE_ACCENT_BORDER_ENABLED = false;

export function syncNativeAccent(hex: string): void {
  if (!NATIVE_ACCENT_BORDER_ENABLED) return;
  if (!isDesktop()) return;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_window_border", rgb))
    .catch(() => { /* pre-Windows-11 / command unavailable — ignore */ });
}
