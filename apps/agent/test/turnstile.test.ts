import { hashPassword } from "@talorys/shared";
import { afterEach, describe, expect, it } from "vitest";
import { clientKey } from "../src/api/middleware";
import { type AuthChecks, AuthService, HUMAN_CHECK_GLOBAL_FAILURES, MAX_FAILURES_PER_CLIENT, MAX_HUMAN_CHECK_FAILURES } from "../src/auth/auth-service";
import { type HumanCheck, type HumanCheckResult, TURNSTILE_VERIFY_URL, turnstile } from "../src/auth/turnstile";
import type { TalorysAgent } from "../src/agent/talorys-agent";
import { client, freshIp, inAgent, password } from "./helpers";

const SESSION_SECRET = "test-session-secret-0123456789abcdefghijklmnop";
const PASSWORD = "Sunny-Garden-Path-42";
const SITE_KEY = "1x00000000000000000000AA";
const SECRET = "1x0000000000000000000000000000000AA";

/** A check that answers `result` and remembers each token it was given. */
function fakeHuman(result: HumanCheckResult = "ok"): HumanCheck & { tokens: (string | undefined)[] } {
  const tokens: (string | undefined)[] = [];
  return {
    siteKey: SITE_KEY,
    tokens,
    async verify(token) {
      tokens.push(token);
      return token ? result : "failed";
    },
  };
}

function service(agent: TalorysAgent, passwordHash: string, checks: AuthChecks): AuthService {
  return new AuthService(agent.services.db, agent.services.settings, { sessionSecret: SESSION_SECRET, passwordHash }, () => {}, () => {}, checks);
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return { code: (err as { code?: string }).code, details: (err as { details?: unknown }).details };
  }
  throw new Error("expected a failure");
};

const failures = (agent: TalorysAgent, network: string) =>
  agent.services.db.one<{ n: number }>(`SELECT count(*) AS n FROM tal_login_attempts WHERE success = 0 AND client = ?`, network)!.n;

afterEach(() =>
  inAgent((agent) => {
    for (const key of ["auth.secret_fingerprint", "auth.password_override", "auth.password_change_required"]) agent.services.settings.delete(key);
    agent.services.db.run(`DELETE FROM tal_login_attempts`);
  }),
);

describe("siteverify", () => {
  const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

  it("is off without both keys, or with a malformed one", () => {
    expect(turnstile(undefined, SECRET)).toBeUndefined();
    expect(turnstile(SITE_KEY, "")).toBeUndefined();
    expect(turnstile("short", SECRET)).toBeUndefined();
    expect(turnstile(SITE_KEY, "has spaces in it, so no")).toBeUndefined();
    expect(turnstile(` ${SITE_KEY} `, SECRET)?.siteKey).toBe(SITE_KEY);
  });

  it("sends the secret, the token and the visitor's IP, and accepts only the login action", async () => {
    let sent: { url: string; form: FormData } | null = null;
    const check = turnstile(SITE_KEY, SECRET, [], async (input, init) => {
      sent = { url: String(input), form: init!.body as FormData };
      return new Response(JSON.stringify({ success: true, action: "login", hostname: "talorys.exemplo.com.br" }));
    })!;
    expect(await check.verify("token-1", "203.0.113.9")).toBe("ok");
    expect(sent!.url).toBe(TURNSTILE_VERIFY_URL);
    expect(sent!.form.get("secret")).toBe(SECRET);
    expect(sent!.form.get("response")).toBe("token-1");
    expect(sent!.form.get("remoteip")).toBe("203.0.113.9");

    expect(await turnstile(SITE_KEY, SECRET, [], answer({ success: true, action: "signup" }))!.verify("t", undefined)).toBe("failed");
    expect(await turnstile(SITE_KEY, SECRET, [], answer({ success: false, "error-codes": ["timeout-or-duplicate"] }))!.verify("t", undefined)).toBe("failed");
  });

  it("with allowed hosts, refuses a token solved on another site", async () => {
    const hosts = ["talorys.exemplo.com.br"];
    expect(await turnstile(SITE_KEY, SECRET, hosts, answer({ success: true, action: "login", hostname: "Talorys.Exemplo.com.br" }))!.verify("t", undefined)).toBe("ok");
    expect(await turnstile(SITE_KEY, SECRET, hosts, answer({ success: true, action: "login", hostname: "outro.exemplo.com.br" }))!.verify("t", undefined)).toBe("failed");
    expect(await turnstile(SITE_KEY, SECRET, hosts, answer({ success: true, action: "login" }))!.verify("t", undefined)).toBe("failed");
  });

  it("treats a reply that isn't an object as Cloudflare's trouble", async () => {
    expect(await turnstile(SITE_KEY, SECRET, [], answer(null))!.verify("t", undefined)).toBe("unavailable");
    expect(await turnstile(SITE_KEY, SECRET, [], answer("ok"))!.verify("t", undefined)).toBe("unavailable");
  });

  it("never asks Cloudflare about a missing or oversized token", async () => {
    let calls = 0;
    const check = turnstile(SITE_KEY, SECRET, [], async () => {
      calls++;
      return new Response("{}");
    })!;
    expect(await check.verify(undefined, undefined)).toBe("failed");
    expect(await check.verify("", undefined)).toBe("failed");
    expect(await check.verify("x".repeat(2049), undefined)).toBe("failed");
    expect(calls).toBe(0);
  });

  it("tells Cloudflare's own trouble apart from a wrong answer", async () => {
    expect(await turnstile(SITE_KEY, SECRET, [], answer({}, 500))!.verify("t", undefined)).toBe("unavailable");
    expect(await turnstile(SITE_KEY, SECRET, [], answer({ success: false, "error-codes": ["internal-error"] }))!.verify("t", undefined)).toBe("unavailable");
    const down = turnstile(SITE_KEY, SECRET, [], async () => {
      throw new TypeError("network");
    })!;
    expect(await down.verify("t", undefined)).toBe("unavailable");
  });
});

