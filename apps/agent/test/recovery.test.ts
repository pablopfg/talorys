import { RECOVERY_EMAILS_PER_DAY, RECOVERY_LINK_TTL_MS, RECOVERY_MAX_ATTEMPTS, RECOVERY_REQUESTS_PER_CLIENT, hashPassword, totpCode, totpStep } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { clientKey } from "../src/api/middleware";
import { type AuthChecks, AuthService } from "../src/auth/auth-service";
import type { HumanCheck } from "../src/auth/turnstile";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { client, freshIp, inAgent, password } from "./helpers";

const SESSION_SECRET = "test-session-secret-0123456789abcdefghijklmnop";
const PASSWORD = "Sunny-Garden-Path-42";
const NEW_PASSWORD = "Quiet-River-Lantern-Moss-73";
const OWNER = "dono@exemplo.com.br";
const APP = "https://talorys.exemplo.com.br/";

/** A recovery sender that keeps the links it was asked to send. */
function mailbox(room = () => true) {
  const links: string[] = [];
  const send = (link: string) => {
    links.push(link);
  };
  return { links, recovery: { appUrl: APP, address: OWNER, room, send } };
}

const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

function service(agent: TalorysAgent, passwordHash: string, checks: AuthChecks, ownerEmail: string | undefined = OWNER): AuthService {
  return new AuthService(agent.services.db, agent.services.settings, { sessionSecret: SESSION_SECRET, passwordHash, ownerEmail }, () => {}, () => {}, checks);
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return { code: (err as { code?: string }).code, message: (err as Error).message, details: (err as { details?: Record<string, unknown> }).details };
  }
  throw new Error("expected a failure");
};

