import { pushSubscribeSchema } from "@talorys/shared";
import { describe, expect, it } from "vitest";
import { BASE, client, freshIp, inAgent, loggedIn, password } from "./helpers";
import { createApi } from "../src/api/app";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import type { Env } from "../src/env";

const NEW_PASSWORD = "another-Strong-passphrase-42";

/** Calls the API as a production deploy would see it, without the development settings the test pool runs with. */
async function inProduction(agent: TalorysAgent, url: string, init: RequestInit = {}): Promise<Response> {
  const env = { ...(agent as unknown as { env: Env }).env, TALORYS_ENV: "production" };
  return createApi().fetch(new Request(url, init), { agent, env });
}

describe("transport (AUTH-05, AUTH-10)", () => {
  it("refuses plain HTTP outside development", async () => {
    await inAgent(async (a) => {
      const res = await inProduction(a, "http://talorys.example.pages.dev/api/auth/session", { headers: { "cf-connecting-ip": freshIp() } });
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain("HTTPS is required.");
      const ok = await inProduction(a, `${BASE}/api/auth/session`, { headers: { "cf-connecting-ip": freshIp() } });
      expect(ok.status).toBe(200);
    });
  });

  it("refuses a sign-in without the client address outside development", async () => {
    await inAgent(async (a) => {
      const res = await inProduction(a, `${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-talorys-request": "1", origin: BASE },
        body: JSON.stringify({ password: password() }),
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("issues the __Host- cookie in production even if the URL were not https", async () => {
    await inAgent(async (a) => {
      const res = await inProduction(a, `${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-talorys-request": "1", origin: BASE, "cf-connecting-ip": freshIp() },
        body: JSON.stringify({ password: password() }),
      });
      expect(res.status).toBe(200);
      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^__Host-talorys_session=/);
      expect(cookie).toContain("Secure");
    });
  });
});

describe("API response headers (WEB-02)", () => {
  it("forbid loading, framing and plain HTTP on every answer, errors included", async () => {
    for (const path of ["/api/auth/session", "/api/tasks", "/api/nope"]) {
      const res = await client().call(path);
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("health (AUTH-06)", () => {
  it("tells strangers only whether it is ok", async () => {
    const res = await client().call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("gives the owner the full report", async () => {
    const health = await (await loggedIn()).json("/api/health");
    expect(health).toMatchObject({ ok: true, storage: "ok", configured: { password: true, session_secret: true } });
    expect(health.version).toBeTypeOf("string");
  });
});

describe("session rotation (AUTH-04)", () => {
  it("signing in again ends the session the browser already had", async () => {
    const c = await loggedIn();
    const planted = c.cookie!;
    const res = await c.call("/api/auth/login", { method: "POST", body: { password: password() } });
    expect(res.status).toBe(200);
    expect(c.cookie).not.toBe(planted);
    expect((await client({ cookie: planted }).call("/api/tasks")).status).toBe(401);
    expect((await c.call("/api/tasks")).status).toBe(200);
  });

  it("a failed sign-in leaves the existing session alone", async () => {
    const c = await loggedIn();
    const res = await c.call("/api/auth/login", { method: "POST", body: { password: "not-the-password" } });
    expect(res.status).toBe(401);
    expect((await c.call("/api/tasks")).status).toBe(200);
  });

  it("changing the password moves this browser to a new session and ends the old token", async () => {
    const c = await loggedIn();
    const before = c.cookie!;
    const other = await loggedIn();
    try {
      const res = await c.call("/api/auth/password", { method: "POST", body: { current_password: password(), new_password: NEW_PASSWORD } });
      expect(res.status).toBe(200);
      expect(c.cookie).not.toBe(before);
      expect((await c.call("/api/tasks")).status).toBe(200);
      expect((await client({ cookie: before }).call("/api/tasks")).status).toBe(401);
      expect((await other.call("/api/tasks")).status).toBe(401);
    } finally {
      await c.call("/api/auth/password", { method: "POST", body: { current_password: NEW_PASSWORD, new_password: password() } });
    }
  });
});

describe("push subscription keys (PUSH-01)", () => {
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
  const point = () => {
    const raw = crypto.getRandomValues(new Uint8Array(65));
    raw[0] = 4;
    return raw;
  };
  const sub = (p256dh: string, auth: string) => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh, auth } });

  it("accepts the sizes RFC 8291 uses, padded or not", () => {
    const p = b64(point());
    const a = b64(crypto.getRandomValues(new Uint8Array(16)));
    expect(pushSubscribeSchema.safeParse(sub(p, a)).success).toBe(true);
    expect(pushSubscribeSchema.safeParse(sub(p.replace(/=+$/, ""), a.replace(/=+$/, ""))).success).toBe(true);
  });

  it.each([
    ["a 64-byte key", () => b64(point().slice(0, 64)), 16],
    ["a compressed key", () => b64(Object.assign(point(), { 0: 2 })), 16],
    ["a 15-byte secret", () => b64(point()), 15],
    ["a 17-byte secret", () => b64(point()), 17],
  ])("refuses %s", (_name, p256dh, authBytes) => {
    expect(pushSubscribeSchema.safeParse(sub(p256dh(), b64(crypto.getRandomValues(new Uint8Array(authBytes))))).success).toBe(false);
  });
});