describe("when sign-in asks for the robot check", () => {
  it("never on a clean network, and from the first failure on", async () => {
    await inAgent(async (agent) => {
      const human = fakeHuman();
      const auth = service(agent, await hashPassword(PASSWORD), { human });
      const network = clientKey(freshIp());
      expect(auth.humanCheck(network)).toEqual({ site_key: SITE_KEY, required: false });
      // A clean sign-in: no check at all.
      await auth.login(PASSWORD, network, "t");
      expect(human.tokens).toEqual([]);

      // A wrong password says the next try needs it.
      expect(await failure(auth.login("wrong-password-123456", network, "t"))).toEqual({
        code: "UNAUTHORIZED",
        details: { human_check: "required", site_key: SITE_KEY },
      });
      expect(auth.humanCheckRequired(network)).toBe(true);

      // Without the token the password is not even tried, and the try doesn't count as a guess.
      const before = failures(agent, network);
      expect(await failure(auth.login(PASSWORD, network, "t"))).toEqual({
        code: "HUMAN_CHECK_REQUIRED",
        details: { human_check: "required", site_key: SITE_KEY },
      });
      expect(failures(agent, network)).toBe(before);

      // With a solved check it goes through.
      const signed = await auth.login(PASSWORD, network, "t", undefined, { token: "solved", ip: "203.0.113.9" });
      expect(signed.token).toBeTruthy();
      expect(human.tokens).toEqual([undefined, "solved"]);
    });
  });

  it("says when the answer was wrong, and when Cloudflare didn't answer", async () => {
    await inAgent(async (agent) => {
      const hash = await hashPassword(PASSWORD);
      const network = clientKey(freshIp());
      await failure(service(agent, hash, { human: fakeHuman() }).login("wrong-password-123456", network, "t"));
      expect(await failure(service(agent, hash, { human: fakeHuman("failed") }).login(PASSWORD, network, "t", undefined, { token: "bad" }))).toEqual({
        code: "HUMAN_CHECK_REQUIRED",
        details: { human_check: "failed", site_key: SITE_KEY },
      });
      expect(await failure(service(agent, hash, { human: fakeHuman("unavailable") }).login(PASSWORD, network, "t", undefined, { token: "t" }))).toEqual({
        code: "SERVICE_UNAVAILABLE",
        details: { human_check: "unavailable", site_key: SITE_KEY },
      });
    });
  });

  it("during an attack, asks every network the owner hasn't used, but not their own", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, await hashPassword(PASSWORD), { human: fakeHuman() });
      const home = clientKey(freshIp());
      agent.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 1, ?)`, home, Date.now() - 3600_000);
      for (let i = 0; i < HUMAN_CHECK_GLOBAL_FAILURES; i++) {
        agent.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 0, ?)`, `bot-${i}`, Date.now());
      }
      const stranger = clientKey(freshIp());
      expect(auth.humanCheckRequired(stranger)).toBe(true);
      expect((await failure(auth.login(PASSWORD, stranger, "t"))).code).toBe("HUMAN_CHECK_REQUIRED");
      expect(auth.humanCheckRequired(home)).toBe(false);
      expect((await auth.login(PASSWORD, home, "t")).token).toBeTruthy();
    });
  });

  it("puts the rate limit first: a blocked network is told to wait, not to solve the check", async () => {
    await inAgent(async (agent) => {
      const human = fakeHuman();
      const auth = service(agent, await hashPassword(PASSWORD), { human });
      const network = clientKey(freshIp());
      for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) {
        agent.services.db.run(`INSERT INTO tal_login_attempts (client, success, at) VALUES (?, 0, ?)`, network, Date.now());
      }
      expect((await failure(auth.login(PASSWORD, network, "t", undefined, { token: "solved" }))).code).toBe("RATE_LIMITED");
      expect(human.tokens).toEqual([]);
    });
  });

  it("tells a network that keeps sending refused checks to wait, like any blocked network", async () => {
    await inAgent(async (agent) => {
      const human = fakeHuman("failed");
      const auth = service(agent, await hashPassword(PASSWORD), { human });
      const network = clientKey(freshIp());
      await failure(auth.login("wrong-password-123456", network, "t"));
      for (let i = 0; i < MAX_HUMAN_CHECK_FAILURES; i++) {
        expect((await failure(auth.login(PASSWORD, network, "t", undefined, i % 2 ? { token: "junk" } : {}))).code).toBe("HUMAN_CHECK_REQUIRED");
      }
      const asked = human.tokens.length;
      const blocked = await failure(auth.login(PASSWORD, network, "t", undefined, { token: "junk" }));
      expect(blocked.code).toBe("RATE_LIMITED");
      expect((blocked.details as { retry_after: number }).retry_after).toBeGreaterThan(800);
      // Blocked before siteverify: no more calls to Cloudflare.
      expect(human.tokens.length).toBe(asked);
      // None of those were password guesses.
      expect(failures(agent, network)).toBe(1);
    });
  });

  it("checks again when the attempt is counted, so parallel tries from a clean network get one guess", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, await hashPassword(PASSWORD), { human: fakeHuman() });
      const network = clientKey(freshIp());
      const results = await Promise.all([1, 2, 3].map((i) => failure(auth.login(`wrong-password-12345${i}`, network, "t"))));
      expect(results.map((r) => r.code).sort()).toEqual(["HUMAN_CHECK_REQUIRED", "HUMAN_CHECK_REQUIRED", "UNAUTHORIZED"]);
      expect(failures(agent, network)).toBe(1);
    });
  });

  it("is off without Turnstile: no field, no check", async () => {
    await inAgent(async (agent) => {
      const auth = service(agent, await hashPassword(PASSWORD), {});
      const network = clientKey(freshIp());
      expect(auth.humanCheck(network)).toBeUndefined();
      expect(await failure(auth.login("wrong-password-123456", network, "t"))).toEqual({ code: "UNAUTHORIZED", details: undefined });
      expect((await auth.login(PASSWORD, network, "t")).token).toBeTruthy();
    });
  });
});

