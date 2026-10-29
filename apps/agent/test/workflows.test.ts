import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowConfig, WorkflowKey } from "@talorys/shared";
import { bearer, inAgent, loggedIn } from "./helpers";
import { checkSite, type Network, parseFeed, plainText, readFeed, workflowUrl } from "../src/workflows/network";
import { WorkflowRepository } from "../src/workflows/repository";
import { WorkflowService } from "../src/workflows/service";

const SITE = "https://status.example.com/health";
const FEED = "https://blog.example.com/feed.xml";

const RSS = (items: [string, string][]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example &amp; Blog</title><link>https://blog.example.com/</link>
${items.map(([id, title]) => `<item><title><![CDATA[${title}]]></title><link>https://blog.example.com/${id}</link><guid isPermaLink="false">${id}</guid></item>`).join("\n")}
</channel></rss>`;

/** A network where every host resolves to a public address and `routes` answers by URL. */
function fakeNet(routes: Record<string, () => Response>, addresses: string[] = ["93.184.215.14"]): Network & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    development: false,
    resolve: async () => addresses,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const route = routes[url];
      if (!route) throw new TypeError("network down");
      return route();
    }) as typeof fetch,
  };
}

afterEach(() =>
  inAgent(async (a) => {
    for (const key of ["site_monitor", "feed_digest"] as const) {
      const row = new WorkflowRepository(a.services.db).get(key);
      if (row.schedule_id) await a.cancelSchedule(row.schedule_id);
    }
    a.services.db.run(`DELETE FROM tal_workflows`);
    a.services.db.run(`DELETE FROM tal_workflow_runs`);
    a.services.db.run(`DELETE FROM tal_notifications`);
  }),
);

describe("workflow addresses", () => {
  it("only public https:// addresses, without credentials", () => {
    expect(workflowUrl("https://example.com/x#frag", { development: false }).href).toBe("https://example.com/x");
    for (const bad of ["http://example.com", "ftp://example.com", "https://user:pw@example.com", "https://localhost", "https://10.0.0.1/", "https://[::1]/", "https://nas.local/", "https://intranet/", "not a url"]) {
      expect(() => workflowUrl(bad, { development: false }), bad).toThrow();
    }
  });

  it("a site is up below 400, a redirect included, and down otherwise", async () => {
    const net = fakeNet({
      [SITE]: () => new Response("ok"),
      "https://moved.example.com/": () => new Response(null, { status: 301, headers: { location: "http://10.0.0.1/" } }),
      "https://broken.example.com/": () => new Response("no", { status: 503 }),
    });
    expect(await checkSite(SITE, net)).toMatchObject({ ok: true, status: 200 });
    // The redirect is not followed: its target is never requested.
    expect(await checkSite("https://moved.example.com/", net)).toMatchObject({ ok: true, status: 301 });
    expect(net.calls).not.toContain("http://10.0.0.1/");
    await expect(checkSite("https://broken.example.com/", net)).rejects.toThrow("The site answered with status 503.");
    await expect(checkSite("https://nowhere.example.com/", net)).rejects.toThrow("Could not connect.");
  });

  it("refuses a public name that points to a private address", async () => {
    const net = fakeNet({ [SITE]: () => new Response("ok") }, ["192.168.0.10"]);
    await expect(checkSite(SITE, net)).rejects.toThrow("private network");
    expect(net.calls).toEqual([]);
  });
});

describe("feeds", () => {
  it("reads RSS and Atom", () => {
    const rss = parseFeed(RSS([["a1", "First <b>post</b>"], ["a2", "Second"]]));
    expect(rss).toEqual({
      title: "Example & Blog",
      items: [
        { id: "a1", title: "First post", link: "https://blog.example.com/a1" },
        { id: "a2", title: "Second", link: "https://blog.example.com/a2" },
      ],
    });
    const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Atom news</title>
      <entry><title>Hello &#233;t&#xE9;</title><link rel="self" href="https://x.example/self"/><link href="https://x.example/1"/><id>urn:1</id></entry>
      <entry><title>Bad link</title><link href="javascript:alert(1)"/><id>urn:2</id></entry></feed>`);
    expect(atom).toEqual({
      title: "Atom news",
      items: [
        { id: "urn:1", title: "Hello été", link: "https://x.example/1" },
        { id: "urn:2", title: "Bad link", link: null },
      ],
    });
    expect(parseFeed("<html><body>not a feed</body></html>")).toBeNull();
    // Characters that change length when lower-cased don't shift what is read.
    expect(parseFeed(RSS([["i1", "İstanbul İİİ"]]))!.items[0]).toEqual({ id: "i1", title: "İstanbul İİİ", link: "https://blog.example.com/i1" });
  });

  it("stays fast on hostile input", () => {
    const started = Date.now();
    parseFeed(`<rss>${"<item><title>".repeat(40_000)}`);
    parseFeed(`<rss>${"<itemx".repeat(87_000)}>`);
    parseFeed(`<rss><item><title>${"<![CDATA[".repeat(50_000)}</title></item>`);
    parseFeed(`<feed>${`<entry><link ${' href="a'.repeat(250)}></entry>`.repeat(50)}`);
    plainText(`${"<".repeat(100_000)}${"&#99999999;".repeat(10_000)}`);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("follows a redirect only to another public https:// address", async () => {
    const net = fakeNet({
      [FEED]: () => new Response(null, { status: 301, headers: { location: "https://cdn.example.com/feed" } }),
      "https://cdn.example.com/feed": () => new Response(RSS([["a1", "One"]])),
      "https://evil.example.com/feed": () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }),
    });
    const read = await readFeed(FEED, net);
    expect(read).toMatchObject({ ok: true, title: "Example & Blog" });
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.id).toMatch(/^[0-9a-f]{16}$/);
    await expect(readFeed("https://evil.example.com/feed", net)).rejects.toThrow("redirected to a place workflows can't reach");
    expect(net.calls).not.toContain("https://169.254.169.254/latest");
  });
});

