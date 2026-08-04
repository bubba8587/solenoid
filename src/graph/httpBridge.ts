// HTTP fetch that bypasses the CORS wall on desktop via the Tauri http plugin
// (Rust, no same-origin policy); the browser build stays CORS-limited.
import { isDesktop } from "./fileBridge";

/** Must stay a RECOGNIZED tool UA: FRED's fredgraph.csv sits behind a WAF that drops
 *  the connection for a browser string, an unknown custom UA, or reqwest's default. */
const DATA_FETCH_UA = "curl/8.4.0";

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
  // Only ABSOLUTE urls may take the Tauri path: its Rust client has no base origin, so
  // a relative one (a bundled seed asset) fails there but resolves under plain fetch.
  const absolute = /^https?:\/\//i.test(url.trim());
  if (isDesktop() && absolute) {
    // Dynamic import so the browser bundle never pulls the Tauri plugin.
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    const res = await tauriFetch(url, { headers: { "User-Agent": DATA_FETCH_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    // On the web build a cross-origin block is a bare TypeError with no Response;
    // on desktop this path is same-origin only, so a TypeError there is not CORS.
    if (e instanceof TypeError && !isDesktop()) throw new CorsLikelyError();
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
}
