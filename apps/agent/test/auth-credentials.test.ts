import { hashPassword, isBreachedPassword, isPepperedHash } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthChecks, type AuthSecrets, AuthService, MAX_FAILURES_PER_CLIENT } from "../src/auth/auth-service";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { client, freshIp, inAgent, loggedIn } from "./helpers";

const SESSION_SECRET = "test-session-secret-0123456789abcdefghijklmnop";
const PEPPER = "test-pepper-0123456789abcdefghijklmnopqrstuv";
const PASSWORD = "Sunny-Garden-Path-42";

/** An AuthService over the test agent's storage, starting from a clean credential state. */
function service(agent: TalorysAgent, secrets: AuthSecrets, alerts: string[] = [], checks: AuthChecks = {}): AuthService {
  return new AuthService(agent.services.db, agent.services.settings, { sessionSecret: SESSION_SECRET, ...secrets }, (title) => alerts.push(title), () => {}, checks);
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  }
  throw new Error("expected a failure");
};

afterEach(() =>
  inAgent((agent) => {
    for (const key of ["auth.secret_fingerprint", "auth.password_override", "auth.password_change_required"]) agent.services.settings.delete(key);
    agent.services.db.run(`DELETE FROM tal_login_attempts`);
  }),
);

describe("e-mail and password (OWNER_EMAIL)", () => {
  it("asks for the address only when it is set, and never says which part was wrong", async () => {
    await inAgent(async (agent) => {
      const plain = service(agent, { passwordHash: await hashPassword(PASSWORD) });
      expect(plain.emailRequired()).toBe(false);
      expect(await failure(plain.login("wrong-password-123456", freshIp(), "t"))).toEqual({ code: "UNAUTHORIZED", message: "Incorrect password." });

      const auth = service(agent, { passwordHash: await hashPassword(PASSWORD), ownerEmail: "Owner@Example.com" });
      expect(auth.emailRequired()).toBe(true);
      const wrong = { code: "UNAUTHORIZED", message: "Incorrect email or password." };
      expect(await failure(auth.login(PASSWORD, freshIp(), "t"))).toEqual(wrong);
      expect(await failure(auth.login(PASSWORD, freshIp(), "t", "someone@example.com"))).toEqual(wrong);
      expect(await failure(auth.login("wrong-password-123456", freshIp(), "t", "owner@example.com"))).toEqual(wrong);
      expect((await auth.login(PASSWORD, freshIp(), "t", "  OWNER@example.com ")).token).toBeTruthy();
    });
  });

  it("a wrong address counts as a failed attempt", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, { passwordHash: await hashPassword(PASSWORD), ownerEmail: "owner@example.com" });
      const ip = freshIp();
      for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) expect((await failure(auth.login(PASSWORD, ip, "t", "other@example.com"))).code).toBe("UNAUTHORIZED");
      expect((await failure(auth.login(PASSWORD, ip, "t", "owner@example.com"))).code).toBe("RATE_LIMITED");
    });
  });

  it("the sign-in screen learns only whether to show the field", async () => {
    const body = await client().json("/api/auth/session");
    expect(body.email_required).toBe(false);
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("password pepper (PASSWORD_PEPPER)", () => {
  it("checks a peppered hash only with the pepper", async () => {
    await inAgent(async (agent) => {
      const hash = await hashPassword(PASSWORD, { pepper: PEPPER });
      expect((await service(agent, { passwordHash: hash, pepper: PEPPER }).login(PASSWORD, freshIp(), "t")).token).toBeTruthy();
      agent.services.settings.delete("auth.secret_fingerprint");
      expect((await failure(service(agent, { passwordHash: hash }).login(PASSWORD, freshIp(), "t"))).code).toBe("UNAUTHORIZED");
    });
  });

  it("a new pepper starts over: in-app password and sessions are dropped", async () => {
    await inAgent(async (agent) => {
      const hash = await hashPassword(PASSWORD);
      const before = service(agent, { passwordHash: hash });
      await before.login(PASSWORD, freshIp(), "t");
      agent.services.settings.setJson("auth.password_override", await hashPassword("Changed-in-the-app-1"));
      await service(agent, { passwordHash: hash, pepper: PEPPER }).validate("sync-the-fingerprint");
      expect(agent.services.settings.getJson("auth.password_override")).toBeNull();
      expect(agent.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_sessions`)?.n).toBe(0);
    });
  });

  it("a password changed in the app is stored with the pepper", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, { passwordHash: await hashPassword(PASSWORD, { pepper: PEPPER }), pepper: PEPPER });
      await auth.changePassword(PASSWORD, "A-brand-new-passphrase", freshIp());
      expect(isPepperedHash(agent.services.settings.getJson<string>("auth.password_override"))).toBe(true);
    });
  });
});

describe("new password rules", () => {
  it("refuses a breached password, and any password while the check can't answer", async () => {
    await inAgent(async (agent) => {
      const seen: string[] = [];
      const breached = (answer: boolean | null) => async (password: string) => {
        seen.push(password);
        return answer;
      };
      const hash = await hashPassword(PASSWORD);
      const refused = await failure(service(agent, { passwordHash: hash }, [], { breached: breached(true) }).changePassword(PASSWORD, "Correct-Horse-Battery", freshIp()));
      expect(refused).toEqual({ code: "VALIDATION_ERROR", message: "This password appeared in a known data breach. Choose another one." });
      const unknown = await failure(service(agent, { passwordHash: hash }, [], { breached: breached(null) }).changePassword(PASSWORD, "Correct-Horse-Battery", freshIp()));
      expect(unknown).toEqual({ code: "SERVICE_UNAVAILABLE", message: "Couldn't check the password against known breaches right now. Try again in a minute." });
      expect(agent.services.settings.getJson("auth.password_override")).toBeNull();
      await service(agent, { passwordHash: hash }, [], { breached: breached(false) }).changePassword(PASSWORD, "Correct-Horse-Battery", freshIp());
      expect(seen).toEqual(["Correct-Horse-Battery", "Correct-Horse-Battery", "Correct-Horse-Battery"]);
    });
  });

  it("asks the breach service with request options the Workers runtime accepts", async () => {
    let asked = "";
    // Building the Request here runs the runtime's own checks on the options (workerd refuses redirect: "error").
    const fetcher = (async (input: string, init?: RequestInit) => {
      asked = new Request(input, init).url;
      return new Response("0000000000000000000000000000000000A:0\r\n");
    }) as typeof fetch;
    expect(await isBreachedPassword("Correct-Horse-Battery", fetcher)).toBe(false);
    expect(asked).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
  });

  it("refuses predictable passwords however long, and the owner's own details", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, { passwordHash: await hashPassword(PASSWORD), ownerEmail: "maria.silva@example.com" });
      const predictable = "Too predictable: common words, sequences like 1234 and your own details don't count. Add more unrelated words.";
      for (const next of ["Senha@123456789", "P@ssw0rd-P@ssw0rd!", "qwertyuiop123456", "maria.silva-2026!!"]) {
        expect(await failure(auth.changePassword(PASSWORD, next, freshIp())), next).toEqual({ code: "VALIDATION_ERROR", message: predictable });
      }
      expect(await failure(auth.changePassword(PASSWORD, PASSWORD, freshIp()))).toEqual({
        code: "VALIDATION_ERROR",
        message: "Choose a password different from the current one.",
      });
    });
  });

  it("refuses a new password under 15 characters", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, { passwordHash: await hashPassword(PASSWORD) });
      expect(await failure(auth.changePassword(PASSWORD, "Short-pass-12", freshIp()))).toEqual({ code: "VALIDATION_ERROR", message: "Use at least 15 characters." });
    });
  });

  it("an OWNER_PASSWORD from the 10-character rule still signs in, but must be changed before anything else", async () => {
    await inAgent(async (agent) => {
      expect(service(agent, { password: "Old-rule-pw1" }).isConfigured()).toBe(true);
      expect(service(agent, { password: "short-pw1" }).isConfigured()).toBe(false);
      // The previous rule still holds for a plain secret: one kind of character or a common word is refused.
      expect(service(agent, { password: "abcdefghij" }).isConfigured()).toBe(false);
      expect(service(agent, { password: "password12" }).isConfigured()).toBe(false);
      const auth = service(agent, { password: "Old-rule-pw1" });
      await auth.login("Old-rule-pw1", freshIp(), "t");
      expect(auth.passwordChangeRequired()).toBe(true);
      await auth.changePassword("Old-rule-pw1", "Correct-Horse-Battery", freshIp());
      expect(auth.passwordChangeRequired()).toBe(false);
    });
  });

  it("while a change is required, the API answers only the password change and sign-out", async () => {
    const c = await loggedIn();
    await inAgent((agent) => agent.services.settings.setJson("auth.password_change_required", true));
    try {
      const blocked = await c.call("/api/tasks");
      expect(blocked.status).toBe(403);
      expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
      expect((await c.json("/api/auth/session")).password_change_required).toBe(true);
      expect((await c.call("/api/auth/heartbeat", { method: "POST", body: { active: false } })).status).toBe(200);
    } finally {
      await inAgent((agent) => agent.services.settings.delete("auth.password_change_required"));
    }
    expect((await c.call("/api/tasks")).status).toBe(200);
  });
});
