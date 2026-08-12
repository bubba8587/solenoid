// Sync the app accent to the native Windows 11 window border (DWMWA_BORDER_COLOR).
// No-op on web (no Tauri) and off Windows 11 (the Rust command is a no-op there).
import { isDesktop } from "./fileBridge";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function syncNativeAccent(hex: string): void {
  if (!isDesktop()) return;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_window_border", rgb))
    .catch(() => { /* pre-Windows-11 / command unavailable — ignore */ });
}