const failedSignIns = (agent: TalorysAgent, network: string) =>
  agent.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_login_attempts WHERE success = 0 AND client = ?`, network)!.n;

afterEach(() =>
  inAgent((agent) => {
    for (const key of ["auth.secret_fingerprint", "auth.password_override", "auth.password_change_required", "auth.recovery", "auth.recovery_sent"]) {
      agent.services.settings.delete(key);
    }
    agent.services.auth.mfa.disable();
    agent.services.db.run(`DELETE FROM tal_login_attempts`);
  }),
);

describe("asking for the link", () => {
  it("sends a one-time link to the app's own address only when the e-mail is the owner's", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      expect(auth.recoveryAvailable()).toBe(true);
      expect(await auth.requestRecovery("alguem@exemplo.com.br", clientKey(freshIp()))).toBe("wrong_email");
      expect(box.links).toEqual([]);
      expect(await auth.requestRecovery(" Dono@Exemplo.com.br ", clientKey(freshIp()))).toBe("sent");
      expect(box.links).toHaveLength(1);
      expect(box.links[0]).toMatch(/^https:\/\/talorys\.exemplo\.com\.br\/recover#[A-Za-z0-9_-]{43}$/);
      // Only a keyed hash of the token is stored.
      expect(JSON.stringify(agent.services.settings.getJson("auth.recovery"))).not.toContain(tokenOf(box.links[0]!));
    });
  });

  it("is off without e-mail set up", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, await hashPassword(PASSWORD), {});
      expect(auth.recoveryAvailable()).toBe(false);
      expect((await failure(auth.requestRecovery(OWNER, clientKey(freshIp())))).code).toBe("NOT_CONFIGURED");
    });
  });

  it("limits requests per network and e-mails per day", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      const network = clientKey(freshIp());
      for (let i = 0; i < RECOVERY_REQUESTS_PER_CLIENT; i++) await auth.requestRecovery("alguem@exemplo.com.br", network);
      expect((await failure(auth.requestRecovery(OWNER, network))).code).toBe("RATE_LIMITED");
      // A request is never a password guess.
      expect(failedSignIns(agent, network)).toBe(0);

      for (let i = 0; i < RECOVERY_EMAILS_PER_DAY; i++) expect(await auth.requestRecovery(OWNER, clientKey(freshIp()))).toBe("sent");
      expect(await auth.requestRecovery(OWNER, clientKey(freshIp()))).toBe("daily_limit");
      expect(box.links).toHaveLength(RECOVERY_EMAILS_PER_DAY);
    });
  });

  it("keeps the last link when the e-mail can't go out", async () => {
    await inAgent(async (agent) => {
      let room = true;
      const box = mailbox(() => room);
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      expect(await auth.requestRecovery(OWNER, clientKey(freshIp()))).toBe("sent");
      room = false;
      expect(await auth.requestRecovery(OWNER, clientKey(freshIp()))).toBe("daily_limit");
      expect(box.links).toHaveLength(1);
      expect(await auth.completeRecovery(tokenOf(box.links[0]!), NEW_PASSWORD, undefined, clientKey(freshIp()))).toEqual({ factor: null });
    });
  });

  it("with Turnstile on, asks every request for it", async () => {
    await inAgent(async (agent) => {
      const actions: (string | undefined)[] = [];
      const human: HumanCheck = {
        siteKey: "1x00000000000000000000AA",
        async verify(token, _ip, action) {
          actions.push(action);
          return token ? "ok" : "failed";
        },
      };
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery, human });
      expect((await failure(auth.requestRecovery(OWNER, clientKey(freshIp())))).code).toBe("HUMAN_CHECK_REQUIRED");
      expect(await auth.requestRecovery(OWNER, clientKey(freshIp()), { token: "solved" })).toBe("sent");
      expect(actions).toEqual(["recovery", "recovery"]);
      expect(box.links).toHaveLength(1);
    });
  });
});

describe("using the link", () => {
  it("sets the new password once, and every session and access token ends", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      const { sessionId } = await auth.createSession("old browser");
      await auth.requestRecovery(OWNER, clientKey(freshIp()));
      const token = tokenOf(box.links[0]!);
      const network = clientKey(freshIp());

      expect(await auth.completeRecovery(token, NEW_PASSWORD, undefined, network)).toEqual({ factor: null });
      expect(agent.services.db.one(`SELECT id FROM tal_sessions WHERE id = ?`, sessionId)).toBeNull();
      expect((await failure(auth.login(PASSWORD, clientKey(freshIp()), "t", OWNER))).code).toBe("UNAUTHORIZED");
      expect((await auth.login(NEW_PASSWORD, clientKey(freshIp()), "t", OWNER)).token).toBeTruthy();

      expect(await failure(auth.completeRecovery(token, "Another-Strong-Phrase-Here-9", undefined, clientKey(freshIp())))).toMatchObject({
        code: "UNAUTHORIZED",
        details: { recovery: "expired" },
      });
    });
  });

  it("refuses a wrong, replaced or expired link, and a weak password", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      await auth.requestRecovery(OWNER, clientKey(freshIp()));
      await auth.requestRecovery(OWNER, clientKey(freshIp()));
      const [first, second] = box.links.map(tokenOf);
      const expired = { code: "UNAUTHORIZED", details: { recovery: "expired" } };
      // A wrong token is a failed sign-in: the same per-network limit applies.
      const guesser = clientKey(freshIp());
      expect(await failure(auth.completeRecovery("x".repeat(43), NEW_PASSWORD, undefined, guesser))).toMatchObject(expired);
      expect(failedSignIns(agent, guesser)).toBe(1);
      // Only the latest e-mail works.
      expect(await failure(auth.completeRecovery(first!, NEW_PASSWORD, undefined, clientKey(freshIp())))).toMatchObject(expired);
      // A refused password costs nothing: not a failed sign-in, not one of the link's tries.
      const typo = clientKey(freshIp());
      expect((await failure(auth.completeRecovery(second!, "short", undefined, typo))).code).toBe("VALIDATION_ERROR");
      expect(failedSignIns(agent, typo)).toBe(0);
      expect(agent.services.settings.getJson<{ attempts: number }>("auth.recovery")!.attempts).toBe(0);

      const link = agent.services.settings.getJson<{ expires_at: number }>("auth.recovery")!;
      agent.services.settings.setJson("auth.recovery", { ...link, expires_at: Date.now() - 1 });
      expect(await failure(auth.completeRecovery(second!, NEW_PASSWORD, undefined, clientKey(freshIp())))).toMatchObject(expired);
      expect(agent.services.settings.getJson("auth.recovery")).toBeNull();
      expect(RECOVERY_LINK_TTL_MS).toBe(30 * 60_000);
    });
  });

  it("with two-step sign-in on, asks for a code after the link checks out", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      const { secret } = await auth.mfa.beginSetup("Talorys");
      const recoveryCodes = (await auth.mfa.enable(await totpCode(secret, totpStep())))!;
      await auth.requestRecovery(OWNER, clientKey(freshIp()));
      const token = tokenOf(box.links[0]!);
      const network = clientKey(freshIp());

      // The code step is a step, not a failed sign-in.
      expect(await failure(auth.completeRecovery(token, NEW_PASSWORD, undefined, network))).toMatchObject({
        code: "UNAUTHORIZED",
        details: { recovery: "code_required" },
      });
      expect(failedSignIns(agent, network)).toBe(0);
      // A weak password is refused before the code is checked, so no recovery code is spent on it.
      expect((await failure(auth.completeRecovery(token, "short", recoveryCodes[0], network))).code).toBe("VALIDATION_ERROR");
      expect(auth.mfa.status().recovery_codes_left).toBe(10);
      expect(await failure(auth.completeRecovery(token, NEW_PASSWORD, "000000", network))).toMatchObject({ details: { recovery: "code_required" } });

      expect(await auth.completeRecovery(token, NEW_PASSWORD, recoveryCodes[0], network)).toEqual({ factor: "recovery_code" });
      expect(auth.mfa.enabled()).toBe(true);
      expect(auth.mfa.status().recovery_codes_left).toBe(9);
    });
  });

  it("stops working once the password is reset from the command line", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      await service(agent, await hashPassword(PASSWORD), { recovery: box.recovery }).requestRecovery(OWNER, clientKey(freshIp()));
      const reset = service(agent, await hashPassword(NEW_PASSWORD), { recovery: box.recovery });
      expect(await failure(reset.completeRecovery(tokenOf(box.links[0]!), "Another-Strong-Phrase-Here-9", undefined, clientKey(freshIp())))).toMatchObject({
        details: { recovery: "expired" },
      });
    });
  });

  it("stops working after too many tries", async () => {
    await inAgent(async (agent) => {
      const box = mailbox();
      const auth = service(agent, await hashPassword(PASSWORD), { recovery: box.recovery });
      const { secret } = await auth.mfa.beginSetup("Talorys");
      await auth.mfa.enable(await totpCode(secret, totpStep()));
      await auth.requestRecovery(OWNER, clientKey(freshIp()));
      const token = tokenOf(box.links[0]!);
      for (let i = 1; i < RECOVERY_MAX_ATTEMPTS; i++) {
        expect((await failure(auth.completeRecovery(token, NEW_PASSWORD, "000000", clientKey(freshIp())))).details?.recovery).toBe("code_required");
      }
      expect((await failure(auth.completeRecovery(token, NEW_PASSWORD, "000000", clientKey(freshIp())))).details?.recovery).toBe("expired");
      expect(agent.services.settings.getJson("auth.recovery")).toBeNull();
    });
  });
});

describe("the recovery API", () => {
  type Checks = { checks: AuthChecks };
  afterEach(() =>
    inAgent((agent) => {
      delete (agent.services.auth as unknown as Checks).checks.recovery;
      agent.services.db.run(`DELETE FROM tal_notifications`);
    }),
  );

  it("answers the same way whatever the address, and resets the password from the link", async () => {
    const box = mailbox();
    await inAgent((agent) => {
      (agent.services.auth as unknown as Checks).checks.recovery = box.recovery;
    });
    const browser = client();
    expect((await browser.json("/api/auth/session")).recovery).toBe(true);
    const ask = await browser.call("/api/auth/recovery", { method: "POST", body: { email: OWNER } });
    expect(ask.status).toBe(200);
    expect(await ask.json()).toEqual({ requested: true });
    expect(box.links).toHaveLength(1);

    const done = await browser.call("/api/auth/recovery/complete", { method: "POST", body: { token: tokenOf(box.links[0]!), new_password: NEW_PASSWORD } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ reset: true });
    expect((await client().call("/api/auth/login", { method: "POST", body: { password: password() } })).status).toBe(401);
    expect((await client().call("/api/auth/login", { method: "POST", body: { password: NEW_PASSWORD } })).status).toBe(200);

    const { kinds, alert } = await inAgent((agent) => ({
      kinds: agent.services.db.all<{ kind: string; reason: string }>(`SELECT kind, reason FROM tal_auth_events WHERE ip = ? ORDER BY id`, browser.ip),
      alert: agent.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_notifications WHERE title = 'Password reset by e-mail'`)!.n,
    }));
    expect(kinds).toEqual([
      { kind: "recovery_requested", reason: "sent" },
      { kind: "password_reset", reason: "link" },
    ]);
    expect(alert).toBe(1);
  });
});
