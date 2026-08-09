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

/** Hard ceiling on a fetched body. Generous for real data feeds (a FRED CSV is
 *  a few MB) but a firewall against a runaway or hostile endpoint streaming an
 *  unbounded body straight into a single JS string and OOMing the tab. */
export const MAX_FETCH_BYTES = 64 * 1024 * 1024;

function tooLargeError(bytes: number): Error {
  return new Error(
    `Response is too large (${Math.round(bytes / 1e6)} MB, over the ${Math.round(MAX_FETCH_BYTES / 1e6)} MB limit). Refusing to load it into memory.`,
  );
}

/** Read a response body under `MAX_FETCH_BYTES`. Rejects an oversized
 *  `Content-Length` up front, streams with a running byte count when the platform
 *  exposes a body reader (aborting the moment the cap is crossed), and otherwise
 *  buffers and gates the size after — so no transport can silently OOM the tab. */
async function readCappedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) throw tooLargeError(declared);

  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_FETCH_BYTES) { void reader.cancel(); throw tooLargeError(total); }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    return new TextDecoder().decode(merged);
  }

  // No stream reader (e.g. a plain buffered Response): the body is already in
  // memory, so this size check is a best-effort backstop behind the header gate.
  const text = await res.text();
  if (text.length > MAX_FETCH_BYTES) throw tooLargeError(text.length);
  return text;
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
    return { text: await readCappedText(res), contentType: res.headers.get("content-type") ?? "" };
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
  return { text: await readCappedText(res), contentType: res.headers.get("content-type") ?? "" };
}
