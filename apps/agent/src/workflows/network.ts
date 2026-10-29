import type { SiteCheck } from "@talorys/shared";
import { ValidationError } from "../api/errors";
import { isPrivateAddress, isPrivateHost, type Resolver } from "../mcp/url";

const TIMEOUT_MS = 15_000;
/** Workflows say who they are, so a site owner can tell Axis' checks apart. */
const USER_AGENT = "Axis-Workflows/1.0 (+https://github.com/pablopfg/talorys)";

export interface Network {
  fetch: typeof fetch;
  resolve: Resolver;
  development: boolean;
  /** Answers already looked up in this run, by host. */
  dns?: Map<string, string[]>;
}

/**
 * A workflow address, normalized: https:// on a public host, without credentials or #fragment.
 * Checked when the owner saves it and again before every request.
 */
export function workflowUrl(raw: string, opts: { development: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("Use a full https:// address.");
  }
  if (url.protocol !== "https:") throw new ValidationError("Use a full https:// address.");
  if (url.username || url.password) throw new ValidationError("An address can't carry a user name or password.");
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!opts.development && isPrivateHost(host)) {
    throw new ValidationError("This address is on a private or local network. Workflows only reach public sites.");
  }
  return url;
}

/** Thrown inside a step when a request fails; the step retries, then the run records the message. */
export class FetchFailed extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "FetchFailed";
  }
}

/** Refuses a host name whose DNS answers include a private address (a public name pointed inside). */
async function assertPublic(url: URL, net: Network): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (net.development || host.startsWith("[") || /^[\d.]+$/.test(host)) return;
  let addresses: string[];
  try {
    // One lookup per host and run: the Free plan allows 50 subrequests per invocation.
    const cached = net.dns?.get(host);
    addresses = cached ?? (await net.resolve(host));
    net.dns?.set(host, addresses);
  } catch {
    throw new FetchFailed("Could not look up the address.");
  }
  if (addresses.length === 0) throw new FetchFailed("The host name doesn't resolve to an address.");
  if (addresses.some(isPrivateAddress)) throw new FetchFailed("The host name points to a private network address.");
}

/** One GET to a checked address, never following redirects by itself. */
async function get(url: URL, net: Network, accept: string): Promise<Response> {
  await assertPublic(url, net);
  try {
    return await net.fetch(url.href, {
      method: "GET",
      redirect: "manual",
      headers: { accept, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new FetchFailed(timedOut ? "No answer within 15 seconds." : "Could not connect.");
  }
}

/**
 * Whether a site answers: any answer below 400 counts as up (a redirect too: the site is there).
 * Throws FetchFailed when it's down, so the workflow step retries before giving up.
 */
export async function checkSite(raw: string, net: Network): Promise<SiteCheck> {
  const url = workflowUrl(raw, net);
  const started = Date.now();
  const res = await get(url, net, "text/html,*/*");
  void res.body?.cancel();
  if (res.status >= 400) throw new FetchFailed(`The site answered with status ${res.status}.`, res.status);
  return { url: raw, ok: true, status: res.status, reason: null, ms: Date.now() - started };
}
