// Clipboard writes, guarded. `navigator.clipboard` is undefined in a non-secure
// context (a plain-http LAN preview) and its promise can reject (permissions,
// blurred document). Falls back to the legacy execCommand path; resolves true only
// when something actually copied (callers gate their "Copied" feedback on it).
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
