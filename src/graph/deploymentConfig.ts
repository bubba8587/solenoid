// [[C103]] untrustedContentSeams
// A hosted copy's own settings (docs/self-hosting.md): `solenoid.config.json` beside index.html, which the company
// serving the web build writes. The public build ships it empty. Read once at startup; the desktop app has none.

export interface DeploymentConfig {
  /** Hosts whose fetches skip the network prompt: `portal.company.com` exactly, `.company.com` it and every
   *  subdomain. Lowercase names, an optional port; anything else is dropped. */
  trustedSources: string[];
}

const EMPTY: DeploymentConfig = { trustedSources: [] };
let config: DeploymentConfig = EMPTY;

const HOST = /^\.?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

/** The file's fields this build reads, each checked; a malformed file or field reads as unset. */
export function parseDeploymentConfig(raw: unknown): DeploymentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const list = (raw as { trustedSources?: unknown }).trustedSources;
  const trustedSources = Array.isArray(list)
    ? list.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter((h) => HOST.test(h))
    : [];
  return { trustedSources };
}

export function deploymentConfig(): DeploymentConfig {
  return config;
}

/** For tests, and for the loader below. */
export function setDeploymentConfig(next: DeploymentConfig): void {
  config = next;
}

/** Reads `solenoid.config.json` from beside the page; a missing or malformed file leaves the config empty. */
export async function loadDeploymentConfig(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetcher("solenoid.config.json", { cache: "no-cache" });
    if (!res.ok) return;
    setDeploymentConfig(parseDeploymentConfig(await res.json()));
  } catch {
    // No file, or not JSON (a host that answers every path with the page): nothing configured.
  }
}

/** Whether an address's host is one the deployment vouches for. A relative address is the page's own host. */
export function isTrustedSource(url: string): boolean {
  if (config.trustedSources.length === 0) return false;
  let u: URL;
  try {
    u = new URL(url, typeof location === "undefined" ? undefined : location.href);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  // An address on its scheme's own port names none, so an entry naming that port still matches it.
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return config.trustedSources.some((entry) => {
    const [name, entryPort] = entry.split(":");
    if (entryPort !== undefined && entryPort !== port) return false;
    return name.startsWith(".") ? host === name.slice(1) || host.endsWith(name) : host === name;
  });
}
