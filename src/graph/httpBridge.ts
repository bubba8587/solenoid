// [[D32]] refreshOutsideRebuild, [[C38]] sinkRunButtonOnly
// Desktop fetches go through the Tauri http plugin (no same-origin policy); the browser build stays CORS-limited.
import { isDesktop } from "./fileBridge";

/** Must stay a recognized tool UA: FRED's fredgraph.csv sits behind a WAF that drops browser, unknown and reqwest UAs. */
const DATA_FETCH_UA = "curl/8.4.0";

export interface FetchedText {
  text: string;
  contentType: string;
}

/** A firewall against a runaway or hostile endpoint streaming an unbounded body into one string and OOMing the tab. */
export const MAX_FETCH_BYTES = 64 * 1024 * 1024;

function tooLargeError(bytes: number): Error {
  return new Error(
    `Response is too large (${Math.round(bytes / 1e6)} MB, over the ${Math.round(MAX_FETCH_BYTES / 1e6)} MB limit). Refusing to load it into memory.`,
  );
}

/** Rejects an oversized Content-Length up front, then counts streamed bytes, or gates the size after buffering. */
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

  const text = await res.text();
  if (text.length > MAX_FETCH_BYTES) throw tooLargeError(text.length);
  return text;
}

export class CorsLikelyError extends Error {
  constructor() {
    super("Couldn't fetch this URL. The browser blocks cross-site requests; the desktop app can fetch any URL.");
    this.name = "CorsLikelyError";
  }
}

export async function fetchText(url: string, init?: { headers?: Record<string, string> }): Promise<FetchedText> {
  const extra = init?.headers ?? {};
  // Only absolute URLs take the Tauri path: its Rust client has no base origin, so a relative bundled asset fails there.
  const absolute = /^https?:\/\//i.test(url.trim());
  if (isDesktop() && absolute) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    const res = await tauriFetch(url, { headers: { "User-Agent": DATA_FETCH_UA, ...extra } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return { text: await readCappedText(res), contentType: res.headers.get("content-type") ?? "" };
  }
  let res: Response;
  try {
    res = Object.keys(extra).length ? await fetch(url, { headers: extra }) : await fetch(url);
  } catch (e) {
    // On the web a cross-origin block is a bare TypeError with no Response; on desktop this path is same-origin only.
    if (e instanceof TypeError && !isDesktop()) throw new CorsLikelyError();
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  return { text: await readCappedText(res), contentType: res.headers.get("content-type") ?? "" };
}

export async function fetchJson(url: string, init: { method: "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: unknown }): Promise<FetchedText> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const absolute = /^https?:\/\//i.test(url.trim());
  let res: Response;
  if (isDesktop() && absolute) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    res = await tauriFetch(url, { method: init.method, headers: { "User-Agent": DATA_FETCH_UA, ...headers }, body });
  } else {
    res = await fetch(url, { method: init.method, headers, body });
  }
  const text = await readCappedText(res);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim() + (text ? `: ${text.slice(0, 200)}` : ""));
  return { text, contentType: res.headers.get("content-type") ?? "" };
}
