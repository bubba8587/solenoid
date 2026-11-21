// Solenoid's nativeAccent.ts tints the desktop window's border through Tauri. The kit has no window of its own,
// so the host hands it the hook it wants (a Tauri command, an Electron call) and the theme calls it on each apply.

let hook = null;

export function setNativeAccentHook(fn) {
  hook = typeof fn === 'function' ? fn : null;
}

export function syncNativeAccent(hex) {
  try {
    hook?.(hex);
  } catch {
    // A failed native call never stops the theme.
  }
}
