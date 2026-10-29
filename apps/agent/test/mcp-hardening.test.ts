import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { inAgent, loggedIn, readSse, type Client } from "./helpers";
import { mcpFixture, searchTool } from "./mcp-fixture";
import { McpService } from "../src/mcp/service";
import { originAllowed, parseAllowedOrigins } from "../src/mcp/url";
import { MAX_UNATTENDED_ARGS_CHARS, type DestructiveTool, type ToolDefinition } from "../src/tools/registry";
import { ToolExecutor, runApprovedAction } from "../src/tools";
import type { Env } from "../src/env";

const URL_ = "https://mcp.example.com/mcp";

beforeEach(async () => {
  await inAgent(async (a) => {
    for (const server of a.services.mcp.repo.list()) await a.services.mcp.remove(server.id);
  });
});

describe("allowed MCP servers (TALORYS_MCP_ALLOWED_ORIGINS)", () => {
  it("reads exact origins and *.domain wildcards, and fails closed on anything else", () => {
    const rules = parseAllowedOrigins(" https://n8n.example.com , https://*.tools.example.org ");
    const allowed = (url: string) => originAllowed(new URL(url), rules);
    expect(allowed("https://n8n.example.com/mcp")).toBe(true);
    expect(allowed("https://N8N.example.com./mcp")).toBe(true);
    expect(allowed("https://a.tools.example.org/mcp")).toBe(true);
    expect(allowed("https://a.b.tools.example.org/mcp")).toBe(true);
    expect(allowed("https://tools.example.org/mcp")).toBe(false);
    expect(allowed("https://n8n.example.com.evil.net/mcp")).toBe(false);
    expect(allowed("https://evil-n8n.example.com/mcp")).toBe(false);
    expect(allowed("https://n8n.example.com:8443/mcp")).toBe(false);
    expect(allowed("http://n8n.example.com/mcp")).toBe(false);
    expect(parseAllowedOrigins(undefined)).toBeNull();
    expect(parseAllowedOrigins(" , ")).toBeNull();
    for (const bad of ["n8n.example.com", "https://n8n.example.com/mcp", "https://user@n8n.example.com", "ftp://x.example.com", "https://*.com", "https://*"]) {
      expect(parseAllowedOrigins(`https://ok.example.com,${bad}`), bad).toBe("invalid");
      expect(originAllowed(new URL("https://ok.example.com/mcp"), parseAllowedOrigins(`https://ok.example.com,${bad}`))).toBe(false);
    }
  });

  it("refuses servers off the list when added, and stops ones already added when the list narrows", async () => {
    const f = mcpFixture({ tools: [searchTool] });
    const c = await loggedIn();
    const swap = (origins: string | undefined) =>
      inAgent((a) => {
        const service = new McpService(a.services.db, { ...(env as unknown as Env), TALORYS_MCP_ALLOWED_ORIGINS: origins }, a.services.activity);
        service.network = f.network;
        a.services.mcp = service;
      });
    try {
      await swap("https://n8n.example.net");
      const refused = await c.call("/api/mcp/servers", { method: "POST", body: { name: "Docs", url: URL_ } });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(await refused.json())).toContain("TALORYS_MCP_ALLOWED_ORIGINS");
      expect(f.requests).toEqual([]);

      await swap("https://mcp.example.com");
      const { server } = await c.json("/api/mcp/servers", { method: "POST", body: { name: "Docs", url: URL_ } });
      expect(server.status).toBe("connected");

      await swap("https://other.example.com");
      const before = f.requests.length;
      const reconnect = await c.json(`/api/mcp/servers/${server.id}/connect`, { method: "POST", body: {} });
      expect(reconnect.server).toMatchObject({ status: "error" });
      expect(reconnect.server.error).toContain("TALORYS_MCP_ALLOWED_ORIGINS");
      expect(f.requests.length).toBe(before);
    } finally {
      await inAgent((a) => {
        a.services.mcp = new McpService(a.services.db, env as unknown as Env, a.services.activity);
      });
    }
  });
});

describe("turning on Run without asking", () => {
  it("needs the password typed recently, for the policy, for scheduled runs and for enabling an auto tool", async () => {
    const f = mcpFixture({ tools: [searchTool] });
    await inAgent((a) => {
      a.services.mcp.network = f.network;
    });
    const c = await loggedIn();
    const { server } = await c.json("/api/mcp/servers", { method: "POST", body: { name: "Docs", url: URL_ } });
    const patch = (body: Record<string, unknown>) => c.call(`/api/mcp/servers/${server.id}/tools/mcp_docs_search_docs`, { method: "PATCH", body });
    const stale = () => inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date(Date.now() - 60 * 60_000).toISOString()));

    await stale();
    // Asking first stays free.
    expect((await patch({ enabled: true, policy: "approve" })).status).toBe(200);
    const refused = await patch({ policy: "auto" });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("REAUTH_REQUIRED");

    await inAgent((a) => a.services.db.run(`UPDATE tal_sessions SET confirmed_at = ?`, new Date().toISOString()));
    expect((await patch({ policy: "auto" })).status).toBe(200);
    expect((await patch({ enabled: false })).status).toBe(200);

    await stale();
    expect((await patch({ enabled: true })).status).toBe(403);
    expect((await patch({ scheduled: true })).status).toBe(403);
    // Turning things off never needs it.
    expect((await patch({ policy: "approve" })).status).toBe(200);
  });
});

