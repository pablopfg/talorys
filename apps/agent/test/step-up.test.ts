import { BACKUP_FORMAT, REMOTE_TOKEN_TTL_DAYS } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type Client, client, inAgent, loggedIn, password } from "./helpers";

/** Moves every session's last password entry outside the step-up window. */
const ageConfirmations = () => inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = '2000-01-01T00:00:00.000Z'`));

const backup = { format: BACKUP_FORMAT, version: 1, exported_at: new Date().toISOString(), data: {} };

async function code(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

afterEach(async () => {
  await inAgent((a) => {
    a.services.remote.revokeAll();
    a.services.remote.setEnabled(false);
  });
});

describe("sensitive actions need the password typed recently (AUTH-01)", () => {
  it("a fresh sign-in counts as confirmation", async () => {
    const c = await loggedIn();
    expect((await c.call("/api/export")).status).toBe(200);
    expect((await c.call("/api/remote/status", { method: "PATCH", body: { enabled: true } })).status).toBe(200);
    expect((await c.call("/api/remote/tokens", { method: "POST", body: { name: "fresh" } })).status).toBe(201);
  });

  it("an old session must confirm before export, import, enabling remote access or minting a token", async () => {
    const c = await loggedIn();
    await ageConfirmations();
    const attempts: Array<[string, Parameters<Client["call"]>[1]]> = [
      ["/api/export", {}],
      ["/api/import", { method: "POST", body: backup }],
      ["/api/remote/status", { method: "PATCH", body: { enabled: true } }],
      ["/api/remote/tokens", { method: "POST", body: { name: "stolen" } }],
    ];
    for (const [path, init] of attempts) {
      const res = await c.call(path, init);
      expect(res.status, path).toBe(403);
      expect(await code(res)).toBe("REAUTH_REQUIRED");
    }
    expect(await inAgent((a) => [a.services.remote.isEnabled(), a.services.remote.count()])).toEqual([false, 0]);
    // Closing the door never needs it, and the session itself still works.
    expect((await c.call("/api/remote/status", { method: "PATCH", body: { enabled: false } })).status).toBe(200);
    expect((await c.call("/api/tasks")).status).toBe(200);

    const confirmed = await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    expect(confirmed.status).toBe(200);
    expect(Date.parse(((await confirmed.json()) as { until: string }).until)).toBeGreaterThan(Date.now());
    expect((await c.call("/api/export")).status).toBe(200);
  });

  it("a wrong password is refused without ending the session, and counts toward the sign-in limit", async () => {
    const c = await loggedIn();
    await ageConfirmations();
    const wrong = await c.call("/api/auth/confirm", { method: "POST", body: { password: "not-it" } });
    expect(wrong.status).toBe(403);
    expect(await code(wrong)).toBe("FORBIDDEN");
    expect((await c.call("/api/tasks")).status).toBe(200);
    expect((await c.call("/api/export")).status).toBe(403);
    for (let i = 0; i < 4; i++) await c.call("/api/auth/confirm", { method: "POST", body: { password: "not-it" } });
    const limited = await c.call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    expect(limited.status).toBe(429);
  });

  it("needs a session", async () => {
    const res = await client().call("/api/auth/confirm", { method: "POST", body: { password: password() } });
    expect(res.status).toBe(401);
  });

  it("confirming one session does not unlock another", async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    await ageConfirmations();
    expect((await a.call("/api/auth/confirm", { method: "POST", body: { password: password() } })).status).toBe(200);
    expect((await a.call("/api/export")).status).toBe(200);
    expect((await b.call("/api/export")).status).toBe(403);
  });
});

describe("access tokens expire", () => {
  it(`work for ${REMOTE_TOKEN_TTL_DAYS} days and then fail like a wrong token`, async () => {
    const c = await loggedIn();
    await c.call("/api/remote/status", { method: "PATCH", body: { enabled: true } });
    const { token } = await c.json("/api/remote/tokens", { method: "POST", body: { name: "laptop" } });
    const days = (Date.parse(token.expires_at) - Date.parse(token.created_at)) / 86400_000;
    expect(days).toBe(REMOTE_TOKEN_TTL_DAYS);
    const { tokens } = await c.json("/api/remote/tokens");
    expect(tokens[0].expires_at).toBe(token.expires_at);
    expect(JSON.stringify(tokens)).not.toContain(token.token);

    const bearer = client();
    const call = () => bearer.call("/api/tasks", { headers: { authorization: `Bearer ${token.token}` } });
    expect((await call()).status).toBe(200);
    await inAgent((a) => a.services.db.run(`UPDATE tal_remote_tokens SET expires_at = ? WHERE id = ?`, new Date(Date.now() - 1000).toISOString(), token.id));
    expect((await call()).status).toBe(401);
  });
});