/** The service with a fake launcher and timer, on the agent's real database. */
function service(a: Parameters<Parameters<typeof inAgent>[0]>[0], opts: { available?: boolean } = {}) {
  const started: { key: WorkflowKey; runId: string; config: WorkflowConfig }[] = [];
  const alarms = new Map<string, Date>();
  const svc = new WorkflowService(
    new WorkflowRepository(a.services.db),
    a.services.settings,
    a.services.activity,
    a.services.alerts,
    {
      schedule: async (at, key) => {
        const id = `alarm-${key}-${alarms.size}`;
        alarms.set(id, at);
        return id;
      },
      cancel: async (id) => void alarms.delete(id),
      exists: async (id) => alarms.has(id),
    },
    {
      available: () => opts.available ?? true,
      start: async (key, runId, config) => void started.push({ key, runId, config }),
      forget: () => {},
    },
    false,
  );
  return { svc, started, alarms };
}

describe("workflow service", () => {
  it("can't be turned on without addresses, schedules one alarm, and turning off clears it", async () => {
    await inAgent(async (a) => {
      const { svc, alarms } = service(a);
      await expect(svc.update("site_monitor", { enabled: true })).rejects.toThrow("Add at least one site");
      await expect(svc.update("site_monitor", { config: { urls: ["https://10.1.2.3/"] } })).rejects.toThrow("private");
      const on = await svc.update("site_monitor", { enabled: true, config: { urls: [SITE] } });
      expect(on.enabled).toBe(true);
      expect(on.next_run).not.toBeNull();
      expect(alarms.size).toBe(1);
      const off = await svc.update("site_monitor", { enabled: false });
      expect(off.next_run).toBeNull();
      expect(alarms.size).toBe(0);
    });
  });

  it("is refused on a deployment without the Workflows binding", async () => {
    await inAgent(async (a) => {
      const { svc } = service(a, { available: false });
      await expect(svc.update("feed_digest", { enabled: true, config: { feeds: [FEED], max_items: 5 } })).rejects.toThrow("not set up");
    });
  });

  it("alerts once after two failed checks, and again when the site is back", async () => {
    await inAgent(async (a) => {
      const { svc, started } = service(a);
      await svc.update("site_monitor", { config: { urls: [SITE] } });
      const repo = new WorkflowRepository(a.services.db);
      const first = await svc.runNow("site_monitor");
      expect(started).toEqual([{ key: "site_monitor", runId: first.id, config: { urls: [SITE] } }]);
      await expect(svc.runNow("site_monitor")).rejects.toThrow("Wait");
      const down = { url: SITE, ok: false, status: 503, reason: "The site answered with status 503.", ms: null };
      const up = { url: SITE, ok: true, status: 200, reason: null, ms: 10 };
      const report = (check: typeof down | typeof up, runId = repo.startRun("site_monitor", "schedule").id) => {
        svc.report(runId, { key: "site_monitor", checks: [check] });
        return repo.run(runId)!;
      };
      const titles = () => a.services.notifications.list({ limit: 20 }).map((n) => n.title);
      expect(report(down, first.id).status).toBe("success");
      expect(titles()).toEqual([]);
      expect(report(down).result).toBe("0 of 1 sites up");
      expect(titles()).toEqual(["Site down: status.example.com"]);
      report(down);
      expect(titles()).toHaveLength(1);
      expect(report(up).result).toBe("1 of 1 sites up");
      expect(titles()[0]).toBe("Site back up: status.example.com");
    });
  });

  it("learns a feed on its first read and then announces only new items", async () => {
    await inAgent(async (a) => {
      const { svc } = service(a);
      await svc.update("feed_digest", { config: { feeds: [FEED], max_items: 1 } });
      const repo = new WorkflowRepository(a.services.db);
      const report = (ids: string[]) => {
        const run = repo.startRun("feed_digest", "schedule");
        svc.report(run.id, {
          key: "feed_digest",
          feeds: [{ url: FEED, ok: true, title: "Blog", items: ids.map((id) => ({ id, title: `Post ${id} https://evil.example/x`, link: `https://blog.example.com/${id}` })), reason: null }],
        });
        return repo.run(run.id)!;
      };
      expect(report(["a", "b"]).result).toBe("0 new item(s)\n1 feed(s) read for the first time");
      expect(a.services.notifications.list({ limit: 5 })).toEqual([]);
      expect(report(["c", "d", "a", "b"]).result).toBe("2 new item(s)");
      const [n] = a.services.notifications.list({ limit: 5 });
      expect(n!.title).toBe("New in your feeds");
      expect(n!.body.split("\n")).toHaveLength(2);
      expect(n!.body).toContain("And 1 more.");
      // Links in feed text can't be clicked anywhere.
      expect(n!.body).not.toMatch(/https?:\/\//);
      expect(report(["c", "d", "a", "b"]).result).toBe("0 new item(s)");
    });
  });

  it("a feed that failed on its first read still only learns on its first good read", async () => {
    await inAgent(async (a) => {
      const { svc } = service(a);
      await svc.update("feed_digest", { config: { feeds: [FEED], max_items: 5 } });
      const repo = new WorkflowRepository(a.services.db);
      const run = (feed: { ok: boolean; ids: string[] }) => {
        const r = repo.startRun("feed_digest", "schedule");
        svc.report(r.id, { key: "feed_digest", feeds: [{ url: FEED, ok: feed.ok, title: "Blog", items: feed.ids.map((id) => ({ id, title: id, link: null })), reason: feed.ok ? null : "Could not connect." }] });
        return repo.run(r.id)!.result;
      };
      expect(run({ ok: false, ids: [] })).toBe("0 new item(s)\n1 feed(s) could not be read");
      expect(run({ ok: true, ids: ["a", "b", "c"] })).toBe("0 new item(s)\n1 feed(s) read for the first time");
      expect(a.services.notifications.list({ limit: 5 })).toEqual([]);
    });
  });

  it("a late, repeated or foreign report changes nothing", async () => {
    await inAgent(async (a) => {
      const { svc } = service(a);
      await svc.update("site_monitor", { config: { urls: [SITE] } });
      const repo = new WorkflowRepository(a.services.db);
      const run = repo.startRun("site_monitor", "schedule");
      svc.report(run.id, { key: "feed_digest", feeds: [] });
      expect(repo.run(run.id)!.status).toBe("running");
      svc.fail(run.id, "boom");
      expect(repo.run(run.id)!.status).toBe("error");
      svc.report(run.id, { key: "site_monitor", checks: [] });
      expect(repo.run(run.id)!.status).toBe("error");
      expect(a.services.notifications.list({ limit: 5 }).map((n) => n.title)).toEqual(["Workflow failed: Site monitor"]);
    });
  });
});

describe("workflows API", () => {
  it("is for the owner's session only", async () => {
    const token = await inAgent(async (x) => {
      x.services.remote.setEnabled(true);
      return (await x.services.remote.create({ name: "script", scope: "write" })).token;
    });
    expect((await bearer(token).call("/api/workflows")).status).toBe(403);
    expect((await bearer(token).call("/api/workflows/site_monitor", { method: "PATCH", body: { enabled: false } })).status).toBe(403);
    const c = await loggedIn();
    const list = await c.json("/api/workflows");
    expect(list.available).toBe(true);
    expect(list.workflows.map((w: { key: string }) => w.key)).toEqual(["site_monitor", "feed_digest"]);
    expect((await c.call("/api/workflows/unknown")).status).toBe(404);
    expect((await c.call("/api/workflows/site_monitor", { method: "PATCH", body: { schedule: { type: "once", at: "2030-01-01T10:00" } } })).status).toBe(400);
    expect((await c.call("/api/workflows/site_monitor", { method: "PATCH", body: { config: { urls: [SITE], extra: 1 } } })).status).toBe(400);
  });

  it("runs a site check on Cloudflare Workflows and reports back to the agent", async () => {
    const introspector = await introspectWorkflow((env as unknown as { TALORYS_WORKFLOW: Workflow }).TALORYS_WORKFLOW);
    try {
      await introspector.modifyAll(async (m) => {
        await m.disableRetryDelays();
        await m.mockStepResult({ name: "check site 1" }, { url: SITE, ok: true, status: 200, reason: null, ms: 12 });
        await m.mockStepError({ name: "check site 2" }, new Error("The site answered with status 502."));
      });
      const c = await loggedIn();
      const urls = [SITE, "https://shop.example.com/"];
      const res = await c.call("/api/workflows/site_monitor", { method: "PATCH", body: { enabled: true, config: { urls } } });
      expect(res.status).toBe(200);
      const { run } = await c.json("/api/workflows/site_monitor/run", { method: "POST" });
      expect(run.status).toBe("running");
      const [instance] = await introspector.get();
      await instance!.waitForStatus("complete");
      const runs = await inAgent((a) => new WorkflowRepository(a.services.db).runs({ key: "site_monitor", limit: 5 }));
      expect(runs[0]).toMatchObject({ id: run.id, status: "success", result: "1 of 2 sites up" });
      const memory = await inAgent((a) => new WorkflowRepository(a.services.db).get("site_monitor").memory);
      expect(memory).toEqual({ sites: { [SITE]: { failures: 0, down: false }, "https://shop.example.com/": expect.objectContaining({ failures: 1, down: false }) } });
      // "Run now" waits a minute between taps.
      expect((await c.call("/api/workflows/site_monitor/run", { method: "POST" })).status).toBe(429);
    } finally {
      await introspector.dispose();
    }
  });
});