/** A fake external tool that normally runs without asking, with its approval version. */
function externalTool(name: string, serverId: string, ran: string[], committed: string[]): ToolDefinition {
  const input = z.object({ q: z.string() });
  const base = { name, description: name, input, label: () => name, external: { serverId, scheduled: true } };
  const escalate: DestructiveTool = {
    ...base,
    permission: "destructive",
    prepare: (args) => ({ targetId: `${serverId}/${name}`, summary: `Run “${name}” on ${serverId}`, payload: args }),
    snapshot: () => ({ serverId, name }),
    commit: (_target, _ctx, payload) => {
      committed.push(`${name}:${(payload as { q: string }).q}`);
      return { external_result: "ok" };
    },
  };
  return { ...base, permission: "read", execute: (args) => (ran.push(`${name}:${(args as { q: string }).q}`), { content: `result from ${serverId}` }), escalate };
}

describe("calls that run without asking need the owner when the turn makes them risky", () => {
  async function executor(mode: "chat" | "scheduled") {
    return inAgent((a) => {
      const ran: string[] = [];
      const committed: string[] = [];
      const tools = [externalTool("a_search", "server-a", ran, committed), externalTool("b_send", "server-b", ran, committed)];
      const conversation = a.services.conversations.create("MCP hardening");
      const ctx = { services: a.services, timezone: "UTC", mode, ...(mode === "chat" ? { conversationId: conversation.id } : {}) } as const;
      return { ran, committed, tools, ctx, exec: new ToolExecutor(tools, ctx, { maxToolCalls: 10 }) };
    });
  }

  it("after one server's result is in the turn, a call to another server is proposed, not sent", async () => {
    const { ran, committed, tools, ctx, exec } = await executor("chat");
    const out = await inAgent(async () => {
      await exec.execute("a_search", { q: "notes" });
      await exec.execute("a_search", { q: "more" });
      return exec.execute("b_send", { q: "secret" }, "call-1");
    });
    // More calls to the server whose content is already in the turn still run.
    expect(ran).toEqual(["a_search:notes", "a_search:more"]);
    expect(out).toMatchObject({ status: "awaiting_owner_approval", why_approval: expect.stringContaining("another server") });
    const approval = exec.approvalFor("call-1")!;
    expect(approval).toBeTruthy();
    // Approving runs exactly what was proposed, once.
    await inAgent((a) => runApprovedAction(tools, { ...ctx, services: a.services }, approval.id));
    expect(committed).toEqual(["b_send:secret"]);
  });

  it("an unusually long argument needs the owner even with nothing else in the turn", async () => {
    const { ran, exec } = await executor("chat");
    const out = await inAgent(() => exec.execute("a_search", { q: "x".repeat(MAX_UNATTENDED_ARGS_CHARS) }));
    expect(out).toMatchObject({ status: "awaiting_owner_approval", why_approval: expect.stringContaining("longer") });
    expect(ran).toEqual([]);
  });

  it("in a scheduled run, where nobody can approve, the call is refused", async () => {
    const { ran, exec } = await executor("scheduled");
    await expect(
      inAgent(async () => {
        await exec.execute("a_search", { q: "notes" });
        return exec.execute("b_send", { q: "secret" });
      }),
    ).rejects.toThrow(/scheduled automations can't ask/);
    expect(ran).toEqual(["a_search:notes"]);
  });
});

describe("end to end with an MCP server", () => {
  async function chat(c: Client, message: string) {
    const events = await readSse(await c.call("/api/chat", { method: "POST", body: { message } }));
    return events.find((e) => e.type === "done").message;
  }

  it("a long argument to a Run without asking tool becomes an approval card, and runs once when approved", async () => {
    const f = mcpFixture({ tools: [searchTool] });
    await inAgent((a) => {
      a.services.mcp.network = f.network;
    });
    const c = await loggedIn();
    const { server } = await c.json("/api/mcp/servers", { method: "POST", body: { name: "Docs", url: URL_ } });
    await c.call(`/api/mcp/servers/${server.id}/tools/mcp_docs_search_docs`, { method: "PATCH", body: { enabled: true, policy: "auto" } });

    const message = await chat(c, `call mcp_docs_search_docs {"query":"${"y".repeat(MAX_UNATTENDED_ARGS_CHARS)}"}`);
    const approval = message.tools[0].approval;
    expect(approval).toMatchObject({ status: "pending" });
    expect(f.calls).toEqual([]);

    const { action } = await c.json(`/api/actions/${approval.id}/approve`, { method: "POST", body: {} });
    expect(action.status).toBe("approved");
    expect(f.calls).toHaveLength(1);
    expect((await c.call(`/api/actions/${approval.id}/approve`, { method: "POST", body: {} })).status).toBe(409);
    expect(f.calls).toHaveLength(1);
  });
});