describe("the sign-in API with Turnstile on", () => {
  type Checks = { checks: AuthChecks };
  afterEach(() =>
    inAgent((agent) => {
      delete (agent.services.auth as unknown as Checks).checks.human;
    }),
  );

  it("tells the form when to show the check, refuses a try without it and records the refusal", async () => {
    await inAgent((agent) => {
      (agent.services.auth as unknown as Checks).checks.human = fakeHuman();
    });
    const browser = client();
    expect((await browser.json("/api/auth/session")).human_check).toEqual({ site_key: SITE_KEY, required: false });

    const wrong = await browser.call("/api/auth/login", { method: "POST", body: { password: "wrong-password-123456" } });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { details: unknown } }).error.details).toEqual({ human_check: "required", site_key: SITE_KEY });
    expect((await browser.json("/api/auth/session")).human_check).toEqual({ site_key: SITE_KEY, required: true });

    const refused = await browser.call("/api/auth/login", { method: "POST", body: { password: password() } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("HUMAN_CHECK_REQUIRED");
    const logged = await inAgent((agent) =>
      agent.services.db.one<{ kind: string; reason: string }>(`SELECT kind, reason FROM tal_auth_events WHERE ip = ? ORDER BY id DESC LIMIT 1`, browser.ip),
    );
    expect(logged).toEqual({ kind: "login_human_check", reason: "required" });

    const ok = await browser.call("/api/auth/login", { method: "POST", body: { password: password(), turnstile_token: "solved" } });
    expect(ok.status).toBe(200);
    // Signed in, the session says nothing about the check.
    expect((await browser.json("/api/auth/session")).human_check).toBeUndefined();
  });
});
