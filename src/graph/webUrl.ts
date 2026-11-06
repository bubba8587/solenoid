// [[C103]] untrustedContentSeams, [[B18]] safeToShare
// Whether loading an address is a fetch from the web: the browser's own reading of it, so `\\host/x`, `https:\\host`
// and a tab or newline inside the scheme count as the web too. data: and blob: pictures, and the app's own files, do not.

function base(): string {
  return typeof location !== "undefined" && location.href ? location.href : "http://app.invalid/";
}

export function isWebUrl(address: string): boolean {
  const b = base();
  let u: URL;
  try { u = new URL(address.trim(), b); } catch { return false; }
  if (u.protocol === "data:" || u.protocol === "blob:") return false;
  return u.origin !== new URL(b).origin;
}

/** Whether any candidate of a `srcset` is a web address. */
export function srcsetReachesWeb(srcset: string): boolean {
  return srcset.split(",").some((c) => { const url = c.trim().split(/\s+/)[0]; return !!url && isWebUrl(url); });
}

/** CSS that can fetch: `url(…)`, `image-set(…)` or `@import`. */
export const CSS_FETCH = /url\s*\(|image-set\s*\(|@import/i;
