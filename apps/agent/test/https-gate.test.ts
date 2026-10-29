import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import headersFile from "../../web/public/_headers?raw";
import worker from "../src/index";
import type { Env } from "../src/env";
import { WEB_HEADERS, webCacheControl } from "../src/web-headers";
import { BASE, freshIp } from "./helpers";

/** A stand-in for the ASSETS binding: the SPA shell for pages, a script under /assets/. */
function fakeAssets() {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path.startsWith("/assets/")) return new Response("console.log(1)", { headers: { "content-type": "text/javascript" } });
      return new Response("<!doctype html><title>Axis</title>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }),
  } as unknown as Fetcher;
}

/** The Worker as a one-Worker production deploy sees it (no development settings). */
function call(url: string, init: RequestInit = {}, extra: Partial<Env> = {}) {
  const headers = { "cf-connecting-ip": freshIp(), ...(init.headers as Record<string, string> | undefined) };
  return worker.fetch(new Request(url, { ...init, headers }), { ...(env as unknown as Env), TALORYS_ENV: "production", ...extra });
}

describe("Always Use HTTPS inside the Worker", () => {
  it("moves a plain HTTP page or read to the same address over HTTPS", async () => {
    const assets = fakeAssets();
    for (const [url, target] of <[string, string][]>[
      ["http://talorys.example.com/", "https://talorys.example.com/"],
      ["http://talorys.example.com:80/chat?x=1#y", "https://talorys.example.com/chat?x=1"],
      ["http://talorys.example.com/api/health", "https://talorys.example.com/api/health"],
    ]) {
      const res = await call(url, {}, { ASSETS: assets });
      expect(res.status, url).toBe(301);
      expect(res.headers.get("location"), url).toBe(target);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const head = await call("http://talorys.example.com/", { method: "HEAD" }, { ASSETS: assets });
    expect(head.status).toBe(301);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("refuses a plain HTTP request with a body instead of redirecting it", async () => {
    const res = await call("http://talorys.example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "anything" }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(JSON.stringify(await res.json())).toContain("HTTPS is required.");
  });

  it("refuses a plain HTTP read that carries a credential, so the leak can't go unnoticed", async () => {
    for (const headers of <Record<string, string>[]>[{ authorization: "Bearer tok_123" }, { cookie: "__Host-talorys_session=x" }]) {
      const res = await call("http://talorys.example.com/api/remote/tasks", { headers });
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
    }
    // A page visit with an unrelated cookie of the parent domain is still moved to HTTPS.
    const page = await call("http://talorys.example.com/", { headers: { cookie: "theme=dark" } }, { ASSETS: fakeAssets() });
    expect(page.status).toBe(301);
  });

  it("sends the hardened header set on the Worker's own answers", async () => {
    const hosts = { TALORYS_ALLOWED_HOSTS: "talorys.example.com" };
    for (const res of [
      await call("https://other.example.com/", {}, hosts),
      await call("http://talorys.example.com/", {}, hosts),
      await call("http://talorys.example.com/api/auth/login", { method: "POST" }, hosts),
      await call(`${BASE}/api/health`, {}, { TALORYS_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" }),
    ]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("strict-transport-security")).toBe(WEB_HEADERS["strict-transport-security"]);
    }
  });

  it("checks the host before redirecting, so another host learns nothing", async () => {
    const res = await call("http://talorys.other.workers.dev/", {}, { TALORYS_ALLOWED_HOSTS: "talorys.example.com", ASSETS: fakeAssets() });
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps plain HTTP in local development", async () => {
    const res = await call("http://localhost:8787/api/health", {}, { TALORYS_ENV: "development" });
    expect(res.status).toBe(200);
  });
});

describe("web UI served by the Worker (one-Worker deploy)", () => {
  it("serves the UI over HTTPS with the security headers from _headers", async () => {
    const assets = fakeAssets();
    const page = await call(`${BASE}/chat`, {}, { ASSETS: assets });
    expect(page.status).toBe(200);
    for (const [name, value] of Object.entries(WEB_HEADERS)) expect(page.headers.get(name), name).toBe(value);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    const script = await call(`${BASE}/assets/index-abc.js`, {}, { ASSETS: assets });
    expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(script.headers.get("strict-transport-security")).toBe(WEB_HEADERS["strict-transport-security"]);
    // A missing bundle falls back to the HTML shell, which must not be cached for a year.
    expect(webCacheControl("/assets/old-hash.js", "text/html; charset=utf-8")).toBe("no-cache");
    expect(webCacheControl("/assets/old-hash.js", "text/javascript", false)).toBeNull();
  });

  it("answers 404 for the UI on a host outside TALORYS_ALLOWED_HOSTS", async () => {
    const assets = fakeAssets();
    const hosts = { TALORYS_ALLOWED_HOSTS: "talorys.example.pages.dev", ASSETS: assets };
    expect((await call(`${BASE}/`, {}, hosts)).status).toBe(200);
    expect((await call("https://talorys.me.workers.dev/", {}, hosts)).status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("asks for Cloudflare Access on the UI too", async () => {
    const res = await call(`${BASE}/`, {}, { TALORYS_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", TALORYS_ACCESS_AUD: "a".repeat(64), ASSETS: fakeAssets() });
    expect(res.status).toBe(403);
  });

  it("keeps answering 404 outside /api when the UI is served by Pages (no ASSETS binding)", async () => {
    expect((await call(`${BASE}/`)).status).toBe(404);
  });

  it("matches apps/web/public/_headers, so Pages and the Worker send the same headers", () => {
    const blocks = new Map<string, Map<string, string>>();
    let current: Map<string, string> | undefined;
    for (const line of headersFile.split("\n")) {
      if (!line.trim()) continue;
      if (!/^\s/.test(line)) {
        current = new Map();
        blocks.set(line.trim(), current);
      } else {
        const at = line.indexOf(":");
        current?.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
      }
    }
    expect(Object.fromEntries(blocks.get("/*") ?? [])).toEqual(WEB_HEADERS);
    for (const [path, rules] of blocks) {
      if (path === "/*") continue;
      const sample = path.replace("*", "x.js");
      expect(webCacheControl(sample, null), path).toBe(rules.get("cache-control"));
    }
  });
});
