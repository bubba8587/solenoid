// [[C23]] calcModes, [[B18]] safeToShare
// Desktop fetches go through the Tauri http plugin (no same-origin policy); the browser build stays CORS-limited.
import { isDesktop } from "./fileBridge";
import { writtenElsewhere } from "./foreignCardStore";

/** Must stay a recognized tool UA: FRED's fredgraph.csv sits behind a WAF that drops browser, unknown and reqwest UAs. */
const DATA_FETCH_UA = "curl/8.4.0";

interface FetchedText {
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
  const streamed = await readCappedStream(res);
  if (streamed) return new TextDecoder().decode(streamed);
  const text = await res.text();
  if (text.length > MAX_FETCH_BYTES) throw tooLargeError(text.length);
  return text;
}

async function readCappedBytes(res: Response): Promise<Uint8Array> {
  const streamed = await readCappedStream(res);
  if (streamed) return streamed;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FETCH_BYTES) throw tooLargeError(bytes.byteLength);
  return bytes;
}

/** The body read chunk by chunk, aborting the moment it crosses the cap; null when the response can't stream. */
async function readCappedStream(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) throw tooLargeError(declared);

  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") return null;
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
  return merged;
}

export class CorsLikelyError extends Error {
  constructor() {
    super("Couldn't fetch this URL. The browser blocks cross-site requests; the desktop app can fetch any URL.");
    this.name = "CorsLikelyError";
  }
}

interface NetReply { status: number; status_text: string; headers: [string, string][]; body: string; body_base64?: string | null }

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The desktop's fetch, the shell's `net_fetch` (`src-tauri/src/net.rs`). What someone else wrote (`from`, the asking
 *  card) never reaches this computer or the local network, by any spelling, name or redirect; the user's own may. */
async function desktopFetch(url: string, init: { method?: string; headers: Record<string, string>; body?: string; from?: string; binary?: boolean }): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  const req = { url, method: init.method, headers: Object.entries(init.headers), body: init.body, local: !writtenElsewhere(init.from), binary: !!init.binary };
  let reply: NetReply;
  try {
    reply = await invoke<NetReply>("net_fetch", { req });
  } catch (e) {
    if (String(e).startsWith("local-network-refused")) {
      throw new Error("A document someone else wrote doesn't fetch from this computer or the local network (localhost, 192.168.x and the like).");
    }
    throw new Error(String(e));
  }
  const noBody = reply.status === 204 || reply.status === 205 || reply.status === 304;
  const body = noBody ? null : reply.body_base64 != null ? fromBase64(reply.body_base64) : reply.body;
  return new Response(body, { status: reply.status, statusText: reply.status_text, headers: reply.headers });
}

export async function fetchText(url: string, init?: { headers?: Record<string, string>; from?: string }): Promise<FetchedText> {
  const extra = init?.headers ?? {};
  // Only absolute URLs take the Tauri path: its Rust client has no base origin, so a relative bundled asset fails there.
  const absolute = /^https?:\/\//i.test(url.trim());
  if (isDesktop() && absolute) {
    const res = await desktopFetch(url, { headers: { "User-Agent": DATA_FETCH_UA, ...extra }, from: init?.from });
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

/** A body that isn't text (a workbook), as bytes, under the same cap, gates and errors as `fetchText`. */
export async function fetchBytes(url: string, init?: { from?: string }): Promise<{ bytes: Uint8Array; contentType: string }> {
  const absolute = /^https?:\/\//i.test(url.trim());
  let res: Response;
  if (isDesktop() && absolute) {
    res = await desktopFetch(url, { headers: { "User-Agent": DATA_FETCH_UA }, from: init?.from, binary: true });
  } else {
    try {
      res = await fetch(url);
    } catch (e) {
      if (e instanceof TypeError && !isDesktop()) throw new CorsLikelyError();
      throw e;
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  return { bytes: await readCappedBytes(res), contentType: res.headers.get("content-type") ?? "" };
}

export async function fetchJson(url: string, init: { method: "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: unknown; from?: string }): Promise<FetchedText> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const absolute = /^https?:\/\//i.test(url.trim());
  let res: Response;
  if (isDesktop() && absolute) {
    res = await desktopFetch(url, { method: init.method, headers: { "User-Agent": DATA_FETCH_UA, ...headers }, body, from: init.from });
  } else {
    res = await fetch(url, { method: init.method, headers, body });
  }
  const text = await readCappedText(res);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim() + (text ? `: ${text.slice(0, 200)}` : ""));
  return { text, contentType: res.headers.get("content-type") ?? "" };
}
