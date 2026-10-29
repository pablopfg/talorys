import { type FeedRead, type SiteCheck, WORKFLOW_LIMITS } from "@talorys/shared";
import { ValidationError } from "../api/errors";
import { isPrivateAddress, isPrivateHost, type Resolver } from "../mcp/url";

/** Most redirects followed when reading a feed; each hop is checked like the first address. */
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 15_000;
/** Workflows say who they are, so a site owner can tell Talorys' checks apart. */
const USER_AGENT = "Talorys-Workflows/1.0 (+https://github.com/pablopfg/talorys)";

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
  try {
    workflowUrl(url.href, net);
  } catch {
    // Only a redirect can bring an address that wasn't checked when it was saved.
    throw new FetchFailed("The address redirected to a place workflows can't reach.");
  }
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

/** Reads at most `max` bytes of a body as text; a longer body is cut, never buffered whole. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, all.length - offset);
    all.set(part, offset);
    offset += part.length;
    if (offset >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/** Reads a feed (RSS or Atom), following up to three redirects, each one checked again. */
export async function readFeed(raw: string, net: Network): Promise<FeedRead> {
  let url = workflowUrl(raw, net);
  for (let hop = 0; ; hop++) {
    const res = await get(url, net, "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1");
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel();
      const location = res.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) throw new FetchFailed("Too many redirects.", res.status);
      url = new URL(location, url);
      continue;
    }
    if (res.status >= 400) {
      void res.body?.cancel();
      throw new FetchFailed(`The feed answered with status ${res.status}.`, res.status);
    }
    const parsed = parseFeed(await readCapped(res, WORKFLOW_LIMITS.feedBytes));
    if (!parsed) throw new FetchFailed("This address is not an RSS or Atom feed.");
    const items = await Promise.all(
      parsed.items.map(async (item) => ({ id: await shortHash(item.id), title: item.title, link: item.link })),
    );
    return { url: raw, ok: true, title: parsed.title, items, reason: null };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text of an XML or HTML fragment: CDATA unwrapped, tags removed, entities decoded, one line. */
export function plainText(fragment: string, max = 300): string {
  // Cut first: every pass below then works on a few kilobytes at most.
  const text = unwrapCdata(fragment.slice(0, max * 8))
    .replace(/<[^<>]{0,2000}>/g, " ")
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
    })
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** CDATA sections unwrapped with indexOf, so an opening without its end is read once, not rescanned. */
function unwrapCdata(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const start = text.indexOf("<![CDATA[", from);
    if (start < 0) return out + text.slice(from);
    const end = text.indexOf("]]>", start + 9);
    if (end < 0) return out + text.slice(from, start) + text.slice(start + 9);
    out += text.slice(from, start) + text.slice(start + 9, end);
    from = end + 3;
  }
}

/** ASCII-only lower case: same length as the input, so indexes found in it fit the original text. */
const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** Most tag openings looked at in one search; past that a feed is treated as having no more. */
const MAX_OPENINGS = 5_000;

/**
 * Each `<tag ...>...</tag>` in `xml`, with its attributes and inner text, found with indexOf so a
 * hostile feed (many openings, no closings) costs one pass, never a regex that rescans the text.
 */
function elements(xml: string, tag: string, limit: number): { attrs: string; inner: string; outer: string }[] {
  const lower = asciiLower(xml);
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}>`;
  const out: { attrs: string; inner: string; outer: string }[] = [];
  let from = 0;
  for (let seen = 0; out.length < limit && seen < MAX_OPENINGS; seen++) {
    const start = lower.indexOf(open, from);
    if (start < 0) break;
    const next = lower[start + open.length];
    // `<itemx` is another tag: skip it before looking for its end, so no search rescans the text.
    if (next !== ">" && next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
      from = start + open.length;
      continue;
    }
    const headEnd = lower.indexOf(">", start);
    if (headEnd < 0) break;
    const end = lower.indexOf(close, headEnd);
    if (end < 0) break;
    out.push({ attrs: xml.slice(start + open.length, headEnd), inner: xml.slice(headEnd + 1, end), outer: xml.slice(start, end + close.length) });
    from = end + close.length;
  }
  return out;
}

function element(xml: string, tag: string): { attrs: string; inner: string } | null {
  return elements(xml, tag, 1)[0] ?? null;
}

/** The attributes of a tag, read in one pass (a quote that never closes ends the reading). */
function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s/]/.test(text[i]!)) i++;
    const nameStart = i;
    while (i < text.length && !/[\s=/>]/.test(text[i]!)) i++;
    const name = asciiLower(text.slice(nameStart, i));
    if (!name) break;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (text[i] !== "=") continue;
    i++;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    const quote = text[i];
    let value: string;
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, i + 1);
      if (end < 0) break;
      value = text.slice(i + 1, end);
      i = end + 1;
    } else {
      const start = i;
      while (i < text.length && !/[\s>]/.test(text[i]!)) i++;
      value = text.slice(start, i);
    }
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/** An item link worth keeping: http(s) only, decoded, at most 500 characters. */
function safeLink(raw: string | null): string | null {
  if (!raw) return null;
  const text = plainText(raw, 600);
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The title and the newest items (at most 50) of an RSS 2.0 or Atom feed. A small, forgiving
 * reader: no DTDs or external entities are ever loaded, it only looks for the usual elements.
 * Null when the text is not a feed.
 */
export function parseFeed(xml: string): { title: string | null; items: { id: string; title: string; link: string | null }[] } | null {
  const atom = /<feed[\s>]/i.test(xml);
  if (!atom && !/<(rss|rdf:RDF|channel)[\s>]/i.test(xml)) return null;
  const tag = atom ? "entry" : "item";
  const blocks = elements(xml, tag, 50).map((e) => e.outer);
  const first = xml.search(new RegExp(`<${tag}[\\s>]`, "i"));
  const head = first >= 0 ? xml.slice(0, first) : xml;
  const title = element(head, "title");
  const items = blocks.flatMap((block) => {
    const itemTitle = element(block, "title");
    let link: string | null = null;
    if (atom) {
      const links = [...block.matchAll(/<link(\s[^<>]{0,2000})>/gi)].slice(0, 5).map((m) => attributes(m[1] ?? ""));
      const main = links.find((a) => !a.get("rel") || a.get("rel") === "alternate") ?? links[0];
      link = safeLink(main?.get("href") ?? null);
    } else {
      link = safeLink(element(block, "link")?.inner ?? null);
    }
    const guid = element(block, atom ? "id" : "guid")?.inner;
    const name = itemTitle ? plainText(itemTitle.inner, 200) : "";
    const id = (guid && plainText(guid, 500)) || link || name;
    return id ? [{ id, title: name || link || "(untitled)", link }] : [];
  });
  return { title: title ? plainText(title.inner, 120) || null : null, items };
}

/** 16 hex characters of SHA-256: enough to tell items apart, small enough to remember 200 per feed. */
export async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
