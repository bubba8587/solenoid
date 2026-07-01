// HTTP fetch that bypasses the browser CORS wall on desktop. The Tauri http
// plugin's fetch runs in Rust (no same-origin policy), so Web Source / IMPORTHTML
// can pull arbitrary URLs in the desktop app. The browser build falls back to the
// normal window.fetch (still CORS-limited — the error path explains that).
import { isDesktop } from "./fileBridge";

export interface FetchedText {
  text: string;
  contentType: string;
}

/** Thrown when a browser fetch fails in a way that's almost certainly CORS — so
 *  the UI can point the user at the desktop app instead of a cryptic message. */
export class CorsLikelyError extends Error {
  constructor() {
    super("Couldn't fetch this URL. The browser blocks cross-site requests; the desktop app can fetch any URL.");
    this.name = "CorsLikelyError";
  }
}

export async function fetchText(url: string): Promise<FetchedText> {
  // Route only ABSOLUTE (cross-origin) URLs through the Tauri http plugin on desktop —
  // that's the CORS-bypass path. A RELATIVE url (a bundled asset like a seed's
  // /data/foo.csv) must NOT go there: the plugin's Rust client can't resolve a relative
  // path (no base origin), so it fails. A normal fetch resolves it against the webview
  // origin, which Tauri serves from the bundled frontend — so same-origin assets work on
  // desktop exactly as they do in the browser (the Personal Finance seed's CSVs).
  const absolute = /^https?:\/\//i.test(url.trim());
  if (isDesktop() && absolute) {
    // Dynamic import so the browser bundle never pulls the Tauri plugin.
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    const res = await tauriFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    // On the web build a cross-origin block surfaces as a TypeError ("Failed to fetch")
    // with no status — distinct from a real HTTP error, which gives a Response. (On
    // desktop this path is only same-origin assets, so a TypeError isn't a CORS wall.)
    if (e instanceof TypeError && !isDesktop()) throw new CorsLikelyError();
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
}
