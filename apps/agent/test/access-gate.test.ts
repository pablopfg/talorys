import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker, { allowedHosts } from "../src/index";
import type { Env } from "../src/env";
import { type AccessConfig, accessConfig, clearAccessKeys, verifyAccessToken } from "../src/auth/access";
import { BASE, freshIp } from "./helpers";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "0123456789abcdef".repeat(4);
const CONFIG: AccessConfig = { teamDomain: TEAM, aud: AUD };

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let jwks: { keys: JsonWebKey[] };

async function sign(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}): Promise<string> {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

const now = () => Math.floor(Date.now() / 1000);
const valid = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, iat: now(), email: "owner@example.com" });

function keyServer() {
  return vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json(jwks);
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  keys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  jwks = { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" } as JsonWebKey] };
});

afterEach(() => {
  clearAccessKeys();
  vi.restoreAllMocks();
});

describe("Access token check", () => {
  it("accepts a token Access signed for this application", async () => {
    expect(await verifyAccessToken(await sign(valid()), CONFIG, keyServer())).toBe(true);
    expect(await verifyAccessToken(await sign({ ...valid(), aud: AUD }), CONFIG, keyServer())).toBe(true);
  });

  it.each([
    ["another application", { aud: ["f".repeat(64)] }],
    ["another team", { iss: "https://evil.cloudflareaccess.com" }],
    ["an expired token", { exp: now() - 120 }],
    ["a token not valid yet", { nbf: now() + 600 }],
    ["no expiry", { exp: undefined }],
  ])("refuses %s", async (_name, change) => {
    expect(await verifyAccessToken(await sign({ ...valid(), ...change }), CONFIG, keyServer())).toBe(false);
  });

  it("refuses a forged signature, an unknown key, another algorithm and garbage", async () => {
    const fetcher = keyServer();
    expect(await verifyAccessToken(await sign(valid(), { key: otherKeys.privateKey }), CONFIG, fetcher)).toBe(false);
    expect(await verifyAccessToken(await sign(valid(), { kid: "k2" }), CONFIG, fetcher)).toBe(false);
    expect(await verifyAccessToken(await sign(valid(), { alg: "none" }), CONFIG, fetcher)).toBe(false);
    const [h, p] = (await sign(valid())).split(".");
    expect(await verifyAccessToken(`${h}.${p}.`, CONFIG, fetcher)).toBe(false);
    for (const junk of [null, "", "a.b", "a.b.c", "x".repeat(9000)]) expect(await verifyAccessToken(junk, CONFIG, fetcher)).toBe(false);
  });

  it("refuses everything when the key endpoint fails", async () => {
    const down = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await verifyAccessToken(await sign(valid()), CONFIG, down)).toBe(false);
  });

  it("caches the keys and refetches an unknown key at most once a minute", async () => {
    const fetcher = keyServer();
    await verifyAccessToken(await sign(valid()), CONFIG, fetcher);
    await verifyAccessToken(await sign(valid()), CONFIG, fetcher);
    for (let i = 0; i < 5; i++) await verifyAccessToken(await sign(valid(), { kid: `rotated-${i}` }), CONFIG, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("is off without settings and refuses half a configuration", () => {
    expect(accessConfig({})).toBeNull();
    expect(accessConfig({ TALORYS_ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, TALORYS_ACCESS_AUD: AUD.toUpperCase() })).toEqual(CONFIG);
    expect(() => accessConfig({ TALORYS_ACCESS_TEAM_DOMAIN: TEAM })).toThrow();
    expect(() => accessConfig({ TALORYS_ACCESS_AUD: AUD })).toThrow();
    expect(() => accessConfig({ TALORYS_ACCESS_TEAM_DOMAIN: "evil.example.com", TALORYS_ACCESS_AUD: AUD })).toThrow();
  });
});

describe("entry gates (AUTH-03)", () => {
  const call = (path: string, extra: Partial<Env>, headers: Record<string, string> = {}, base = BASE) =>
    worker.fetch(new Request(`${base}${path}`, { headers: { "cf-connecting-ip": freshIp(), ...headers } }), { ...(env as unknown as Env), ...extra });

  it("answers 404 on a host outside TALORYS_ALLOWED_HOSTS", async () => {
    const hosts = { TALORYS_ALLOWED_HOSTS: "talorys.example.pages.dev, Other.Example.com" };
    expect((await call("/api/auth/session", hosts)).status).toBe(200);
    expect((await call("/api/auth/session", hosts, {}, "https://talorys.other.workers.dev")).status).toBe(404);
    expect((await call("/api/auth/session", hosts, {}, "https://other.example.com")).status).toBe(200);
    expect(allowedHosts({})).toBeNull();
    expect(allowedHosts({ TALORYS_ALLOWED_HOSTS: " , " })).toBeNull();
  });

  it("with Access on, refuses a request without a valid Access token whatever the host", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(keyServer());
    const access = { TALORYS_ACCESS_TEAM_DOMAIN: TEAM, TALORYS_ACCESS_AUD: AUD };
    const missing = await call("/api/auth/session", access);
    expect(missing.status).toBe(403);
    expect(JSON.stringify(await missing.json())).toContain("Cloudflare Access");
    expect((await call("/api/auth/session", access, { "cf-access-jwt-assertion": await sign(valid(), { key: otherKeys.privateKey }) })).status).toBe(403);
    expect((await call("/api/auth/session", access, { "cf-access-jwt-assertion": await sign(valid()) })).status).toBe(200);
  });

  it("leaves only the anonymous health check open, so a deploy can check itself", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(keyServer());
    const access = { TALORYS_ACCESS_TEAM_DOMAIN: TEAM, TALORYS_ACCESS_AUD: AUD };
    const health = await call("/api/health", access);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    // With a cookie it would be the owner's full report, so the Access token is required again.
    expect((await call("/api/health", access, { cookie: "talorys_session=x" })).status).toBe(403);
  });

  it("fails closed when Access is half configured", async () => {
    const res = await call("/api/health", { TALORYS_ACCESS_TEAM_DOMAIN: TEAM });
    expect(res.status).toBe(503);
  });
});
